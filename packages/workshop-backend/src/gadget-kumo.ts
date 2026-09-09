import KUMO_RUNTIME from "./generated/gadget-kumo-runtime.txt";
import KUMO_STYLES from "./generated/gadget-kumo-styles.txt";
import GRAPH_RUNTIME from "./generated/gadget-graph-runtime.txt";
import GEO_RUNTIME from "./generated/gadget-geo-runtime.txt";
import { withGadgetKumoRuntime as withLegacyKumo } from "./gadget-kumo-legacy";

const LEGACY_KUMO_CLIENT = /^\s*const\s*\{[^}]*\b(?:page|hero|card|notice|loading)\b[^}]*\}\s*=\s*Kumo\s*;/m;
const MANAGED_LEDGER_SERVER = `import { DurableObject } from "cloudflare:workers";

export class Gadget extends DurableObject {
  ledgerUiOnly() {
    throw new Error("My Ledger data is available to agents only through the approval-gated LEDGER resource.");
  }
}`;

/**
 * Managed Ledger clients receive a platform-owned browser-only session. Keep the dynamic Gadget
 * itself inert so an agent cannot use `env.GADGET` as a confused deputy for the UI's direct Save
 * capability, regardless of which historical server snapshot the singleton stored.
 */
export function upgradeLegacyLedgerServer(serverCode: string): string {
  void serverCode;
  return MANAGED_LEDGER_SERVER;
}

/**
 * Prefixes saved source on every UI read with the current Kumo library and bundled paper defaults.
 * Styles are layered below authored CSS; no source migration or document theme attribute is needed.
 */
export function withGadgetKumo(clientCode: string): string {
  // Existing Gadgets own immutable copies of their blueprint source. Keep the old ABI only for
  // code that explicitly consumes it; new clients never receive or learn about the compatibility
  // runtime. This avoids silently breaking saved Gadgets while letting the platform move forward.
  if (LEGACY_KUMO_CLIENT.test(clientCode)) return withLegacyKumo(clientCode);

  const styles = JSON.stringify(KUMO_STYLES);
  const graphRuntime = clientCode.includes("GadgetGraph") ? `${GRAPH_RUNTIME}\n` : "";
  const geoRuntime = clientCode.includes("GadgetGeo") ? `${GEO_RUNTIME}\n` : "";
  return `(() => {\n` +
    `  const style = document.createElement("style");\n` +
    `  style.dataset.kumo = "paper-default";\n` +
    `  style.textContent = ${styles};\n` +
    `  document.head.append(style);\n` +
    `})();\n${KUMO_RUNTIME}\n${graphRuntime}${geoRuntime}${clientCode}`;
}

export { GEO_RUNTIME, GRAPH_RUNTIME, KUMO_RUNTIME, KUMO_STYLES };
