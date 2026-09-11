import type { RpcTarget, RpcStub, WorkerEntrypoint } from 'cloudflare:workers';
import type { LedgerApplicationQueue } from './deployment-ledger.js';
import type { DoctorControlFactory } from './deployment-doctor-controls.js';
import type { DoctorCanonicalReadApi } from './os-doctor.generated.js';

/** Materialized findings only; no scan, repair, dismissal, SQL or journal authority. */
export interface DoctorReadSession extends RpcTarget, DoctorCanonicalReadApi {}

/** Private deployment service. Owner keys come only from authenticated kernel ingress. */
export interface DeploymentDoctorApplication extends WorkerEntrypoint, DoctorControlFactory {
  /** Mint an exact-owner read capability; never a browser-supplied identity. */
  openDoctor(storageKey: string, queue: RpcStub<LedgerApplicationQueue>): Promise<DoctorReadSession>;
  /** Sandbox declarations derived from the single shared canonical artifact. */
  getDoctorTypes(): Promise<string>;
}
