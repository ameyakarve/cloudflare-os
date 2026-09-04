import {describe, expect, it} from "vitest";
import {
  allowActionInPrivateLedgerWorkspace,
  exposeGatekeeperToAgent,
  exposeManagedGadgetBindingsToAgent,
} from "../src/managed-output-boundary";

describe("managed output capability boundary", () => {
  it("keeps a managed Ledger's UI binding out of both new and existing agent envs", () => {
    expect(exposeManagedGadgetBindingsToAgent({systemOutput: "ledger"})).toBe(false);
    expect(exposeManagedGadgetBindingsToAgent({})).toBe(true);
    expect(exposeGatekeeperToAgent({
      systemResource: {type: "ledger", identityKey: "owner@example.com"},
    })).toBe(false);
    expect(exposeGatekeeperToAgent({})).toBe(true);
  });

  it("allows only the ambient approval-gated Ledger to act in the private workspace", () => {
    expect(allowActionInPrivateLedgerWorkspace({
      creationSpec: {type: "ambient", vendorId: "LEDGER"},
    })).toBe(true);
    expect(allowActionInPrivateLedgerWorkspace({
      creationSpec: {type: "ambient", vendorId: "graph"},
    })).toBe(false);
    expect(allowActionInPrivateLedgerWorkspace({
      creationSpec: {type: "resource", vendorId: "ledger"},
    })).toBe(false);
    expect(allowActionInPrivateLedgerWorkspace(undefined)).toBe(false);
  });
});
