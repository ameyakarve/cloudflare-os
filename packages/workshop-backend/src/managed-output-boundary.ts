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
    gatekeeper: {creationSpec?: {type?: string, vendorId?: string}} | undefined): boolean {
  return gatekeeper?.creationSpec?.type === "ambient" &&
      gatekeeper.creationSpec.vendorId?.toLowerCase() === "ledger";
}
