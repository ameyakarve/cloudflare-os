import type { RpcStub } from 'cloudflare:workers';
import type { LedgerApplicationQueue } from './deployment-ledger.js';
import type { DoctorReadSession } from './deployment-doctor.js';
import type { DoctorCanonicalControlApi, DoctorReadPage } from './os-doctor.generated.js';

/** Canonical private types, generated transitively from the actual DoctorDO methods. */
export type { DoctorCanonicalReadApi, DoctorCanonicalControlApi, DoctorUsageFacet, DoctorDismissAuthority, DoctorDismissRequest } from './os-doctor.generated.js';

/** Kernel-only owner/identity/epoch guard. Never offered to authored source or agents. */
export interface DoctorHumanQueue extends LedgerApplicationQueue {
  /** Revalidate the authenticated owner, private binding identity and host Stop epoch. */
  checkActive(): Promise<void>;
}
/** Exact materialized evidence reviewed in the immutable first-party UI, not journal authority. */
export type DoctorDismissReview = { token: string; owner: string; page: DoctorReadPage };
/** First-party browser capability only. Ordinary Doctor resources remain READ-only. */
export interface DoctorControlSession extends DoctorReadSession {
  /** Explicit bounded scan; reloading materialized results never calls this. */
  recheck(): ReturnType<DoctorCanonicalControlApi['os_doctor_recheck']>;
  /** Read exact evidence and retain its OCC revision for a separate human decision. */
  reviewDismiss(id: string): Promise<DoctorDismissReview>;
  /** Confirm only the unexpired review token minted in this UI session. */
  confirmDismiss(token: string): ReturnType<DoctorCanonicalControlApi['os_doctor_dismiss']>;
  /** Revoke pending review and work; work drains before its owning caller finishes the root. */
  stop(): Promise<void>;
}
/** SHA-256 of the exact deployment UI source, before the standard host runtime is prepended. */
export async function doctorControlUiHash(jsCode: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(jsCode));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

/** Private factory extension, intentionally separate from the immutable READ resource. */
export interface DoctorControlFactory {
  /** Owner identity is supplied by authenticated kernel ingress, never by browser code. */
  openDoctorControls(key: string, queue: RpcStub<DoctorHumanQueue>): Promise<DoctorControlSession>;
  /** Versioned factory: reject unless the session implementation supports these exact UI bytes. */
  openDoctorControlsV1(key: string, queue: RpcStub<DoctorHumanQueue>, uiSha256: string): Promise<DoctorControlSession>;
  /** Deployment-owned immutable UI bytes, never loaded from a saved Gadget source/history. */
  getDoctorControlUi(): Promise<{jsCode: string}>;
}
