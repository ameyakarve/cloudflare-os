import {
  autocompletion,
  type Completion,
  type CompletionContext,
  type CompletionResult,
  type CompletionSource,
} from "@codemirror/autocomplete";
import { LRLanguage, LanguageSupport, syntaxTree } from "@codemirror/language";
import { styleTags, tags } from "@lezer/highlight";
import { parser as beancountParser } from "lezer-beancount";

export type BeancountCompletionData = {
  ledgerAccounts: string[];
  catalogueAccounts: string[];
};

export const beancountLanguage = new LanguageSupport(LRLanguage.define({
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

const directiveKeywords = ["note", "balance", "open", "close", "pad", "price", "event", "document"];
const accountRoots = ["Assets:", "Liabilities:", "Expenses:", "Income:", "Equity:"];

function harvest(ctx: CompletionContext): {
  accounts: Set<string>;
  payees: Set<string>;
  currencies: Set<string>;
} {
  const accounts = new Set<string>();
  const payees = new Set<string>();
  const currencies = new Set<string>();
  syntaxTree(ctx.state).iterate({
    enter(node) {
      if (node.name === "Account") accounts.add(ctx.state.sliceDoc(node.from, node.to));
      else if (node.name === "Currency") currencies.add(ctx.state.sliceDoc(node.from, node.to));
      else if (node.name === "String") {
        const parent = node.node.parent;
        if (parent && (parent.name === "Transaction" || parent.name === "DatedDirective")) {
          const raw = ctx.state.sliceDoc(node.from, node.to);
          if (raw.length > 2) payees.add(raw.slice(1, -1));
        }
      }
    },
  });
  return { accounts, payees, currencies };
}

function accountOptions(
  ctx: CompletionContext,
  typedFrom: number,
  data: BeancountCompletionData,
): CompletionResult {
  const { accounts: localAccounts } = harvest(ctx);
  const ledger = new Set(data.ledgerAccounts);
  const seen = new Set<string>();
  const options: Completion[] = [];
  const push = (label: string, boost: number, detail?: string) => {
    if (!label || seen.has(label)) return;
    seen.add(label);
    options.push({ label, type: "variable", boost, ...(detail ? { detail } : {}) });
  };
  for (const account of localAccounts) push(account, 3);
  for (const account of ledger) push(account, 2);
  for (const account of data.catalogueAccounts) push(account, 1, "catalogue");
  for (const root of accountRoots) push(root, 0);
  return { from: typedFrom, options, validFor: /^[A-Za-z0-9:-]*$/ };
}

/** Exact completion behavior used by the production MilesVault journal editor. */
export function createBeancountCompletionSource(
  data: BeancountCompletionData,
  today: () => string = () => new Date().toISOString().slice(0, 10),
): CompletionSource {
  return (ctx: CompletionContext): CompletionResult | null => {
    const tree = syntaxTree(ctx.state);
    const node = tree.resolveInner(ctx.pos, -1);
    const line = ctx.state.doc.lineAt(ctx.pos);
    const before = ctx.state.sliceDoc(line.from, ctx.pos);

    if (node.name === "Account") return accountOptions(ctx, node.from, data);
    const accountStart = before.match(/(?:^\s+|(?:open|close|note|balance|pad)\s+)([A-Za-z][A-Za-z0-9:-]*)?$/);
    if (accountStart) {
      const typed = accountStart[1] ?? "";
      if (ctx.explicit || typed.length > 0) return accountOptions(ctx, ctx.pos - typed.length, data);
    }

    const keyword = before.match(/^\d{4}-\d{2}-\d{2}\s+([a-z]*)$/);
    if (keyword) {
      return {
        from: ctx.pos - (keyword[1]?.length ?? 0),
        options: directiveKeywords.map(label => ({
          label,
          type: "keyword",
          boost: label === "note" ? 1 : 0,
        })),
        validFor: /^[a-z]*$/,
      };
    }

    if (node.name === "Currency" || /\s-?[\d,.]+\s+[A-Z]*$/.test(before)) {
      const { currencies } = harvest(ctx);
      const typed = before.match(/[A-Z][A-Z0-9-]*$/)?.[0] ?? "";
      if (currencies.size === 0) return null;
      return {
        from: ctx.pos - typed.length,
        options: [...currencies].map(label => ({ label, type: "constant" })),
        validFor: /^[A-Z0-9-]*$/,
      };
    }

    if (node.name === "String" || /^\d{4}-\d{2}-\d{2}\s+\*\s+"[^"]*$/.test(before)) {
      const { payees } = harvest(ctx);
      const typed = before.match(/"([^"]*)$/)?.[1] ?? "";
      if (payees.size === 0) return null;
      return {
        from: ctx.pos - typed.length,
        options: [...payees].map(label => ({ label, type: "text" })),
        validFor: /^[^"]*$/,
      };
    }

    if (ctx.explicit && /^\s*$/.test(before)) {
      return { from: line.from, options: [{ label: today(), type: "constant", detail: "today" }] };
    }
    return null;
  };
}

export function beancountCompletion(data: BeancountCompletionData) {
  return autocompletion({
    override: [createBeancountCompletionSource(data)],
    activateOnTyping: true,
    maxRenderedOptions: 12,
  });
}
