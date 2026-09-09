import {
  HighlightStyle,
  LRLanguage,
  LanguageSupport,
  syntaxHighlighting,
} from "@codemirror/language";
import { Compartment, EditorState } from "@codemirror/state";
import { EditorView, type EditorViewConfig } from "@codemirror/view";
import { styleTags, tags } from "@lezer/highlight";
import { parser as beancountParser } from "lezer-beancount";

/** Beancount grammar and semantic tags shared by SDK and review editors. */
export const beancountLanguage = new LanguageSupport(LRLanguage.define({
  parser: beancountParser.configure({
    props: [styleTags({
      Date: tags.literal,
      "TxnFlag TxnKeyword": tags.operator,
      LineComment: tags.lineComment,
      "Tag Link": tags.labelName,
      MetadataKey: tags.propertyName,
      BooleanValue: tags.bool,
      "ArithOp ArithMult PriceOp": tags.operator,
      String: tags.string,
      Account: tags.variableName,
      Number: tags.number,
      Currency: tags.unit,
      "note open close balance pad document event price commodity query custom option include plugin pushtag poptag":
        tags.keyword,
    })],
  }),
}));

const monoFont =
  'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace';

const beancountHighlightLight = HighlightStyle.define([
  { tag: tags.literal, color: "#235caa" },
  { tag: tags.operator, color: "#6b6157", fontWeight: "700" },
  { tag: tags.string, color: "#27672e" },
  { tag: tags.variableName, color: "#783ca0" },
  { tag: tags.number, color: "#985000", fontWeight: "700" },
  { tag: tags.unit, color: "#006b70" },
  { tag: tags.lineComment, color: "#606773", fontStyle: "italic" },
  { tag: [tags.labelName, tags.propertyName], color: "#795420" },
  { tag: tags.bool, color: "#8e3aa6" },
  { tag: tags.keyword, color: "#8e3aa6", fontWeight: "700" },
]);

const beancountHighlightDark = HighlightStyle.define([
  { tag: tags.literal, color: "#93c5fd" },
  { tag: tags.operator, color: "#b9b5c8", fontWeight: "700" },
  { tag: tags.string, color: "#86efac" },
  { tag: tags.variableName, color: "#d8b4fe" },
  { tag: tags.number, color: "#fbbf24", fontWeight: "700" },
  { tag: tags.unit, color: "#67e8f9" },
  { tag: tags.lineComment, color: "#a8aeb9", fontStyle: "italic" },
  { tag: [tags.labelName, tags.propertyName], color: "#f4cf92" },
  { tag: tags.bool, color: "#d8b4fe" },
  { tag: tags.keyword, color: "#d8b4fe", fontWeight: "700" },
]);

const editorTheme = (
  text: string,
  muted: string,
  gutter: string,
  accent: string,
  selection: string,
  dark: boolean,
) =>
  EditorView.theme({
    "&": {
      color: text,
      colorScheme: dark ? "dark" : "light",
      backgroundColor: `var(--color-kumo-base, ${dark ? "#0b0b0b" : "#ffffff"})`,
      height: "100%",
      fontSize: "13px",
    },
    "&.cm-focused": { outline: `2px solid ${accent}`, outlineOffset: "-2px" },
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
    ".cm-content": { padding: "12px 0", caretColor: text },
    ".cm-line": { padding: "0 16px" },
    ".cm-gutters": { backgroundColor: "transparent", border: "none", color: gutter, fontSize: "12px" },
    ".cm-lineNumbers .cm-gutterElement": { padding: "0 8px 0 14px", minWidth: "28px" },
    // Keep the drawn selection visible underneath the active-line decoration.
    ".cm-activeLine": { backgroundColor: dark ? "#ffffff08" : "#00000005" },
    ".cm-activeLineGutter": { backgroundColor: "transparent", color: muted },
    ".cm-cursor, .cm-dropCursor": { borderLeftColor: text },
    "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, & > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-content::selection, .cm-content ::selection": {
      backgroundColor: selection,
    },
    ".cm-tooltip": {
      backgroundColor: "var(--color-kumo-overlay)",
      border: "1px solid var(--color-kumo-line)",
      color: text,
      borderRadius: "8px",
      overflow: "hidden",
    },
    ".cm-tooltip.cm-tooltip-autocomplete > ul": { fontFamily: monoFont, fontSize: "12px" },
    ".cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected]": {
      backgroundColor: "var(--color-kumo-fill)",
      color: text,
    },
    ".cm-completionDetail": { color: muted, fontStyle: "normal" },
    ".cm-completionMatchedText": { color: accent, fontWeight: "700", textDecoration: "none" },
    ".cm-search": { backgroundColor: "var(--color-kumo-overlay)", color: text },
  }, { dark });

const beancountThemeLight = editorTheme(
  "#1f1d1a", "#6b6157", "#606773", "#235caa", "#dbeafe", false,
);
const beancountThemeDark = editorTheme(
  "#e8e6f0", "#b9b5c8", "#a8aeb9", "#93c5fd", "#352b49", true,
);

/** Syntax and accessible chrome for the host's current color mode. */
export const beancountThemeExtensions = (mode: "light" | "dark") => mode === "dark"
  ? [syntaxHighlighting(beancountHighlightDark), beancountThemeDark]
  : [syntaxHighlighting(beancountHighlightLight), beancountThemeLight];

const readonlySnippetTheme = EditorView.theme({
  "&": { height: "auto", maxHeight: "12rem" },
  ".cm-scroller": { maxHeight: "12rem" },
  ".cm-content": { padding: "8px 0" },
  ".cm-line": { padding: "0 12px" },
});

/** Lifecycle of a non-editable journal preview. */
export type ReadonlyBeancountEditor = {
  /** Release the view and listeners. */
  destroy(): void;
  /** Update host colors without replacing the document. */
  setMode(mode: "light" | "dark"): void;
};

/** Mount the same Beancount language and theme used by the editable Ledger as a compact viewer. */
export function createReadonlyBeancountEditor({
  parent,
  value,
  mode,
  ariaLabel,
}: {
  parent: NonNullable<EditorViewConfig["parent"]>;
  value: string;
  mode: "light" | "dark";
  ariaLabel: string;
}): ReadonlyBeancountEditor {
  const theme = new Compartment();
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc: value,
      extensions: [
        EditorState.readOnly.of(true),
        EditorView.editable.of(false),
        EditorView.lineWrapping,
        beancountLanguage,
        theme.of(beancountThemeExtensions(mode)),
        readonlySnippetTheme,
        EditorView.contentAttributes.of({ "aria-label": ariaLabel, "aria-readonly": "true", tabindex: "0" }),
      ],
    }),
  });
  return {
    destroy: () => view.destroy(),
    setMode: (nextMode) => view.dispatch({
      effects: theme.reconfigure(beancountThemeExtensions(nextMode)),
    }),
  };
}
