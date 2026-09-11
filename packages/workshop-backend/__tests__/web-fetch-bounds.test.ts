import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { webFetch, type WebFetchEnv } from "../src/web-fetch";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

function fixture() {
  const request = vi.fn<typeof fetch>();
  // All tests replace global fetch; no request can reach a provider.
  vi.stubGlobal("fetch", request);
  const convert = vi.fn().mockResolvedValue({ format: "markdown", data: "converted" });
  const reserve = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
  const parent = new AbortController();
  const env: WebFetchEnv = {
    ai: { toMarkdown: convert }, gateway: null, signal: parent.signal, beforeDispatch: reserve,
  };
  return { request, convert, reserve, parent, env };
}
const input = { url: "https://example.com/start" };
const html = () => new Response("<p>hello</p>", { headers: { "content-type": "text/html" } });

beforeEach(() => vi.useFakeTimers());
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("webFetch full lifecycle bounds", () => {
  it("times out slow headers even when fetch ignores abort; discards late response", async () => {
    const f = fixture();
    const headers = deferred<Response>();
    f.request.mockReturnValue(headers.promise);
    const result = expect(webFetch(f.env, input)).rejects.toThrow(/timed out/);
    await vi.advanceTimersByTimeAsync(30_000);
    await result;
    expect(f.request.mock.calls[0][1]?.signal?.aborted).toBe(true);
    const cancel = vi.fn();
    headers.resolve(new Response(new ReadableStream({ cancel })));
    await vi.advanceTimersByTimeAsync(0);
    expect(cancel).toHaveBeenCalledOnce();
    expect(f.convert).not.toHaveBeenCalled();
  });

  it("keeps the original deadline through slow headers and a stalled body", async () => {
    const f = fixture();
    const headers = deferred<Response>();
    f.request.mockReturnValue(headers.promise);
    const cancel = vi.fn();
    const result = expect(webFetch(f.env, input)).rejects.toThrow(/timed out/);
    await vi.advanceTimersByTimeAsync(20_000);
    headers.resolve(new Response(new ReadableStream({ cancel }), { headers: { "content-type": "text/html" } }));
    await vi.advanceTimersByTimeAsync(10_000);
    await result;
    expect(cancel).toHaveBeenCalled();
    expect(f.convert).not.toHaveBeenCalled();
    expect(f.reserve).toHaveBeenCalledTimes(1);
  });

  it("bounds a non-cancellable conversion and retains its resource reservation", async () => {
    const f = fixture();
    f.request.mockResolvedValue(html());
    f.convert.mockReturnValue(new Promise(() => {}));
    const result = expect(webFetch(f.env, input)).rejects.toThrow(/timed out/);
    await vi.advanceTimersByTimeAsync(30_000);
    await result;
    expect(f.convert).toHaveBeenCalledOnce();
    expect(f.reserve).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["headers", "body", "conversion"])("propagates parent Stop during %s", async (stage) => {
    const f = fixture();
    const cancel = vi.fn();
    if (stage === "headers") f.request.mockReturnValue(new Promise(() => {}));
    if (stage === "body") f.request.mockResolvedValue(new Response(new ReadableStream({ cancel })));
    if (stage === "conversion") {
      f.request.mockResolvedValue(html());
      f.convert.mockReturnValue(new Promise(() => {}));
    }
    const result = expect(webFetch(f.env, input)).rejects.toThrow("parent stopped");
    await vi.advanceTimersByTimeAsync(0);
    f.parent.abort(new Error("parent stopped"));
    await result;
    expect(f.request.mock.calls[0][1]?.signal?.aborted).toBe(true);
    if (stage === "body") expect(cancel).toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not dispatch or reserve if already stopped", async () => {
    const f = fixture();
    f.parent.abort(new Error("stopped"));
    await expect(webFetch(f.env, input)).rejects.toThrow("stopped");
    expect(f.request).not.toHaveBeenCalled();
    expect(f.reserve).not.toHaveBeenCalled();
  });

  it("never dispatches after a late reservation reply", async () => {
    const f = fixture();
    const reservation = deferred<void>();
    f.reserve.mockReturnValue(reservation.promise);
    const result = expect(webFetch(f.env, input)).rejects.toThrow(/timed out/);
    await vi.advanceTimersByTimeAsync(30_000);
    await result;
    reservation.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(f.request).not.toHaveBeenCalled();
  });

  it("fails closed before conversion when the shared allowance is exhausted", async () => {
    const f = fixture();
    f.request.mockResolvedValue(html());
    f.reserve.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("exhausted"));
    await expect(webFetch(f.env, input)).rejects.toThrow("exhausted");
    expect(f.request).toHaveBeenCalledOnce();
    expect(f.convert).not.toHaveBeenCalled();
  });

  it("shares a host allowance across calls, rather than allocating per tool", async () => {
    const f = fixture();
    let remaining = 1;
    f.reserve.mockImplementation(async () => { if (remaining-- <= 0) throw new Error("exhausted"); });
    f.request.mockImplementation(async () => new Response("ok"));
    await webFetch(f.env, input);
    await expect(webFetch(f.env, input)).rejects.toThrow("exhausted");
    expect(f.request).toHaveBeenCalledOnce();
  });
});

