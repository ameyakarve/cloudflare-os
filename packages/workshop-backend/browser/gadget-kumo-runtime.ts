import * as React from "react";
import type { ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import {
  HighlightStyle,
  LRLanguage,
  LanguageSupport,
  syntaxHighlighting,
} from "@codemirror/language";
import { Compartment, EditorState } from "@codemirror/state";
import {
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
} from "@codemirror/view";
import { styleTags, tags } from "@lezer/highlight";
import { parser as beancountParser } from "lezer-beancount";
import {
  Badge,
  Banner,
  Button,
  Collapsible,
  Combobox,
  Empty,
  Field,
  Grid,
  Input,
  LayerCard,
  Loader,
  Select,
  Surface,
  Tabs,
  Text,
  Textarea,
  cn,
} from "@cloudflare/kumo";

// Gadget client code is an unbundled ES module, so the platform provides its UI dependencies as
// globals. These are deliberately the real React/Kumo exports, not platform reimplementations.
const runtimeGlobal = globalThis as unknown as Record<string, unknown>;

runtimeGlobal.React = React;

runtimeGlobal.Kumo = Object.freeze({
  Badge,
  Banner,
  Button,
  Collapsible,
  Combobox,
  Empty,
  Field,
  Grid,
  Input,
  LayerCard,
  Loader,
  Select,
  Surface,
  Tabs,
  Text,
  Textarea,
  cn,
});
runtimeGlobal.kumo = runtimeGlobal.Kumo;

const beancountLanguage = new LanguageSupport(LRLanguage.define({
  parser: beancountParser.configure({
    props: [styleTags({
      Date: tags.literal,
      TxnFlag: tags.operator,
      String: tags.string,
      Account: tags.variableName,
      Number: tags.number,
      Currency: tags.unit,
      "note open close balance pad document event price commodity query custom option include plugin pushtag poptag":
        tags.keyword,
    })],
  }),
}));

// Reuse the Context library's established CodeMirror treatment. Only the Beancount token mapping is
// MilesVault-specific; editor chrome, spacing, scrolling, selection and theme colors stay OS-native.
const monoFont =
  'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace';

const beancountHighlightLight = HighlightStyle.define([
  { tag: tags.literal, color: "#3a72c9" },
  { tag: tags.operator, color: "#6b6157", fontWeight: "700" },
  { tag: tags.string, color: "#4d8a44" },
  { tag: tags.variableName, color: "#1f1d1a" },
  { tag: tags.number, color: "#b56a1f", fontWeight: "700" },
  { tag: tags.unit, color: "#3a72c9" },
  { tag: tags.keyword, color: "#8e3aa6", fontWeight: "700" },
]);

const beancountHighlightDark = HighlightStyle.define([
  { tag: tags.literal, color: "#93c5fd" },
  { tag: tags.operator, color: "#b9b5c8", fontWeight: "700" },
  { tag: tags.string, color: "#86efac" },
  { tag: tags.variableName, color: "#e8e6f0" },
  { tag: tags.number, color: "#fbbf24", fontWeight: "700" },
  { tag: tags.unit, color: "#93c5fd" },
  { tag: tags.keyword, color: "#d8b4fe", fontWeight: "700" },
]);

const beancountThemeLight = EditorView.theme({
  "&": { color: "#1f1d1a", backgroundColor: "transparent", height: "100%", fontSize: "13px" },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": {
    fontFamily: monoFont,
    lineHeight: "1.7",
    overflow: "auto",
    overscrollBehavior: "contain",
    scrollbarWidth: "thin",
    scrollbarColor: "var(--color-kumo-line) transparent",
  },
  ".cm-scroller::-webkit-scrollbar": { width: "4px", height: "4px" },
  ".cm-scroller::-webkit-scrollbar-thumb": {
    background: "var(--color-kumo-line)",
    borderRadius: "4px",
  },
  ".cm-scroller::-webkit-scrollbar-track": { background: "transparent" },
  ".cm-content": { padding: "12px 0", caretColor: "#1f1d1a" },
  ".cm-line": { padding: "0 16px" },
  ".cm-gutters": { backgroundColor: "transparent", border: "none", color: "#bdb7ae", fontSize: "12px" },
  ".cm-lineNumbers .cm-gutterElement": { padding: "0 8px 0 14px", minWidth: "28px" },
  ".cm-activeLine": { backgroundColor: "var(--color-kumo-fill)" },
  ".cm-activeLineGutter": { backgroundColor: "transparent", color: "#6b6157" },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "#1f1d1a" },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection": {
    backgroundColor: "#b3d4ff",
  },
}, { dark: false });

