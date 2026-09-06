import runtimeSource from "../src/generated/gadget-geo-runtime.txt";
import { describe, expect, it } from "vitest";
import { withGadgetKumo } from "../src/gadget-kumo";

describe("GadgetGeo", () => {
  it("injects geographic rendering only for clients that use it", () => {
    expect(withGadgetKumo("GadgetGeo.RouteGlobe({ routes: [] })"))
      .toContain(runtimeSource);
    expect(withGadgetKumo("GadgetUI.mount(null)"))
      .not.toContain(runtimeSource);
  });
});
