import runtimeSource from "../src/generated/gadget-pdf-runtime.txt";
import { describe, expect, it } from "vitest";
import { withGadgetKumo } from "../src/gadget-kumo";

describe("GadgetPDF", () => {
  it("injects the browser-local PDF runtime only for clients that use it", () => {
    expect(withGadgetKumo("GadgetPDF.getDocument({ data })")).toContain(runtimeSource);
    expect(withGadgetKumo("GadgetUI.mount(null)")).not.toContain(runtimeSource);
  });

  it("bundles an in-process worker handler without granting network access", () => {
    expect(runtimeSource).toContain("GadgetPDF=Object.freeze");
    expect(runtimeSource).toContain("pdfjsWorker");
    expect(runtimeSource).toContain("requires bounded in-memory PDF bytes");
  });
});
