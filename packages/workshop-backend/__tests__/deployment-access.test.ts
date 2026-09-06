import { afterEach, describe, expect, it, vi } from "vitest";
import { RpcTarget, newWebSocketRpcSession } from "capnweb";
import type { DeploymentAccessDecision, DeploymentAccessPolicy } from "@gadgets/workshop-shared/deployment-access";
import { readDeploymentAccess, watchDeploymentAccess, DeploymentAccessError } from "../src/deployment-access.js";
import { newWorkersRpcResponse } from "../src/rpc-session.js";

function policyEnv(checkAccess: Pick<DeploymentAccessPolicy, "checkAccess">["checkAccess"]): Cloudflare.Env {
  return Object.assign({} as Cloudflare.Env, {
    DEPLOYMENT_ACCESS_REQUIRED: "true", DEPLOYMENT_ACCESS_POLICY: {checkAccess},
  });
}

afterEach(() => vi.useRealTimers());

describe("deployment membership grants", () => {
  it("keeps optional upstream deployments unchanged but refuses missing required policy or identity", async () => {
    expect(await readDeploymentAccess({} as Cloudflare.Env, undefined)).toBeUndefined();
    await expect(readDeploymentAccess(Object.assign({} as Cloudflare.Env, {DEPLOYMENT_ACCESS_REQUIRED: "true"}), "key"))
        .rejects.toThrow("Access could not be verified");
    const check = vi.fn(async () => ({allowed: true as const, validUntil: Date.now() + 60_000}));
    await expect(readDeploymentAccess(policyEnv(check), undefined)).rejects.toThrow();
    expect(check).not.toHaveBeenCalled();
  });

  it("preserves the exact trusted key and caps an excessive provider grant", async () => {
    const check = vi.fn(async () => ({allowed: true as const, validUntil: Date.now() + 1_000_000}));
    const before = Date.now();
    const grant = await readDeploymentAccess(policyEnv(check), "Member@example.com");
    expect(check).toHaveBeenCalledWith("Member@example.com");
    expect(grant?.validUntil).toBeLessThanOrEqual(Date.now() + 60_000);
    expect(grant!.validUntil).toBeGreaterThanOrEqual(before + 59_000);
  });

  it.each(["denied", "unavailable"] as const)("refuses %s decisions", async reason => {
    await expect(readDeploymentAccess(policyEnv(async () => ({allowed: false, reason})), "key"))
        .rejects.toBeInstanceOf(DeploymentAccessError);
  });

  it.each([NaN, -1, 0])("refuses expired or invalid grant %s", async validUntil => {
    await expect(readDeploymentAccess(policyEnv(async () => ({allowed: true, validUntil})), "key"))
        .rejects.toThrow("Access could not be verified");
  });

  it("bounds a stalled private RPC without leaking its timeout", async () => {
    vi.useFakeTimers();
    const call = readDeploymentAccess(policyEnv(() => new Promise<DeploymentAccessDecision>(() => {})), "key");
    const rejected = expect(call).rejects.toThrow("Access could not be verified");
    await vi.advanceTimersByTimeAsync(5_000);
    await rejected;
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("live capability authorization", () => {
  it("renews active sessions without forcing reconnects and releases timers on completion", async () => {
    vi.useFakeTimers();
    const check = vi.fn(async () => ({allowed: true as const, validUntil: Date.now() + 60_000}));
    const revoke = vi.fn();
    const watch = await watchDeploymentAccess(check, revoke);
    await vi.advanceTimersByTimeAsync(170_000);
    expect(check).toHaveBeenCalledTimes(4);
    expect(revoke).not.toHaveBeenCalled();
    watch[Symbol.dispose]();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cancels an active run when renewal denies access", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    let allowed = true;
    const watch = await watchDeploymentAccess(async () => {
      if (!allowed) throw new DeploymentAccessError("denied");
      return {allowed: true, validUntil: Date.now() + 60_000};
    }, error => controller.abort(error));
    allowed = false;
    await vi.advanceTimersByTimeAsync(55_000);
    expect(controller.signal.aborted).toBe(true);
    expect(controller.signal.reason.message).toContain("no longer active");
    watch[Symbol.dispose]();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("expires a grant even if renewal hangs and ignores a late positive reply", async () => {
    vi.useFakeTimers();
    let reply!: (grant: {allowed: true; validUntil: number}) => void;
    const check = vi.fn().mockResolvedValueOnce({allowed: true, validUntil: Date.now() + 60_000})
        .mockImplementation(() => new Promise(resolve => { reply = resolve; }));
    const revoke = vi.fn();
    const watch = await watchDeploymentAccess(check, revoke);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(revoke).toHaveBeenCalledTimes(1);
    reply({allowed: true, validUntil: Date.now() + 60_000});
    await vi.advanceTimersByTimeAsync(1);
    expect(revoke).toHaveBeenCalledTimes(1);
    watch[Symbol.dispose]();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("disposes a watch during a stalled renewal without a later cancellation", async () => {
    vi.useFakeTimers();
    const check = vi.fn().mockResolvedValueOnce({allowed: true, validUntil: Date.now() + 60_000})
        .mockImplementation(() => new Promise(() => {}));
    const revoke = vi.fn();
    const watch = await watchDeploymentAccess(check, revoke);
    await vi.advanceTimersByTimeAsync(55_000);
    watch[Symbol.dispose]();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(revoke).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("ends a real WebSocket RPC session and releases its authorization watch on revocation", async () => {
    class Session extends RpcTarget { ping() { return "alive"; } }
    const controller = new AbortController();
    const closed = vi.fn();
    const response = await newWorkersRpcResponse(
        new Request("https://workshop.test/api", {headers: {Upgrade: "websocket"}}), new Session(),
        {abortSignal: controller.signal, onClose: closed});
    const socket = response.webSocket!;
    socket.accept();
    const client = newWebSocketRpcSession<Session>(socket);
    expect(await client.ping()).toBe("alive");
    const ended = new Promise<void>(resolve => socket.addEventListener("close", () => resolve(), {once: true}));
    controller.abort(new DeploymentAccessError("denied"));
    await ended;
    await expect(client.ping()).rejects.toThrow();
    expect(closed).toHaveBeenCalledTimes(1);
    client[Symbol.dispose]();
  });

  it("releases authorization resources when the client disconnects", async () => {
    const closed = vi.fn();
    const response = await newWorkersRpcResponse(
        new Request("https://workshop.test/api", {headers: {Upgrade: "websocket"}}), {},
        {abortSignal: new AbortController().signal, onClose: closed});
    const socket = response.webSocket!;
    socket.accept();
    socket.close();
    await vi.waitFor(() => expect(closed).toHaveBeenCalledTimes(1));
  });
});
