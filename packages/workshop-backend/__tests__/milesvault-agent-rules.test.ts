import {describe, expect, it} from "vitest";
import {MILESVAULT_AGENT_RULES} from "../src/milesvault-agent-rules";

describe("MilesVault agent rules", () => {
  it("keeps domain and user-data authority explicit", () => {
    expect(MILESVAULT_AGENT_RULES).toContain("explicitly supplied by the user as authoritative configuration");
    expect(MILESVAULT_AGENT_RULES).toContain("Do not query `GRAPH` or the web merely to verify");
    expect(MILESVAULT_AGENT_RULES).toContain("the user did not supply, query `GRAPH` first");
    expect(MILESVAULT_AGENT_RULES).toContain("web research is an allowed fallback");
    expect(MILESVAULT_AGENT_RULES).toContain("`LEDGER` binding is the sole source");
    expect(MILESVAULT_AGENT_RULES).toContain("must never create, import, mirror, reconstruct");
  });

  it("requires contract-first, scoped, evidence-backed implementation", () => {
    expect(MILESVAULT_AGENT_RULES).toContain("smallest implementation contract");
    expect(MILESVAULT_AGENT_RULES).toContain("Relevance alone does not make a source required");
    expect(MILESVAULT_AGENT_RULES).toContain("never inspect another Gadget's files");
    expect(MILESVAULT_AGENT_RULES).toContain("Build only the requested view");
    expect(MILESVAULT_AGENT_RULES).toContain("invalidating that entire inferred rule set");
    expect(MILESVAULT_AGENT_RULES).toContain("against authoritative source data");
  });

  it("forbids capability workarounds and unverifiable completion claims", () => {
    expect(MILESVAULT_AGENT_RULES).toContain("If a required binding cannot expose required data");
    expect(MILESVAULT_AGENT_RULES).toContain("Do not continue researching optional facts");
    expect(MILESVAULT_AGENT_RULES).toContain("repeat an identical tool call");
    expect(MILESVAULT_AGENT_RULES).toContain("exact committed Gadget revision");
  });
});
