import type { Api, AssistantMessage, Context, Model, SimpleStreamOptions, StreamFunction } from "@earendil-works/pi-ai";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import { boundedUsage, DeploymentUsageError, type UsageScope } from "./deployment-usage.js";
import { zeroUsage } from "./ai-invoke.js";

/** Reserve each actual provider dispatch, bound its lifetime, and settle only verified usage. */
export function streamWithUsage(stream: StreamFunction<Api, SimpleStreamOptions>, model: Model<Api>,
    context: Context, options: SimpleStreamOptions, scope: UsageScope | undefined) {
  const output = createAssistantMessageEventStream();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new DeploymentUsageError("request_deadline")), 60_000);
  const signal = AbortSignal.any([controller.signal, ...(options.signal ? [options.signal] : []),
      ...(scope ? [scope.controller.signal] : [])]);
  const fail = (error: unknown) => {
    const message: AssistantMessage = {role: "assistant", api: model.api, provider: model.provider,
      model: model.id, content: [], usage: zeroUsage(), timestamp: Date.now(), stopReason: "error",
      // Accounting denials and deadlines are not provider HTTP 429 responses.
      // A synthetic 429 encourages futile retries and hides the actual blocker.
      errorMessage: error instanceof Error ? error.message : "The model request failed."};
    output.push({type: "error", reason: "error", error: message});
    output.end();
  };
  const abort = () => fail(signal.reason);
  signal.addEventListener("abort", abort, {once: true});
  void (async () => {
    if (!scope) throw new DeploymentUsageError();
    signal.throwIfAborted();
    const maximumOutput = Math.min(options.maxTokens ?? model.maxTokens, model.maxTokens);
    const bound = model.contextWindow + maximumOutput;
    if (!Number.isSafeInteger(bound) || model.contextWindow <= 0 || maximumOutput <= 0) throw new DeploymentUsageError();
    const transport = options.fetch ?? globalThis.fetch;
    let lastReceipt: string | undefined;
    const google = model.api === "google-generative-ai";
    // pi's Google adapter rejects custom fetch. Its retry loop honors maxRetries: 0, and
    // @google/genai performs one dispatch when httpOptions.retryOptions is absent (as here).
    if (google) {
      lastReceipt = await scope.reserve({modelRequests: 1, tokens: bound, externalRequests: 1});
      signal.throwIfAborted();
    }
    const meteredFetch: typeof fetch = async (input, init) => {
        signal.throwIfAborted();
        // This wrapper is inside the provider SDK: even an internal retry has a fresh receipt.
        const receipt = await scope.reserve({modelRequests: 1, tokens: bound, externalRequests: 1});
        signal.throwIfAborted();
        lastReceipt = receipt;
        const requestSignal = AbortSignal.any([signal, ...(init?.signal ? [init.signal] : []),
            ...(input instanceof Request ? [input.signal] : [])]);
        return transport(input, {...init, signal: requestSignal});
      };
    const source = stream(model, context, {...options, signal, maxTokens: maximumOutput,
      maxRetries: 0, timeoutMs: 60_000, fetch: google ? undefined : meteredFetch});
    for await (const event of source) {
      signal.throwIfAborted();
      if (event.type === "done" && lastReceipt) {
        const tokens = event.message.usage.totalTokens;
        // Zero often means the provider omitted usage. Keep the bound in that case.
        if (Number.isSafeInteger(tokens) && tokens > 0) {
          await boundedUsage(scope.run.settleTokens(lastReceipt, tokens));
        }
      }
      output.push(event);
    }
    output.end();
  })().catch(fail).finally(() => {
    clearTimeout(timer);
    signal.removeEventListener("abort", abort);
  });
  return output;
}
