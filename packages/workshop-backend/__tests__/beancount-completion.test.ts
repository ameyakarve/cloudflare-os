import { CompletionContext, type CompletionResult } from "@codemirror/autocomplete";
import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import {
  beancountLanguage,
  createBeancountCompletionSource,
} from "../browser/beancount-completion.js";

function complete(
  doc: string,
  data = { ledgerAccounts: [] as string[], catalogueAccounts: [] as string[] },
  explicit = false,
): CompletionResult | null | Promise<CompletionResult | null> {
  const state = EditorState.create({ doc, extensions: [beancountLanguage] });
  return createBeancountCompletionSource(data, () => "2026-09-02")(
    new CompletionContext(state, state.doc.length, explicit),
  );
}

describe("MilesVault Beancount completion", () => {
  it("ranks buffer accounts before ledger and graph catalogue accounts", async () => {
    const result = await complete(
      "2026-09-01 open Assets:Rewards:Local INR\n\n2026-09-02 open Assets:",
      {
        ledgerAccounts: ["Assets:Rewards:Ledger"],
        catalogueAccounts: ["Assets:Rewards:Catalogue"],
      },
    );
    const options = result?.options ?? [];
    expect(options.find(option => option.label === "Assets:Rewards:Local")?.boost).toBe(3);
    expect(options.find(option => option.label === "Assets:Rewards:Ledger")?.boost).toBe(2);
    expect(options.find(option => option.label === "Assets:Rewards:Catalogue")?.boost).toBe(1);
    expect(options.find(option => option.label === "Assets:Rewards:Catalogue")?.detail).toBe("catalogue");
  });

  it("completes directive keywords after a date", async () => {
    const result = await complete("2026-09-02 op");
    expect(result?.options.map(option => option.label)).toEqual(expect.arrayContaining(["open", "note", "balance"]));
  });

  it("harvests currencies from the current journal", async () => {
    const result = await complete([
      "2026-09-01 * \"Cafe\"",
      "  Assets:Bank  -100 INR",
      "  Expenses:Food 100 INR",
      "",
      "2026-09-02 balance Assets:Bank 0 I",
    ].join("\n"));
    expect(result?.options.map(option => option.label)).toContain("INR");
  });

  it("harvests prior payees while typing a transaction", async () => {
    const result = await complete([
      "2026-09-01 * \"Skyline Cafe\" \"Lunch\"",
      "  Assets:Bank -100 INR",
      "  Expenses:Food 100 INR",
      "",
      "2026-09-02 * \"Sky",
    ].join("\n"));
    expect(result?.options.map(option => option.label)).toContain("Skyline Cafe");
  });

  it("offers today's date on explicit completion at an empty line", async () => {
    const result = await complete("", undefined, true);
    expect(result?.options).toEqual([{ label: "2026-09-02", type: "constant", detail: "today" }]);
  });
});
