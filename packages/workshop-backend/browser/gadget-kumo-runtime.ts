import * as React from "react";
import type { ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { closeBrackets, closeBracketsKeymap, completionKeymap } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import {
  bracketMatching,
  foldKeymap,
  indentOnInput,
} from "@codemirror/language";
import { Compartment, EditorState } from "@codemirror/state";
import { searchKeymap } from "@codemirror/search";
import {
  drawSelection,
  dropCursor,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  rectangularSelection,
} from "@codemirror/view";
import {
  beancountCompletion,
  type BeancountCompletionData,
} from "./beancount-completion.js";
import {
  beancountLanguage,
  beancountThemeExtensions,
} from "@gadgets/workshop-shared/beancount-editor";
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
  Popover,
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
  Popover,
  Select,
  Surface,
  Tabs,
  Text,
  Textarea,
  cn,
});
runtimeGlobal.kumo = runtimeGlobal.Kumo;

type BeancountEditorProps = {
  value: string;
  onValueChange: (value: string) => void;
  onSave?: () => void;
  readOnly?: boolean;
  className?: string;
  ariaLabel?: string;
  completionData?: BeancountCompletionData;
};

const emptyCompletionData: BeancountCompletionData = {
  ledgerAccounts: [],
  catalogueAccounts: [],
};

/** Production-grade journal editor supplied by the platform so Gadget source stays declarative. */
function BeancountEditor({
  value,
  onValueChange,
  onSave,
  readOnly = false,
  className,
  ariaLabel = "Beancount journal",
  completionData = emptyCompletionData,
}: BeancountEditorProps): ReactNode {
  const hostRef = React.useRef<HTMLDivElement | null>(null);
  const viewRef = React.useRef<EditorView | null>(null);
  const syncingRef = React.useRef(false);
  const onValueChangeRef = React.useRef(onValueChange);
  const onSaveRef = React.useRef(onSave);
  const readOnlyCompartmentRef = React.useRef(new Compartment());
  const themeCompartmentRef = React.useRef(new Compartment());
  const completionCompartmentRef = React.useRef(new Compartment());
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
          highlightSpecialChars(),
          history(),
          drawSelection(),
          dropCursor(),
          EditorState.allowMultipleSelections.of(true),
          indentOnInput(),
          bracketMatching(),
          closeBrackets(),
          rectangularSelection(),
          beancountLanguage,
          completionCompartmentRef.current.of(beancountCompletion(completionData)),
          themeCompartmentRef.current.of(beancountThemeExtensions(
            document.documentElement.dataset.mode === "dark" ? "dark" : "light",
          )),
          EditorView.lineWrapping,
          readOnlyCompartment.of([
            EditorState.readOnly.of(readOnly),
            EditorView.editable.of(!readOnly),
            EditorView.contentAttributes.of({ "aria-label": ariaLabel, "aria-readonly": String(readOnly), tabindex: "0" }),
          ]),
          keymap.of([
            ...closeBracketsKeymap,
            ...defaultKeymap,
            ...searchKeymap,
            ...historyKeymap,
            ...foldKeymap,
            ...completionKeymap,
            indentWithTab,
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
      EditorView.contentAttributes.of({ "aria-label": ariaLabel, "aria-readonly": String(readOnly), tabindex: "0" }),
    ]) });
  }, [readOnly, ariaLabel]);

  React.useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: completionCompartmentRef.current.reconfigure(beancountCompletion(completionData)),
    });
  }, [completionData]);

  React.useEffect(() => {
    const apply = () => {
      const mode = document.documentElement.dataset.mode === "dark" ? "dark" : "light";
      // Kumo's light-dark() host variables must switch alongside the editor compartment.
      document.documentElement.style.colorScheme = mode;
      viewRef.current?.dispatch({
        effects: themeCompartmentRef.current.reconfigure(beancountThemeExtensions(mode)),
      });
    };
    apply();
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
