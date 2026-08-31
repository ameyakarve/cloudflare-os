import { describe, expect, it } from "vitest";
import {
  GADGET_KUMO_RUNTIME,
  withGadgetKumoRuntime,
} from "@gadgets/workshop-shared/gadget-kumo";
import {
  assertGadgetBindingsAvailable,
  missingGadgetBindings,
  referencedGadgetBindings,
} from "./gadget-dependencies";

describe("Gadget binding preflight", () => {
  it("finds dot, bracket, and destructured env dependencies", () => {
    const code = `
      this.env.AWARDS.searchAwards({});
      this.env["GRAPH"].lookupMany({});
      const { AIRPORTS, GADGET: self } = this.env;
    `;
    expect(referencedGadgetBindings(code)).toEqual(["AIRPORTS", "AWARDS", "GRAPH"]);
    expect(missingGadgetBindings(code, ["AWARDS"])).toEqual(["AIRPORTS", "GRAPH"]);
  });

  it("fails before code can swallow a missing-binding error", () => {
    expect(() => assertGadgetBindingsAvailable(
      "Award Explorer",
      `async load() { try { return await this.env.GRAPH.lookupMany({}); } catch { return []; } }`,
      [],
    )).toThrow('Gadget "Award Explorer" cannot start: server.js references missing bindings: GRAPH');
  });
});

describe("Gadget Kumo runtime", () => {
  it("is valid JavaScript and exposes the compact UI surface", () => {
    expect(() => new Function(GADGET_KUMO_RUNTIME)).not.toThrow();
    for (const helper of ["page", "hero", "field", "card", "notice", "loading", "mount"]) {
      expect(GADGET_KUMO_RUNTIME).toContain(`${helper}:`);
    }
    expect(GADGET_KUMO_RUNTIME).toContain("globalThis.Kumo = Kumo");
    const client = "const { h, page, mount } = Kumo; if (!h || !page || !mount) throw new Error();";
    const bundle = withGadgetKumoRuntime(client);
    expect(bundle.indexOf("globalThis.Kumo = Kumo")).toBeLessThan(bundle.indexOf("const { h"));
    expect(() => new Function(bundle)).not.toThrow();
  });
});
