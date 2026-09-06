/* eslint-disable react/react-in-jsx-scope */
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { ActionComparisonPresentation } from "@gadgets/workshop-shared/gatekeeper";
import type { ReadonlyBeancountEditor } from "@gadgets/workshop-shared/beancount-editor";

function ReadonlyBeancountReview({ value, ariaLabel }: {
  value: string;
  ariaLabel: string;
}): ReactNode {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [renderedValue, setRenderedValue] = useState<string | null>(null);
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let disposed = false;
    let editor: ReadonlyBeancountEditor | undefined;
    let observer: MutationObserver | undefined;
    const mode = () => document.documentElement.dataset.mode === "dark" ? "dark" : "light";
    void import("@gadgets/workshop-shared/beancount-editor").then((module) => {
      if (disposed) return;
      editor = module.createReadonlyBeancountEditor({ parent: host, value, mode: mode(), ariaLabel });
      setRenderedValue(value);
      observer = new MutationObserver(() => editor?.setMode(mode()));
      observer.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ["data-mode"],
      });
    }).catch(() => {
      // Keep the full plain-text review available if the editor chunk cannot load.
    });
    return () => {
      disposed = true;
      observer?.disconnect();
      editor?.destroy();
    };
  }, [ariaLabel, value]);
  return <>
    {renderedValue !== value && <PlainTextReview value={value} ariaLabel={ariaLabel} />}
    <div ref={hostRef} className="max-h-48 overflow-hidden" />
  </>;
}

function PlainTextReview({ value, ariaLabel }: { value: string; ariaLabel: string }): ReactNode {
  return <pre aria-label={ariaLabel} className="max-h-48 overflow-auto whitespace-pre-wrap px-3 pb-3 pt-1 font-mono text-[12px] leading-[18px] text-kumo-default [overflow-wrap:anywhere]">{value}</pre>;
}

export function ActionComparisonReview({
  presentation,
}: {
  presentation: ActionComparisonPresentation;
}): ReactNode {
  const sections = [
    presentation.before !== undefined
      ? {
          label: presentation.beforeLabel ?? "Before",
          content: presentation.before,
          labelClass: "text-kumo-danger",
        }
      : null,
    presentation.after !== undefined
      ? {
          label: presentation.afterLabel ?? "After",
          content: presentation.after,
          labelClass: "text-kumo-success",
        }
      : null,
  ].filter((section): section is NonNullable<typeof section> => section !== null);

  return (
    <div className="mt-3 overflow-hidden rounded-xl border border-kumo-line/70 bg-kumo-base">
      {presentation.summary && (
        <div className="border-b border-kumo-line/70 bg-kumo-elevated/45 px-3 py-2 text-[12px] font-medium leading-4 text-kumo-subtle">
          {presentation.summary}
        </div>
      )}
      {sections.map((section, index) => (
        <section
          key={`${section.label}-${index}`}
          className={index === 0 ? "" : "border-t border-kumo-line/70"}
        >
          <div className={`px-3 pt-2 text-[10px] font-semibold uppercase tracking-[0.06em] ${section.labelClass}`}>
            {section.label}
          </div>
          {presentation.language === "beancount" ? <ReadonlyBeancountReview
            value={section.content.trim() || "(empty)"}
            ariaLabel={`${section.label} Beancount`}
          /> : <PlainTextReview value={section.content.trim() || "(empty)"} ariaLabel={section.label} />}
        </section>
      ))}
    </div>
  );
}
