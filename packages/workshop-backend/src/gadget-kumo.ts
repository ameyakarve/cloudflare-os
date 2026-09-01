import KUMO_RUNTIME from "./generated/gadget-kumo-runtime.txt";
import KUMO_STYLES from "./generated/gadget-kumo-styles.txt";
import GRAPH_RUNTIME from "./generated/gadget-graph-runtime.txt";
import GEO_RUNTIME from "./generated/gadget-geo-runtime.txt";
import DEPLOYMENT_GADGET_CLIENT_UPGRADE from "./generated/gadget-client-upgrade.txt";
import { withGadgetKumoRuntime as withLegacyKumo } from "./gadget-kumo-legacy";

const LEGACY_KUMO_CLIENT = /^\s*const\s*\{[^}]*\b(?:page|hero|card|notice|loading)\b[^}]*\}\s*=\s*Kumo\s*;/m;
const LEGACY_AWARD_EXPLORERS = [
  [
    "const { h, page, hero, row, button, input, select, field, card, badge, notice, empty, loading, mount } = Kumo;",
    'description: "Compare published programme pricing across schedule-backed direct and one-stop routes."',
  ],
  [
    "const CABINS = [",
    "style.textContent = `",
    "Compare programme pricing across direct and one-stop routes. Chart-derived guidance, built for deciding where to search next.",
  ],
  [
    "function RouteGlobe({ option, origin, destination, airports })",
    "const project = code =>",
    "Published and observed pricing, not live seats",
  ],
];

/** Replaces exact deployment-owned Award Explorer snapshots at render time. */
export function upgradeLegacyGadgetClient(
  clientCode: string,
  replacement = DEPLOYMENT_GADGET_CLIENT_UPGRADE,
): string {
  return replacement && LEGACY_AWARD_EXPLORERS.some(markers =>
    markers.every(marker => clientCode.includes(marker)))
    ? replacement
    : clientCode;
}

/** Prefixes a Gadget client with the real Cloudflare Kumo React library and standalone CSS. */
export function withGadgetKumo(clientCode: string): string {
  clientCode = upgradeLegacyGadgetClient(clientCode);
  // Existing Gadgets own immutable copies of their blueprint source. Keep the old ABI only for
  // code that explicitly consumes it; new clients never receive or learn about the compatibility
  // runtime. This avoids silently breaking saved Gadgets while letting the platform move forward.
  if (LEGACY_KUMO_CLIENT.test(clientCode)) return withLegacyKumo(clientCode);

  const styles = JSON.stringify(KUMO_STYLES);
  const graphRuntime = clientCode.includes("GadgetGraph") ? `${GRAPH_RUNTIME}\n` : "";
  const geoRuntime = clientCode.includes("GadgetGeo") ? `${GEO_RUNTIME}\n` : "";
  return `(() => {\n` +
    `  const style = document.createElement("style");\n` +
    `  style.dataset.kumo = "2.9.2";\n` +
    `  style.textContent = ${styles};\n` +
    `  document.head.append(style);\n` +
    `})();\n${KUMO_RUNTIME}\n${graphRuntime}${geoRuntime}${clientCode}`;
}

export { GEO_RUNTIME, GRAPH_RUNTIME, KUMO_RUNTIME, KUMO_STYLES };
