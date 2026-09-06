import { describe, expect, it } from "vitest";
import { DEFAULT_ADMIN_CONFIG } from "../src/admin-config.js";
import {
  ambientGatekeeperMode,
  defaultAmbientGatekeeperMode,
  shouldAutoProvisionAccount,
} from "../src/provisioning-policy.js";

describe("MilesVault ambient Gatekeeper policy", () => {
  it("makes the deployment-owned MilesVault Gatekeeper implicit", () => {
    expect(defaultAmbientGatekeeperMode("custom")).toBe("enabled");
    expect(defaultAmbientGatekeeperMode("airports")).toBe("enabled");
    expect(defaultAmbientGatekeeperMode("graph")).toBe("enabled");
    expect(defaultAmbientGatekeeperMode("ledger")).toBe("enabled");
    expect(ambientGatekeeperMode(DEFAULT_ADMIN_CONFIG, "CUSTOM")).toBe("enabled");
    expect(shouldAutoProvisionAccount(DEFAULT_ADMIN_CONFIG, "custom")).toBe(true);
    expect(shouldAutoProvisionAccount(DEFAULT_ADMIN_CONFIG, "airports")).toBe(true);
    expect(shouldAutoProvisionAccount(DEFAULT_ADMIN_CONFIG, "graph")).toBe(true);
    expect(shouldAutoProvisionAccount(DEFAULT_ADMIN_CONFIG, "ledger")).toBe(true);
  });

  it("keeps other ambient Gatekeepers optional by default", () => {
    expect(defaultAmbientGatekeeperMode("context")).toBe("optional");
    expect(ambientGatekeeperMode(DEFAULT_ADMIN_CONFIG, "scheduler")).toBe("optional");
  });

  it("honors an explicit deployment override", () => {
    const config = {
      ...DEFAULT_ADMIN_CONFIG,
      ambientGatekeeperModes: { custom: "disabled" as const },
    };
    expect(ambientGatekeeperMode(config, "custom")).toBe("disabled");
  });
});