describe("webFetch redirects and resource accounting", () => {
  it("reserves each actual hop and conversion; resolves relative Location", async () => {
    const f = fixture();
    f.request.mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: "/end" } }))
      .mockResolvedValueOnce(html());
    const result = await webFetch(f.env, input);
    expect(result.finalUrl).toBe("https://example.com/end");
    expect(f.reserve).toHaveBeenCalledTimes(3);
    expect(f.request.mock.calls.map((call) => call[1]?.redirect)).toEqual(["manual", "manual"]);
    expect(f.request.mock.calls[1][0]).toBe("https://example.com/end");
    expect(f.reserve.mock.invocationCallOrder[0]).toBeLessThan(f.request.mock.invocationCallOrder[0]);
    expect(f.reserve.mock.invocationCallOrder[2]).toBeLessThan(f.convert.mock.invocationCallOrder[0]);
  });

  it.each(["http://example.com/", "https://user:password@example.com/", "file:///tmp/private"])(
    "rejects unsafe redirect %s before dispatch", async (location) => {
      const f = fixture();
      f.request.mockResolvedValue(new Response(null, { status: 302, headers: { location } }));
      await expect(webFetch(f.env, input)).rejects.toThrow();
      expect(f.request).toHaveBeenCalledOnce();
      expect(f.reserve).toHaveBeenCalledOnce();
    });

  it("limits loops to five redirects (six charged HTTP attempts)", async () => {
    const f = fixture();
    f.request.mockImplementation(async () => new Response(null, { status: 307, headers: { location: "/start" } }));
    await expect(webFetch(f.env, input)).rejects.toThrow(/redirect limit/);
    expect(f.request).toHaveBeenCalledTimes(6);
    expect(f.reserve).toHaveBeenCalledTimes(6);
  });

  it("surfaces runtime public-IP rejection without retry", async () => {
    const f = fixture();
    f.request.mockRejectedValue(new Error("runtime blocked private address"));
    await expect(webFetch(f.env, input)).rejects.toThrow(/private address/);
    expect(f.reserve).toHaveBeenCalledOnce();
    // DNS rebinding / actual IP filtering is workerd's global_fetch_strictly_public,
    // not something an offline fetch mock can prove.
  });

  it("respects Content-Signal on redirects and never converts denied content", async () => {
    const f = fixture();
    const cancel = vi.fn();
    f.request.mockResolvedValue(new Response(new ReadableStream({ cancel }), {
      status: 302, headers: { location: "/end", "content-signal": "ai-input=no" },
    }));
    await expect(webFetch(f.env, input)).rejects.toThrow(/ai-input=no/);
    expect(cancel).toHaveBeenCalled();
    expect(f.request).toHaveBeenCalledOnce();
    expect(f.convert).not.toHaveBeenCalled();
  });

  it("caps conversion expansion and cleans up the timer after success", async () => {
    const f = fixture();
    f.request.mockResolvedValue(html());
    f.convert.mockResolvedValue({ format: "markdown", data: "x".repeat(100) });
    const result = await webFetch(f.env, { ...input, maxBytes: 20 });
    expect(result.body).toHaveLength(20);
    expect(result.truncated).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
});
