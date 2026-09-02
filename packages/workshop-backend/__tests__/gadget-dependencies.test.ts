import { describe, expect, it } from "vitest";
import {
  upgradeLegacyGadgetClient,
  upgradeLegacyLedgerServer,
  withGadgetKumo,
} from "../src/gadget-kumo";
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
    const client = "const { Button, Input, Surface, Textarea } = Kumo; const { BeancountEditor } = GadgetUI;";
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

  it("upgrades only the deployment-owned Ledger snapshot", () => {
    const oldLedger = `
const { Badge, Banner, Button, Loader, Surface, Text, Textarea } = Kumo;
function plan(rows, buffer) { return { rows, buffer }; }
function App() { return h(Textarea, { value: "Your canonical MilesVault journal" }); }
`;
    const modernLedger = "const { BeancountEditor } = GadgetUI;";
    expect(upgradeLegacyGadgetClient(oldLedger, "award", modernLedger)).toBe(modernLedger);
    const firstCodeMirrorLedger = `
const { Banner, Button, Loader, Surface, Text } = Kumo;
const { BeancountEditor } = GadgetUI;
function App() { return h(Text, { size: "sm" }, "All accounts"); }
`;
    expect(upgradeLegacyGadgetClient(firstCodeMirrorLedger, "award", modernLedger))
      .toBe(modernLedger);
    expect(upgradeLegacyGadgetClient("h(Textarea, { value: userCode });", "award", modernLedger))
      .toBe("h(Textarea, { value: userCode });");
    expect(upgradeLegacyGadgetClient("const { BeancountEditor } = GadgetUI;", "award", modernLedger))
      .toBe("const { BeancountEditor } = GadgetUI;");
  });

  it("adds completion to a saved Ledger server without changing other gadget servers", () => {
    const oldLedger = `
import { DurableObject } from "cloudflare:workers";
export class Gadget extends DurableObject {
  async listEntries() {
    return this.env.MILESVAULT_LEDGER.listEntries();
  }

  async replaceBuffer(knownIds, buffer) {
    return this.env.MILESVAULT_LEDGER.replaceBuffer({ knownIds, buffer });
  }
}`;
    const upgraded = upgradeLegacyLedgerServer(oldLedger);
    expect(upgraded).toContain("async completionData() {");
    expect(upgraded).toContain("return this.env.MILESVAULT_LEDGER.completionData();");
    expect(upgradeLegacyLedgerServer(upgraded)).toBe(upgraded);

    const userServer = `export class Gadget {
      async replaceBuffer(knownIds, buffer) {
        return this.env.USER_LEDGER.replaceBuffer({ knownIds, buffer });
      }
    }`;
    expect(upgradeLegacyLedgerServer(userServer)).toBe(userServer);
  });
});
