import { describe, expect, it } from "vitest";
import "../browser/gadget-graph-runtime";
import { withGadgetKumo } from "../src/gadget-kumo";

type GraphRuntime = {
  layoutDirected(options: {
    nodes: Array<{ id: string; width: number; height: number }>;
    edges: Array<{ source: string; target: string }>;
    direction?: "LR" | "RL" | "TB" | "BT";
  }): { positions: Map<string, { x: number; y: number }>; width: number; height: number };
};

const loadRuntime = (): GraphRuntime => {
  return (globalThis as unknown as { GadgetGraph: GraphRuntime }).GadgetGraph;
};

describe("GadgetGraph", () => {
  it("lays out a directed graph in ranks", () => {
    const result = loadRuntime().layoutDirected({
      nodes: ["card", "points", "target"].map(id => ({ id, width: 184, height: 64 })),
      edges: [
        { source: "card", target: "points" },
        { source: "points", target: "target" },
      ],
      direction: "LR",
    });

    expect(result.positions.get("card")!.x).toBeLessThan(result.positions.get("points")!.x);
    expect(result.positions.get("points")!.x).toBeLessThan(result.positions.get("target")!.x);
    expect(result.width).toBeGreaterThan(3 * 184);
    expect(result.height).toBeGreaterThanOrEqual(64);
  });

  it("injects Dagre only for clients that use it", () => {
    expect(withGadgetKumo("GadgetGraph.layoutDirected({ nodes: [], edges: [] })"))
      .toContain("/src/generated/gadget-graph-runtime.txt");
    expect(withGadgetKumo("GadgetUI.mount(null)"))
      .not.toContain("/src/generated/gadget-graph-runtime.txt");
  });
});
