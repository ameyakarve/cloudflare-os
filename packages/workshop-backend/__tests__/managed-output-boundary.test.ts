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

  it("allows only the authenticated MilesVault Ledger to act in the private workspace", () => {
    expect(allowActionInPrivateLedgerWorkspace({
      creationSpec: {type: "ambient", vendorId: "LEDGER"},
      resourceUrl: "https://milesvault.com/ledger/current",
    })).toBe(true);
    expect(allowActionInPrivateLedgerWorkspace({
      creationSpec: {type: "gatekeeper", vendorId: "ledger"},
      resourceUrl: "https://milesvault.com/ledger/current/",
    })).toBe(true);
    expect(allowActionInPrivateLedgerWorkspace({
      creationSpec: {type: "ambient", vendorId: "graph"},
      resourceUrl: "https://milesvault.com/ledger/current",
    })).toBe(false);
    expect(allowActionInPrivateLedgerWorkspace({
      creationSpec: {type: "gatekeeper", vendorId: "ledger"},
      resourceUrl: "https://example.com/ledger/current",
    })).toBe(false);
    expect(allowActionInPrivateLedgerWorkspace(undefined)).toBe(false);
  });
});
