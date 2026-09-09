import LEGACY_STYLES from "./generated/gadget-kumo-legacy-styles.txt";

/** Historical helper ABI, with current platform-owned defaults for already-saved Gadget source. */
export const GADGET_KUMO_RUNTIME = `
(() => {
const style = document.createElement("style");
style.dataset.kumo = "gadget";
style.textContent = ${JSON.stringify(LEGACY_STYLES)};
document.head.append(style);
` + String.raw`
const append = (parent, children) => {
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    parent.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return parent;
};
const classes = (...names) => names.flatMap(name => {
  if (!name) return [];
  if (typeof name === "string") return [name];
  if (Array.isArray(name)) return classes(...name);
  return Object.keys(name).filter(key => name[key]);
}).join(" ");
const h = (tag, props = {}, ...children) => {
  const element = document.createElement(tag);
  for (const [key, value] of Object.entries(props || {})) {
    if (value === null || value === undefined || value === false) continue;
    if (key === "class" || key === "className") element.className = classes(value);
    else if (key === "text") element.textContent = String(value);
    else if (key === "on") for (const [event, listener] of Object.entries(value)) element.addEventListener(event, listener);
    else if (key.startsWith("on") && typeof value === "function") element.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key in element && key !== "list") element[key] = value;
    else element.setAttribute(key, value === true ? "" : String(value));
  }
  return append(element, children);
};
const control = (tag, props = {}) => h(tag, {...props, class: classes(tag === "select" ? "k-select" : "k-input", props.class)});
const select = (options, props = {}) => {
  const element = control("select", props);
  for (const option of options) element.append(h("option", {value: option.value, text: option.label, selected: option.selected}));
  return element;
};
const Kumo = Object.freeze({
  h, classes,
  mount: (...children) => { document.body.replaceChildren(); return append(document.body, children); },
  page: (props = {}, ...children) => h("main", {class: classes("k-page", props.class)}, ...children),
  hero: ({eyebrow, title, description, class: className} = {}, ...children) => h("section", {class: classes("k-hero", className)},
    eyebrow && h("p", {class: "k-eyebrow", text: eyebrow}),
    title && h("h1", {class: "k-title", text: title}),
    description && h("p", {class: "k-description", text: description}), children),
  stack: (...children) => h("div", {class: "k-stack"}, children),
  row: (...children) => h("div", {class: "k-row"}, children),
  grid: (...children) => h("div", {class: "k-grid"}, children),
  button: (label, props = {}) => h("button", {...props, type: props.type || "button", class: classes("k-button", props.variant &&
    "k-button--" + props.variant, props.active && "k-button--active", props.class)}, label),
  input: props => control("input", props),
  select,
  field: (label, child, props = {}) => h("label", {class: classes("k-field", props.class)}, h("span", {class: "k-label", text: label}), child),
  card: (props = {}, ...children) => h("article", {class: classes("k-card", props.class)}, children),
  badge: text => h("span", {class: "k-badge", text}),
  notice: (text, variant) => h("div", {class: classes("k-notice", variant &&
    "k-notice--" + variant), text}),
  empty: text => h("div", {class: "k-empty", text}),
  loading: (count = 3) => h("div", {class: "k-stack"}, Array.from({length: count}, () => h("div", {class: "k-skeleton"}))),
});
globalThis.Kumo = Kumo;
globalThis.kumo = Kumo;
})();
`;

/** Prefixes a detected legacy client with its historical compatibility runtime. */
export function withGadgetKumoRuntime(clientCode: string): string {
  return `${GADGET_KUMO_RUNTIME}\n${clientCode}`;
}
