// Built-in WebFetch capability for the agent.
//
// Provides an HTTP GET against arbitrary public HTTPS URLs. There is intentionally no
// support for POST/PUT/DELETE/PATCH or for forwarding credentials.
//
// Document-to-Markdown conversion is delegated to Cloudflare Workers AI's
// `env.WORKERS_AI.toMarkdown()` utility, which handles HTML, PDF, DOCX, XLSX/XLS, ODT/ODS,
// CSV, XML, and Apple Numbers documents. Image conversion is intentionally NOT exposed here
// because it uses paid Workers AI models. Plain-text, JSON, and other unknown content types
// pass through unconverted.
//
// SSRF protection: relies on workerd's post-DNS-lookup IP address filtering. The
// `global_fetch_strictly_public` compatibility flag (set in wrangler.jsonc) restricts
// `fetch()` to public IP addresses; reserved ranges (loopback, RFC1918, link-local,
// cloud-metadata, etc.) are rejected by the runtime, *after* the hostname has been
// resolved. This is the only correct place to enforce such restrictions, since a symbolic
// hostname can resolve to anything. `wrangler dev` reconfigures its global outbound to
// permit fetching from any address (so localhost services stay reachable), so the flag
// only takes effect in production -- an acceptable tradeoff for dev.

import type { AiGatewayConfig } from "./ai-gateway";

/**
 * The bits of the Workers AI binding and gateway config that `webFetch` needs. Kept narrow
 * so the caller can pass a stub in tests without constructing a full Cloudflare.Env.
 */
export type WebFetchEnv = {
  ai: Pick<Ai, "toMarkdown">;
  gateway: AiGatewayConfig | null;
  /** Host-owned run cancellation; never supplied by tool input. */
  signal?: AbortSignal;
  /**
   * Reserve one externalRequests unit before each HTTP hop or conversion dispatch.
   * This is a conservative resource allowance, not a financial charge or cost receipt.
   * A reservation remains consumed on failure/cancellation, including a late grant that
   * arrives after Stop. Conversion cost is unknown; the binding cannot cancel an
   * already-dispatched conversion (we stop waiting and discard its late result).
   */
  beforeDispatch?: () => Promise<void>;
};

export type WebFetchInput = {
  url: string;
  /**
   * If true, return the exact response bytes (decoded as UTF-8) without any document
   * conversion. If false or omitted, supported document formats (HTML, PDF, DOCX, ...) are
   * converted to Markdown via env.WORKERS_AI.toMarkdown().
   */
  raw?: boolean;
  /** Caller-requested cap on body length (characters). Server enforces its own hard cap on top. */
  maxBytes?: number;
};

export type WebFetchResult = {
  status: number;
  finalUrl: string;
  contentType: string;
  body: string;
  truncated: boolean;
};

// Hard server-side limits.
const HARD_MAX_BYTES = 5 * 1024 * 1024;     // 5 MiB after which we always truncate
const DEFAULT_MAX_BYTES = 1 * 1024 * 1024;  // 1 MiB default cap when caller didn't specify
const FETCH_TIMEOUT_MS = 30_000;
const USER_AGENT = "GadgetsWebFetch/1.0";

/**
 * Validate a URL string for use with webFetch. Throws on bad input. Returns the parsed URL
 * on success.
 *
 * Note: we do NOT inspect the hostname for "looks-internal" patterns here. That kind of
 * blocklist is fundamentally unsound because a symbolic hostname can resolve to any IP at
 * fetch time. SSRF protection is provided post-DNS-lookup by workerd (see the file header).
 */
export function validateWebFetchUrl(input: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(input);
  } catch {
    throw new Error(`Invalid URL: ${input}`);
  }

  if (parsed.protocol !== "https:") {
    throw new Error(
      `Only https:// URLs are allowed; got ${parsed.protocol}//. ` +
        `Use the HTTPS version of this URL.`,
    );
  }

  if (parsed.username || parsed.password) {
    throw new Error("URLs with embedded credentials are not allowed.");
  }

  return parsed;
}

