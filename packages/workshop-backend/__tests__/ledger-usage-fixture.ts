import {expect} from 'vitest';
import type {OsAcquisitionTicketV2, OsUsagePolicyApi, OsUsageRequest} from '@gadgets/workshop-shared/os-usage.generated';

/** Scripted policy boundary for the Ledger facet test, NOT a replacement accounting engine.
 * Real User/Overseer journals perform the paired handoff; the canonical M suites cover quota.
 */
export function ledgerUsageFixture(key: string, ownerId: string) {
  const namespace = crypto.randomUUID();
  const slots = Array.from({length: 20}, () => ({generation: 0n,
    record: undefined as {ticket: OsAcquisitionTicketV2; state: 'pending' | 'active'; expiresAt: number} | undefined}));
  const events: string[] = [];
  const receipts = new Map<string, string>();
  const chargedRuns = new Set<string>();
  function slotFor(actualKey: string, ticket: OsAcquisitionTicketV2) {
    expect(actualKey).toBe(key);
    expect(ticket).toMatchObject({protocol: 2, namespace, ownerId});
    expect(Number.isInteger(ticket.slot) && ticket.slot >= 0 && ticket.slot < 20).toBe(true);
    const slot = slots[ticket.slot];
    expect(ticket.generation).toBe(String(slot.generation));
    expect(ticket.acquireBy).toBeGreaterThan(ticket.issuedAt);
    expect(ticket.acquireBy).toBeLessThanOrEqual(ticket.issuedAt + 5000);
    return slot;
  }
  function active(actualKey: string, runId: string) {
    expect(actualKey).toBe(key);
    const record = slots.find(slot => slot.record?.ticket.runId === runId)?.record;
    expect(record?.state).toBe('active');
    expect(record!.expiresAt).toBeGreaterThan(Date.now());
    return record!;
  }
  const policy = {
    async readAcquisitionSlotsV2(actualKey: string) {
      expect(actualKey).toBe(key);
      return {protocol: 2 as const, namespace, slotCount: 20 as const,
        features: ['pending-activation', 'durable-fence', 'fixed-expiry'] as const,
        slots: slots.map((slot, i) => ({slot: i, generation: String(slot.generation), state: slot.record?.state ?? 'free' as const}))};
    },
    async beginAcquisitionV2(actualKey: string, ticket: OsAcquisitionTicketV2) {
      const slot = slotFor(actualKey, ticket);
      expect(ticket.acquireBy).toBeGreaterThan(Date.now());
      expect(slot.record).toBeUndefined();
      slot.record = {ticket: structuredClone(ticket), state: 'pending', expiresAt: ticket.issuedAt + 10_000};
      events.push('begin');
      return {protocol: 2 as const, state: 'pending' as const, runId: ticket.runId, expiresAt: slot.record.expiresAt};
    },
    async activateAcquisitionV2(actualKey: string, ticket: OsAcquisitionTicketV2) {
      const slot = slotFor(actualKey, ticket);
      expect(slot.record?.ticket).toEqual(ticket);
      expect(slot.record?.state).toBe('pending');
      expect(ticket.acquireBy).toBeGreaterThan(Date.now());
      slot.record!.state = 'active'; events.push('activate');
      return {protocol: 2 as const, state: 'active' as const, runId: ticket.runId, expiresAt: slot.record!.expiresAt};
    },
    async getRunGrant(actualKey: string, runId: string) {
      const record = active(actualKey, runId);
      return {allowed: true as const, runId, expiresAt: record.expiresAt};
    },
    async reserve(actualKey: string, runId: string, requestId: string, usage: OsUsageRequest) {
      active(actualKey, runId);
      expect(usage).toEqual({capabilityCalls: 1});
      const payload = JSON.stringify({runId, usage});
      if (receipts.has(requestId)) expect(receipts.get(requestId)).toBe(payload);
      else {
        // Exactly one observed read, never a permissive quota bypass.
        expect(chargedRuns.has(runId)).toBe(false);
        chargedRuns.add(runId); receipts.set(requestId, payload); events.push('reserve');
      }
      return {allowed: true as const};
    },
    async settleTokens() { throw new Error('Ledger fixture does not exercise token settlement'); },
    async cancelAcquisitionV2(actualKey: string, ticket: OsAcquisitionTicketV2) {
      const slot = slotFor(actualKey, ticket);
      expect(slot.record?.ticket).toEqual(ticket);
      slot.record = undefined; slot.generation++; events.push('cancel');
      return {protocol: 2 as const, state: 'terminal' as const};
    },
  } satisfies Pick<OsUsagePolicyApi, 'readAcquisitionSlotsV2' | 'beginAcquisitionV2' |
    'activateAcquisitionV2' | 'getRunGrant' | 'reserve' | 'settleTokens' | 'cancelAcquisitionV2'>;
  return {policy, events, assertDrained() { expect(slots.every(slot => !slot.record)).toBe(true); }};
}
