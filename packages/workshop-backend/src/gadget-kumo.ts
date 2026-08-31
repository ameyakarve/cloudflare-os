import KUMO_RUNTIME from "./generated/gadget-kumo-runtime.txt";
import KUMO_STYLES from "./generated/gadget-kumo-styles.txt";

/** Prefixes a Gadget client with the real Cloudflare Kumo React library and standalone CSS. */
export function withGadgetKumo(clientCode: string): string {
  const styles = JSON.stringify(KUMO_STYLES);
  return `(() => {\n` +
    `  const style = document.createElement("style");\n` +
    `  style.dataset.kumo = "2.9.2";\n` +
    `  style.textContent = ${styles};\n` +
    `  document.head.append(style);\n` +
    `})();\n${KUMO_RUNTIME}\n${clientCode}`;
}

export { KUMO_RUNTIME, KUMO_STYLES };
