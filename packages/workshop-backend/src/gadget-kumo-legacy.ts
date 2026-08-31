/** Historical pre-Kumo helper ABI, retained only so already-saved Gadget source does not break. */
export const GADGET_KUMO_RUNTIME = String.raw`
(() => {
const KUMO_CSS = ':root{color-scheme:light;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;--k-bg:#f7f7f5;--k-surface:#fff;--k-text:#20201e;--k-muted:#686864;--k-line:#deded9;--k-accent:#f48120;--k-danger:#b42318}*{box-sizing:border-box}body{margin:0;background:var(--k-bg);color:var(--k-text)}button,input,select{font:inherit}.k-page{width:min(1120px,100%);margin:auto;padding:24px}.k-hero{padding:28px;border:1px solid var(--k-line);border-radius:20px;background:var(--k-surface);box-shadow:0 12px 36px #1717130d}.k-eyebrow{margin:0 0 6px;color:#a14d08;font-size:12px;font-weight:700;letter-spacing:.1em;text-transform:uppercase}.k-title{margin:0;font-size:clamp(30px,6vw,52px);line-height:1;letter-spacing:-.04em}.k-description{max-width:720px;margin:12px 0 0;color:var(--k-muted);line-height:1.5}.k-stack{display:grid;gap:12px}.k-row{display:flex;flex-wrap:wrap;gap:10px;align-items:center}.k-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px}.k-search{display:grid;grid-template-columns:1fr auto 1fr auto;gap:10px;align-items:end;margin-top:24px}.k-field{display:grid;gap:6px;position:relative}.k-label{color:var(--k-muted);font-size:12px;font-weight:650}.k-input,.k-select{width:100%;min-height:44px;padding:0 12px;border:1px solid #c9c9c2;border-radius:10px;background:#fff;color:var(--k-text);outline:none}.k-input:focus,.k-select:focus{border-color:var(--k-accent);box-shadow:0 0 0 3px #f4812026}.k-button{min-height:44px;padding:0 16px;border:1px solid #c9c9c2;border-radius:10px;background:#fff;color:var(--k-text);font-weight:650;cursor:pointer}.k-button:hover{background:#f1f1ed}.k-button:disabled{opacity:.5;cursor:wait}.k-button--primary{border-color:var(--k-text);background:var(--k-text);color:#fff}.k-button--primary:hover{background:#383834}.k-button--quiet{min-height:36px;padding:0 11px;border-radius:999px}.k-button--active{border-color:var(--k-text);background:var(--k-text);color:#fff}.k-card{padding:17px;border:1px solid var(--k-line);border-radius:14px;background:var(--k-surface);box-shadow:0 6px 18px #17171308}.k-card__head{display:flex;justify-content:space-between;gap:18px;align-items:start}.k-card__title{margin:0;font-size:18px}.k-badge{display:inline-flex;margin-top:6px;padding:3px 8px;border-radius:999px;background:#eeeeea;color:var(--k-muted);font-size:11px;font-weight:700}.k-price{text-align:right}.k-price strong{display:block;font-size:22px}.k-price small,.k-muted{color:var(--k-muted)}.k-meta{display:flex;flex-wrap:wrap;gap:8px 16px;margin-top:13px;padding-top:12px;border-top:1px solid #ecece7;color:#555550;font-size:13px}.k-toolbar{display:flex;flex-wrap:wrap;justify-content:space-between;gap:10px;align-items:center;margin:20px 0 12px}.k-notice,.k-empty{margin:14px 0;padding:13px 15px;border:1px solid #e4c994;border-radius:11px;background:#fff7e7;color:#70470d;font-size:13px;line-height:1.5}.k-notice--danger{border-color:#f0b3ad;background:#fff1f0;color:var(--k-danger)}.k-empty{padding:36px 18px;border-style:dashed;border-color:#c9c9c2;background:transparent;color:var(--k-muted);text-align:center}.k-results{display:grid;gap:11px}.k-skeleton{height:110px;border-radius:14px;background:linear-gradient(90deg,#e9e9e4 25%,#f7f7f5 50%,#e9e9e4 75%);background-size:200% 100%;animation:k-shimmer 1.2s infinite}.k-popover{position:absolute;z-index:5;top:100%;left:0;right:0;margin:6px 0 0;padding:5px;list-style:none;border:1px solid var(--k-line);border-radius:10px;background:#fff;box-shadow:0 15px 35px #1717131f}.k-popover .k-button{display:block;width:100%;border:0;text-align:left}.k-details{margin-top:12px;color:#6d400b;font-size:13px}.k-details summary{font-weight:700;cursor:pointer}.k-list{color:var(--k-muted);line-height:1.55}.k-note{margin-top:8px;padding:10px;border-left:3px solid var(--k-accent);background:#fff7e7;color:#5d5d57;font-size:12px;line-height:1.5}@keyframes k-shimmer{to{background-position:-200% 0}}@media(max-width:720px){.k-page{padding:12px}.k-hero{padding:20px 15px;border-radius:15px}.k-search{grid-template-columns:1fr 42px 1fr}.k-search>.k-button:last-child{grid-column:1/-1}.k-card__head{display:grid}.k-price{text-align:left}}@media(max-width:500px){.k-search{grid-template-columns:1fr}.k-search>.k-button:last-child{grid-column:auto}.k-toolbar{align-items:stretch}.k-toolbar>.k-row{width:100%}.k-toolbar .k-select{flex:1;min-width:0}}';

const style = document.createElement("style");
style.dataset.kumo = "gadget";
style.textContent = KUMO_CSS;
document.head.append(style);

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
