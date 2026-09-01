import dagre from "@dagrejs/dagre";

type LayoutNode = { id: string; width: number; height: number };
type LayoutEdge = { source: string; target: string };
type DirectedLayoutOptions = {
  nodes: LayoutNode[];
  edges: LayoutEdge[];
  direction?: "LR" | "RL" | "TB" | "BT";
  nodeSeparation?: number;
  rankSeparation?: number;
  edgeSeparation?: number;
  marginX?: number;
  marginY?: number;
};

const bounded = (value: number | undefined, fallback: number, maximum: number): number =>
  Number.isFinite(value) ? Math.max(0, Math.min(maximum, value!)) : fallback;

function layoutDirected(options: DirectedLayoutOptions) {
  if (!Array.isArray(options?.nodes) || !Array.isArray(options?.edges)) {
    throw new TypeError("GadgetGraph.layoutDirected requires nodes and edges arrays.");
  }
  if (options.nodes.length > 500 || options.edges.length > 2_000) {
    throw new RangeError("GadgetGraph layouts are limited to 500 nodes and 2,000 edges.");
  }

  const graph = new dagre.graphlib.Graph();
  graph.setDefaultEdgeLabel(() => ({}));
  graph.setGraph({
    rankdir: ["LR", "RL", "TB", "BT"].includes(options.direction ?? "LR")
      ? options.direction ?? "LR"
      : "LR",
    nodesep: bounded(options.nodeSeparation, 12, 500),
    ranksep: bounded(options.rankSeparation, 170, 1_000),
    edgesep: bounded(options.edgeSeparation, 10, 500),
    marginx: bounded(options.marginX, 24, 500),
    marginy: bounded(options.marginY, 24, 500),
  });

  const nodeIds = new Set<string>();
  for (const node of options.nodes) {
    if (!node?.id || nodeIds.has(node.id)) throw new TypeError("GadgetGraph node ids must be unique non-empty strings.");
    nodeIds.add(node.id);
    graph.setNode(node.id, {
      width: bounded(node.width, 1, 2_000),
      height: bounded(node.height, 1, 2_000),
    });
  }
  for (const edge of options.edges) {
    if (nodeIds.has(edge.source) && nodeIds.has(edge.target)) graph.setEdge(edge.source, edge.target);
  }

  dagre.layout(graph);
  const positions = new Map<string, { x: number; y: number }>();
  for (const node of options.nodes) {
    const point = graph.node(node.id);
    positions.set(node.id, { x: point.x - node.width / 2, y: point.y - node.height / 2 });
  }
  const size = graph.graph();
  return { positions, width: size.width ?? 0, height: size.height ?? 0 };
}

(globalThis as unknown as Record<string, unknown>).GadgetGraph = Object.freeze({ layoutDirected });
