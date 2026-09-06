/** Small, pure policy predicates for the managed-output capability boundary. */

export function exposeManagedGadgetBindingsToAgent(
    gadget: {systemOutput?: "ledger"}): boolean {
  return gadget.systemOutput === undefined;
}

export function exposeGatekeeperToAgent(
    gatekeeper: {systemResource?: unknown} | undefined): boolean {
  return !!gatekeeper && gatekeeper.systemResource === undefined;
}

export function allowActionInPrivateLedgerWorkspace(
    gatekeeper: {
      creationSpec?: {type?: string, vendorId?: string},
      resourceUrl?: string,
    } | undefined): boolean {
  // An accepted request from an older chat creates an ordinary resource connection even when it
  // uses the same authenticated, user-scoped Ledger account as the ambient capability.
  return gatekeeper?.creationSpec?.vendorId?.toLowerCase() === "ledger" &&
      gatekeeper.resourceUrl?.replace(/\/+$/, "") === "https://milesvault.com/ledger/current";
}