// Read up to `maxBytes` from the body of a response. Returns the raw bytes (so callers can
// hand them to either a text decoder or a Blob) and a flag indicating whether the stream
// was truncated.
async function readBodyCapped(
  response: Response,
  maxBytes: number,
  signal: AbortSignal,
): Promise<{ bytes: Uint8Array; truncated: boolean }> {
  if (!response.body) {
    return { bytes: new Uint8Array(0), truncated: false };
  }

  const reader = response.body.getReader();
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener("abort", cancel, { once: true });
  if (signal.aborted) cancel();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let truncated = false;

  try {
    while (true) {
      signal.throwIfAborted();
      const { value, done } = await reader.read();
      signal.throwIfAborted();
      if (done) break;
      if (!value) continue;

      if (total + value.byteLength > maxBytes) {
        // Take a partial slice to fill the budget exactly, then stop.
        const remaining = maxBytes - total;
        if (remaining > 0) {
          chunks.push(value.subarray(0, remaining));
          total += remaining;
        }
        truncated = true;
        break;
      }

      chunks.push(value);
      total += value.byteLength;
    }
  } finally {
    signal.removeEventListener("abort", cancel);
    // Cancellation must not extend the operation's deadline.
    if (truncated || signal.aborted) cancel();
    reader.releaseLock();
  }

  const combined = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    combined.set(c, offset);
    offset += c.byteLength;
  }
  return { bytes: combined, truncated };
}

function decodeUtf8(bytes: Uint8Array): string {
  return new TextDecoder("utf-8", { fatal: false, ignoreBOM: false }).decode(bytes);
}

// Strip parameters from a Content-Type header (e.g. `text/html; charset=utf-8` -> `text/html`).
function baseContentType(contentType: string): string {
  const i = contentType.indexOf(";");
  return (i >= 0 ? contentType.slice(0, i) : contentType).trim().toLowerCase();
}

// Supported non-image conversion MIME types. We do not infer financial cost from this
// allow-list: every conversion consumes an external-request allowance unit. Derived from:
// https://developers.cloudflare.com/workers-ai/features/markdown-conversion/supported-formats/
//
// Image MIME types are intentionally excluded -- image conversion uses paid Workers AI
// models (object detection + Gemma-3 for image-to-text), and we don't want webFetch to
// silently incur per-fetch costs.
const TO_MARKDOWN_MIME_TYPES = new Set([
  "text/html",
  "application/xhtml+xml",
  "application/pdf",
  "application/xml",
  "text/xml",
  "text/csv",
  // Office / OpenDocument
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document", // .docx
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",       // .xlsx
  "application/vnd.ms-excel",                                                // .xls
  "application/vnd.ms-excel.sheet.macroenabled.12",                          // .xlsm
  "application/vnd.ms-excel.sheet.binary.macroenabled.12",                   // .xlsb
  "application/vnd.oasis.opendocument.spreadsheet",                          // .ods
  "application/vnd.oasis.opendocument.text",                                 // .odt
  "application/vnd.apple.numbers",                                           // .numbers
]);

// `toMarkdown()` uses the Workers AI binding, and binding calls only reach gateways in the
// Worker's own account -- so apply the platform gateway only when AiGatewayConfig resolves it
// as same-account (CF_AI_GATEWAY_USE_BINDING=false marks it cross-account).
function buildGatewayOptions(
  gateway: AiGatewayConfig | null,
): GatewayOptions | undefined {
  if (!gateway) return undefined;
  if (!gateway.sameAccountGateway) return undefined;
  return { id: gateway.sameAccountGateway, metadata: { tool: "webFetch", automated: true } };
}

// Attempt to convert a document to Markdown using the Workers AI binding. Returns the
// Markdown body on success, or null if the document's MIME type isn't in the supported
// allow-list. Throws (with a contextual error) if the conversion itself fails.
async function convertToMarkdown(
  env: WebFetchEnv,
  bytes: Uint8Array,
  contentType: string,
  url: URL,
  beforeDispatch: () => Promise<void>,
): Promise<string | null> {
  const mime = baseContentType(contentType);
  if (!TO_MARKDOWN_MIME_TYPES.has(mime)) {
    return null;
  }

  // Build a name from the URL path so toMarkdown's format detection has a hint.
  const pathBasename = url.pathname.split("/").filter(Boolean).pop() || "document";

  await beforeDispatch();
  const result = await env.ai.toMarkdown(
    {
      name: pathBasename,
      blob: new Blob([bytes], { type: mime }),
    },
    {
      gateway: buildGatewayOptions(env.gateway),
      conversionOptions: {
        // Resolve relative links against the page's own origin.
        html: {
          hostname: url.origin,
          // Skip per-image summarization (which would invoke paid Workers AI models). The
          // agent gets a Markdown skeleton with image alt text and src URLs, which is
          // sufficient for documentation-lookup use cases.
          images: { convert: false, convertOGImage: false },
        },
      },
    },
  );

  if (result.format === "error") {
    throw new Error(`Markdown conversion failed: ${result.error}`);
  }
  return result.data;
}



