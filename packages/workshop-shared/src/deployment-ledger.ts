import type { RpcTarget, RpcStub, WorkerEntrypoint } from "cloudflare:workers";
import type { ObservationDescription } from "./gatekeeper.js";

/** One open account in the current user's MilesVault ledger. */
export interface LedgerHoldingAccount {
  account: string;
  currencies: string[];
}

/** One current balance, represented without floating-point loss. */
export interface LedgerHoldingBalance {
  account: string;
  currency: string;
  scale: number;
  balanceScaled: number;
}

/** Minimal read-only snapshot used to personalize Paths to Points. */
export interface CurrentHoldings {
  asOf: number;
  accounts: LedgerHoldingAccount[];
  balances: LedgerHoldingBalance[];
}

/** One canonical journal entry from the current user's live ledger. */
export interface LedgerJournalEntry {
  kind: "txn" | "open" | "close" | "commodity" | "balance" | "price" | "note" | "document" | "event";
  id: number;
  raw_text: string;
  updated_at: number;
}

/** OCC reference owned by the canonical Ledger service. */
export type LedgerEntryRef = {kind: LedgerJournalEntry["kind"]; id: number; expected_updated_at: number};
/** A human editor replacement, checked atomically by the canonical Ledger service. */
export type LedgerEditorInput = {knownIds: LedgerEntryRef[]; buffer: string};
/** Managed editor API; immediate Save is available only on the browser capability. */
export interface LedgerEditorSession extends RpcTarget {
  listEntries(): Promise<{rows: LedgerJournalEntry[]}>;
  completionData(): Promise<{ledgerAccounts: string[]; catalogueAccounts: string[]}>;
  replaceBuffer(input: LedgerEditorInput): Promise<unknown>;
}
/** Narrow read-only capability used by Points outputs. */
export interface LedgerHoldingsSession extends RpcTarget {
  currentHoldings(): Promise<CurrentHoldings>;
}

/** Native operation authority supplied only by Workshop to its trusted deployment adapter. */
export interface LedgerApplicationQueue extends RpcTarget {
  authorizeObservation(description: ObservationDescription): Promise<void>;
  getUsageBudget(): Promise<import("./deployment-usage.js").DeploymentUsageRun | undefined>;
}

/** Private service for deployment-owned Ledger UI and read-only resources, never a vendor. */
export interface DeploymentLedgerApplication extends WorkerEntrypoint {
  openBrowserEditor(storageKey: string, queue: RpcStub<LedgerApplicationQueue>): Promise<LedgerEditorSession>;
  openEditorResource(storageKey: string, queue: RpcStub<LedgerApplicationQueue>): Promise<LedgerEditorSession>;
  openHoldings(storageKey: string, queue: RpcStub<LedgerApplicationQueue>): Promise<LedgerHoldingsSession>;
  getEditorTypes(): Promise<string>;
  getHoldingsTypes(): Promise<string>;
}
