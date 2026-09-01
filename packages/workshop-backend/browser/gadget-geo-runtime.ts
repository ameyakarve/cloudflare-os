import type * as ReactApi from "react";
import { geoGraticule10, geoOrthographic, geoPath } from "d3-geo";
import { feature } from "topojson-client";
import landTopology from "world-atlas/land-110m.json";

type RoutePoint = { iata: string; lat: number; lng: number };
type Label = RoutePoint & { x: number; y: number; dx: number; dy: number; anchor: "start" | "end" };
type LabelBox = { x: number; y: number; width: number; height: number };
type LandTopology = Parameters<typeof feature>[0] & { objects: { land: Parameters<typeof feature>[1] } };

const land = feature(landTopology as LandTopology, (landTopology as LandTopology).objects.land);
const ReactRuntime = (globalThis as unknown as { React: typeof ReactApi }).React;
const h = ReactRuntime.createElement;

function labelsFor(
  points: RoutePoint[],
  endpoints: Set<string>,
  project: (point: [number, number]) => [number, number] | null,
  size: number,
): Label[] {
  const occupied: LabelBox[] = [];
  const placements = [[7, -7, "start"], [-7, -7, "end"], [7, 13, "start"], [-7, 13, "end"]] as const;
  return points
    .toSorted((a, b) => Number(endpoints.has(b.iata)) - Number(endpoints.has(a.iata)))
    .flatMap((point) => {
      const projected = project([point.lng, point.lat]);
      if (!projected) return [];
      for (const [dx, dy, anchor] of placements) {
        const width = point.iata.length * 7;
        const box = {
          x: projected[0] + dx - (anchor === "end" ? width : 0),
          y: projected[1] + dy - 10,
          width,
          height: 13,
        };
        const overlaps = occupied.some((other) =>
          box.x < other.x + other.width + 3 && box.x + box.width + 3 > other.x &&
          box.y < other.y + other.height + 3 && box.y + box.height + 3 > other.y);
        if (box.x > 3 && box.y > 3 && box.x + box.width < size - 3 && box.y + box.height < size - 3 && !overlaps) {
          occupied.push(box);
          return [{ ...point, x: projected[0], y: projected[1], dx, dy, anchor }];
        }
      }
      return [];
    });
}

function RouteGlobe({
  routes,
  maxSize = 220,
  ariaLabel = "Flight route map",
}: {
  routes: RoutePoint[][];
  maxSize?: number;
  ariaLabel?: string;
}) {
  const ref = ReactRuntime.useRef<HTMLDivElement>(null);
  const [width, setWidth] = ReactRuntime.useState(maxSize);
  ReactRuntime.useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const update = () => setWidth(Math.min(element.clientWidth || maxSize, maxSize));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [maxSize]);

  const drawable = routes.filter((route) => route.length >= 2);
  if (drawable.length === 0) return null;
  const size = Math.max(80, width);
  const points = [...new Map(drawable.flat().map((point) => [point.iata, point])).values()];
  const lng = Math.atan2(points.reduce((sum, point) => sum + Math.sin(point.lng * Math.PI / 180), 0), points.reduce((sum, point) => sum + Math.cos(point.lng * Math.PI / 180), 0)) * 180 / Math.PI;
  const lat = points.reduce((sum, point) => sum + point.lat, 0) / points.length;
  const projection = geoOrthographic().rotate([-lng, -lat]).translate([size / 2, size / 2]).scale(size * .45).clipAngle(90);
  const path = geoPath(projection);
  const routeShape = { type: "FeatureCollection" as const, features: drawable.map((route) => ({ type: "Feature" as const, properties: {}, geometry: { type: "LineString" as const, coordinates: route.map((point) => [point.lng, point.lat]) } })) };
  const endpoints = new Set(drawable.flatMap((route) => [route[0]!.iata, route.at(-1)!.iata]));
  const labels = labelsFor(points, endpoints, projection, size);
  return h("div", { ref, style: { width: "100%", maxWidth: `${maxSize}px`, aspectRatio: "1", margin: "0 auto" } },
    h("svg", { viewBox: `0 0 ${size} ${size}`, role: "img", "aria-label": ariaLabel, style: { display: "block", width: "100%", height: "100%" } },
      h("path", { d: path({ type: "Sphere" }) ?? "", fill: "var(--color-kumo-base)", stroke: "var(--color-kumo-line)", strokeWidth: 1 }),
      h("path", { d: path(geoGraticule10()) ?? "", fill: "none", stroke: "var(--color-kumo-line)", strokeWidth: .55 }),
      h("path", { d: path(land) ?? "", fill: "var(--color-kumo-fill)", stroke: "var(--color-kumo-ring)", strokeWidth: .4 }),
      h("path", { d: path(routeShape) ?? "", fill: "none", stroke: "var(--color-kumo-default)", strokeWidth: 1.6, strokeDasharray: "4 3" }),
      points.map((point) => { const projected = projection([point.lng, point.lat]); return projected && h("circle", { key: point.iata, cx: projected[0], cy: projected[1], r: 3.5, fill: "var(--color-kumo-default)" }); }),
      labels.map((label) => h("text", { key: label.iata, x: label.x, y: label.y, dx: label.dx, dy: label.dy, textAnchor: label.anchor, fill: "var(--color-kumo-default)", stroke: "var(--color-kumo-base)", strokeWidth: 3, paintOrder: "stroke", fontSize: 11, fontWeight: 600 }, label.iata))));
}

(globalThis as unknown as Record<string, unknown>).GadgetGeo = Object.freeze({ RouteGlobe });