// Parse the Content-Signal response header (https://contentsignals.org/) and check whether
// a specific signal is present and set to "no". The header is a comma-separated list of
// key=value pairs, e.g. `ai-train=yes, search=yes, ai-input=no`.
function contentSignalDenies(response: Response, signal: string): boolean {
  const header = response.headers.get("content-signal");
  if (!header) return false;
  for (const part of header.split(",")) {
    const [key, value] = part.split("=").map((s) => s.trim().toLowerCase());
    if (key === signal && value === "no") return true;
  }
  return false;
}

/**
 * Format a `WebFetchResult` as a single string for the agent: a small YAML frontmatter
 * header followed by `---` then the body. This is friendlier to LLMs than a JSON-wrapped
 * object, since the body lives inline rather than as an escaped JSON string.
 */
export function formatWebFetchResult(result: WebFetchResult): string {
  const lines = [
    "---",
    `url: ${result.finalUrl}`,
    `status: ${result.status}`,
    `content-type: ${result.contentType || "(unspecified)"}`,
    `truncated: ${result.truncated}`,
    "---",
    "",
    result.body,
  ];
  return lines.join("\n");
}

/** Fetch and optionally convert under one absolute deadline and host-owned dispatch allowance. */
export async function webFetch(
  env: WebFetchEnv,
  input: WebFetchInput,
): Promise<WebFetchResult> {
  let url = validateWebFetchUrl(input.url);
  const requestedMax = input.maxBytes ?? DEFAULT_MAX_BYTES;
  if (!Number.isFinite(requestedMax)) throw new Error("maxBytes must be finite");
  const maxBytes = Math.min(Math.max(1, Math.floor(requestedMax)), HARD_MAX_BYTES);
  const controller = new AbortController();
  const signal = controller.signal;
  const parentAbort = () => controller.abort(env.signal?.reason);
  env.signal?.addEventListener("abort", parentAbort, { once: true });
  if (env.signal?.aborted) parentAbort();
  const timeout = setTimeout(() => controller.abort(
    new Error(`Fetch timed out after ${FETCH_TIMEOUT_MS}ms`)), FETCH_TIMEOUT_MS);
  let onAbort: () => void = () => {};
  const aborted = new Promise<never>((_, reject) => {
    onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) onAbort();
  });
  const beforeDispatch = async () => {
    signal.throwIfAborted();
    await env.beforeDispatch?.();
    // A late accounting reply must never authorize work after Stop/deadline.
    signal.throwIfAborted();
  };
  const execute = async (): Promise<WebFetchResult> => {
    for (let redirects = 0; ; redirects++) {
      await beforeDispatch();
      const response = await fetch(url.toString(), {
        method: "GET",
        // Every hop passes URL validation and workerd's post-DNS public-IP filter.
        redirect: "manual",
        headers: {
          "user-agent": USER_AGENT,
          "accept": "text/markdown,text/html;q=0.9,text/plain;q=0.9,application/json;q=0.9,application/xhtml+xml;q=0.9,*/*;q=0.8",
        },
        signal,
      });
      const discard = () => { void response.body?.cancel().catch(() => {}); };
      if (signal.aborted) { discard(); signal.throwIfAborted(); }
      if (contentSignalDenies(response, "ai-input")) {
        discard();
        throw new Error("The site sets Content-Signal: ai-input=no; its content cannot be used as AI input.");
      }
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        discard();
        if (redirects >= 5) throw new Error("Fetch redirect limit exceeded");
        const location = response.headers.get("location");
        if (!location) throw new Error("Fetch redirect is missing Location");
        url = validateWebFetchUrl(new URL(location, url).toString());
        continue;
      }
      const contentType = response.headers.get("content-type") ?? "";
      const { bytes, truncated } = await readBodyCapped(response, maxBytes, signal);
      signal.throwIfAborted();
      const md = input.raw ? null : await convertToMarkdown(env, bytes, contentType, url, beforeDispatch);
      signal.throwIfAborted();
      const body = md ?? decodeUtf8(bytes);
      return {
        status: response.status,
        finalUrl: url.toString(),
        contentType,
        // Also bound conversion expansion (characters); source bytes are capped above.
        body: body.slice(0, maxBytes),
        truncated: truncated || body.length > maxBytes,
      };
    }
  };
  try {
    // Includes reservation, headers, body and conversion, even if a binding ignores abort.
    return await Promise.race([aborted, execute()]);
  } finally {
    clearTimeout(timeout);
    env.signal?.removeEventListener("abort", parentAbort);
    signal.removeEventListener("abort", onAbort);
  }
}
