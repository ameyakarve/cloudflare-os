import { describe, expect, it } from "vitest";
import { withGadgetKumo } from "../src/gadget-kumo";

describe("GadgetGeo", () => {
  it("injects geographic rendering only for clients that use it", () => {
    expect(withGadgetKumo("GadgetGeo.RouteGlobe({ routes: [] })"))
      .toContain("/src/generated/gadget-geo-runtime.txt");
    expect(withGadgetKumo("GadgetUI.mount(null)"))
      .not.toContain("/src/generated/gadget-geo-runtime.txt");
  });
});
