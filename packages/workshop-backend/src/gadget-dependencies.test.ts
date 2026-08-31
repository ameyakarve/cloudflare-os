import { describe, expect, it } from "vitest";
import { KUMO_RUNTIME, KUMO_STYLES, withGadgetKumo } from "./gadget-kumo";
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
  it("bundles the real React component library and its standalone styles", () => {
    expect(KUMO_RUNTIME.length).toBeGreaterThan(100_000);
    expect(KUMO_STYLES).toContain("--color-kumo-brand");
    expect(KUMO_STYLES).toContain(".bg-kumo-base");
    const client = "const { Button, Input, Surface } = Kumo; const { createElement } = React;";
    const bundle = withGadgetKumo(client);
    expect(bundle.indexOf('style.dataset.kumo = "2.9.2"')).toBeLessThan(bundle.indexOf(client));
    expect(bundle.indexOf(KUMO_RUNTIME.slice(0, 100))).toBeLessThan(bundle.indexOf(client));
  });
});
