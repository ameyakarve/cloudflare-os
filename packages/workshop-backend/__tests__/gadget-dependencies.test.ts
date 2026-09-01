import { describe, expect, it } from "vitest";
import { upgradeLegacyGadgetClient, withGadgetKumo } from "../src/gadget-kumo";
import {
  assertGadgetBindingsAvailable,
  missingGadgetBindings,
  referencedGadgetBindings,
} from "../src/gadget-dependencies";

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
  it("loads the real runtime before a modern Gadget client", () => {
    const client = "const { Button, Input, Surface, Textarea } = Kumo; const { createElement } = React;";
    const bundle = withGadgetKumo(client);
    expect(bundle.indexOf('style.dataset.kumo = "2.9.2"')).toBeLessThan(bundle.indexOf(client));
  });

  it("keeps the old helper ABI isolated to saved legacy Gadgets", () => {
    const legacy = "const { h, page, hero, mount } = Kumo; mount(page({}, hero({title: 'Saved'})));";
    const bundle = withGadgetKumo(legacy);
    expect(bundle).toContain("globalThis.Kumo = Kumo");
    expect(bundle).not.toContain('style.dataset.kumo = "2.9.2"');
  });

  it("upgrades the saved pre-Kumo Award Explorer snapshot", () => {
    const legacy = `
const { h, page, hero, row, button, input, select, field, card, badge, notice, empty, loading, mount } = Kumo;
mount(page({}, hero({
  description: "Compare published programme pricing across schedule-backed direct and one-stop routes."
})));
`;
    const modern = "const { Button } = Kumo; GadgetUI.mount(React.createElement(Button));";
    expect(upgradeLegacyGadgetClient(legacy, modern)).toBe(modern);
    const original = `
const CABINS = [];
const style = document.createElement("style");
style.textContent = \`body { background: #faf8f3; }\`;
const description = "Compare programme pricing across direct and one-stop routes. Chart-derived guidance, built for deciding where to search next.";
`;
    expect(upgradeLegacyGadgetClient(original, modern)).toBe(modern);
    const badGlobe = `
function RouteGlobe({ option, origin, destination, airports }) {
  const project = code => [code.length, code.length];
}
const guide = "Published and observed pricing, not live seats";
`;
    expect(upgradeLegacyGadgetClient(badGlobe, modern)).toBe(modern);
    expect(upgradeLegacyGadgetClient("const { h, page } = Kumo;", modern))
      .toBe("const { h, page } = Kumo;");
  });
});