const beancountThemeDark = EditorView.theme({
  "&": { color: "#e8e6f0", backgroundColor: "transparent", height: "100%", fontSize: "13px" },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": {
    fontFamily: monoFont,
    lineHeight: "1.7",
    overflow: "auto",
    overscrollBehavior: "contain",
    scrollbarWidth: "thin",
    scrollbarColor: "var(--color-kumo-line) transparent",
  },
  ".cm-scroller::-webkit-scrollbar": { width: "4px", height: "4px" },
  ".cm-scroller::-webkit-scrollbar-thumb": {
    background: "var(--color-kumo-line)",
    borderRadius: "4px",
  },
  ".cm-scroller::-webkit-scrollbar-track": { background: "transparent" },
  ".cm-content": { padding: "12px 0", caretColor: "#e8e6f0" },
  ".cm-line": { padding: "0 16px" },
  ".cm-gutters": { backgroundColor: "transparent", border: "none", color: "#6d6880", fontSize: "12px" },
  ".cm-lineNumbers .cm-gutterElement": { padding: "0 8px 0 14px", minWidth: "28px" },
  ".cm-activeLine": { backgroundColor: "var(--color-kumo-fill)" },
  ".cm-activeLineGutter": { backgroundColor: "transparent", color: "#b9b5c8" },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "#e8e6f0" },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection": {
    backgroundColor: "#4b3d66",
  },
}, { dark: true });

const beancountThemeExtensions = (mode: "light" | "dark") => mode === "dark"
  ? [syntaxHighlighting(beancountHighlightDark), beancountThemeDark]
  : [syntaxHighlighting(beancountHighlightLight), beancountThemeLight];

type BeancountEditorProps = {
  value: string;
  onValueChange: (value: string) => void;
  onSave?: () => void;
  readOnly?: boolean;
  className?: string;
  ariaLabel?: string;
};

/** Production-grade journal editor supplied by the platform so Gadget source stays declarative. */
function BeancountEditor({
  value,
  onValueChange,
  onSave,
  readOnly = false,
  className,
  ariaLabel = "Beancount journal",
}: BeancountEditorProps): ReactNode {
  const hostRef = React.useRef<HTMLDivElement | null>(null);
  const viewRef = React.useRef<EditorView | null>(null);
  const syncingRef = React.useRef(false);
  const onValueChangeRef = React.useRef(onValueChange);
  const onSaveRef = React.useRef(onSave);
  const readOnlyCompartmentRef = React.useRef(new Compartment());
  const themeCompartmentRef = React.useRef(new Compartment());
  onValueChangeRef.current = onValueChange;
  onSaveRef.current = onSave;

  React.useEffect(() => {
    if (!hostRef.current) return;
    const readOnlyCompartment = readOnlyCompartmentRef.current;
    const view = new EditorView({
      parent: hostRef.current,
      state: EditorState.create({
        doc: value,
        extensions: [
          lineNumbers(),
          highlightActiveLine(),
          highlightActiveLineGutter(),
          history(),
          beancountLanguage,
          themeCompartmentRef.current.of(beancountThemeExtensions(
            document.documentElement.dataset.mode === "dark" ? "dark" : "light",
          )),
          EditorView.lineWrapping,
          EditorView.contentAttributes.of({ "aria-label": ariaLabel }),
          readOnlyCompartment.of([
            EditorState.readOnly.of(readOnly),
            EditorView.editable.of(!readOnly),
          ]),
          keymap.of([
            ...defaultKeymap,
            ...historyKeymap,
            {
              key: "Mod-s",
              preventDefault: true,
              run: () => {
                onSaveRef.current?.();
                return true;
              },
            },
          ]),
          EditorView.updateListener.of(update => {
            if (update.docChanged && !syncingRef.current) {
              onValueChangeRef.current(update.state.doc.toString());
            }
          }),
        ],
      }),
    });
    viewRef.current = view;
    return () => {
      viewRef.current = null;
      view.destroy();
    };
    // This creates one editor instance; controlled values and callbacks are synchronized below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useEffect(() => {
    const view = viewRef.current;
    if (!view || view.state.doc.toString() === value) return;
    syncingRef.current = true;
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value } });
    syncingRef.current = false;
  }, [value]);

  React.useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({ effects: readOnlyCompartmentRef.current.reconfigure([
      EditorState.readOnly.of(readOnly),
      EditorView.editable.of(!readOnly),
    ]) });
  }, [readOnly]);

  React.useEffect(() => {
    const apply = () => viewRef.current?.dispatch({
      effects: themeCompartmentRef.current.reconfigure(beancountThemeExtensions(
        document.documentElement.dataset.mode === "dark" ? "dark" : "light",
      )),
    });
    const observer = new MutationObserver(apply);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-mode"] });
    return () => observer.disconnect();
  }, []);

  return React.createElement("div", {
    ref: hostRef,
    className,
    style: { minHeight: 0, height: "100%", overflow: "hidden" },
  });
}

const initialMode = document.documentElement.dataset.mode;
document.documentElement.style.colorScheme = initialMode === "dark" ? "dark" : "light";
document.body.classList.add("bg-kumo-canvas", "text-kumo-default");

runtimeGlobal.GadgetUI = Object.freeze({
  mount(node: ReactNode): Root {
    const root = createRoot(document.body);
    root.render(node);
    return root;
  },
  BeancountEditor,
});
