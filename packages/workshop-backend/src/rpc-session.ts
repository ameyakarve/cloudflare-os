import { newHttpBatchRpcResponse, newWebSocketRpcSession, type RpcSessionOptions } from "capnweb";

/** Cap'n Web session options with explicit transport cancellation and resource cleanup. */
export type ExtendedRpcSessionOptions = RpcSessionOptions & {
  /** Abort WebSocket sessions when this signal is aborted; HTTP batches use admission checks. */
  abortSignal: AbortSignal;
  /** Release lifetime-scoped resources on disconnect, abort, error, or HTTP completion. */
  onClose?: () => void;
};

/** Create a native Worker RPC response whose WebSocket lifetime can be revoked. */
export async function newWorkersRpcResponse(
    request: Request, localMain: any, options?: ExtendedRpcSessionOptions) {
  if (request.method === "POST") {
    try {
      let response = await newHttpBatchRpcResponse(request, localMain, options);
      // Since we're exposing the same API over WebSocket, too, and WebSocket always allows
      // cross-origin requests, the API necessarily must be safe for cross-origin use (e.g. because
      // it uses in-band authorization, as recommended in the readme). So, we might as well allow
      // batch requests to be made cross-origin as well.
      response.headers.set("Access-Control-Allow-Origin", "*");
      return response;
    } finally {
      options?.onClose?.();
    }
  } else if (request.headers.get("Upgrade")?.toLowerCase() === "websocket") {
    return newWorkersWebSocketRpcResponse(request, localMain, options);
  } else {
    options?.onClose?.();
    return new Response("This endpoint only accepts POST or WebSocket requests.", { status: 400 });
  }
}

function newWorkersWebSocketRpcResponse(
    request: Request, localMain?: any, options?: ExtendedRpcSessionOptions): Response {
  if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
    return new Response("This endpoint only accepts WebSocket requests.", { status: 400 });
  }

  let pair = new WebSocketPair();
  let server = pair[0];
  server.accept()
  let stub = newWebSocketRpcSession(server, localMain, options);
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    options?.abortSignal.removeEventListener("abort", abort);
    options?.onClose?.();
  };
  const abort = () => { server.close(1008, "Session ended"); stub[Symbol.dispose](); close(); };
  server.addEventListener("close", close, {once: true});
  server.addEventListener("error", close, {once: true});

  if (options?.abortSignal.aborted) abort();
  else options?.abortSignal.addEventListener("abort", abort, {once: true});

  return new Response(null, {
    status: 101,
    webSocket: pair[1],
  });
}
