/** Private frozen snapshot transport and validation; not exposed on AuthenticatedApi. */
export { encodeDeploymentInstallSnapshot, validateDeploymentInstallSnapshot } from './deployment-install-snapshot.js';
/** Private frozen snapshot DTOs. */
export type { DeploymentInstallSnapshot, DeploymentInstallSnapshotEnvelope } from './deployment-install-snapshot.js';

/** Bounded deployment-owned text and executable identity, never catalog/user-authored metadata. */
export interface DeploymentInstallRelease {
  /** Immutable release identity. A changed artifact needs a new identity. */
  releaseId: string;
  /** Installation wire protocol; this slice accepts only version 1. */
  protocol: 1;
  /** Distinct new blueprint identity, not a catalog revision of an existing app. */
  blueprintId: string;
  /** Publisher-owned source/artifact identity, not a fetchable URL. */
  artifact: string;
  /** SHA-256 of UTF-8 raw client source, before the host runtime. */
  uiSha256: string;
  /** Exact private versioned factory ABI; never a caller-selected method. */
  factory: 'doctor-controls-v1';
  /** Minimum marker-aware installer/host ABI. Old kernel rollback is not supported. */
  hostRuntime: 'private-install-v1';
  /** Plain-text title rendered by trusted host chrome. */
  title: string;
  /** Plain-text explanation, including effects and limits. */
  explanation: string;
  /** Plain-text deliberate confirmation label. */
  confirmLabel: string;
}

/** Prepared review data; this token conveys no Doctor operation or approval authority. */
export interface DeploymentInstallPreparation {
  /** Short-lived identifier usable only on the originating authenticated root. */
  attempt: string;
  /** Fixed server-clock expiry; retry never extends it. */
  expiresAt: number;
  /** Auth-root-derived display identity. */
  principal: string;
  /** Exact descriptor reviewed for this attempt. */
  release: DeploymentInstallRelease;
}

/** Exact new installation navigation target; returned only after readiness publication. */
export interface DeploymentInstallResult {
  /** New workspace; never an upgraded existing workspace. */
  workspaceId: string;
  /** Exact workpiece, not a default-selection hint. */
  workpieceId: number;
  /** Immutable installed release. */
  releaseId: string;
}

/** Validate a private publisher response before storing or rendering any of its text. */
export function validateDeploymentInstallRelease(value: DeploymentInstallRelease): void {
  const keys = ['releaseId', 'protocol', 'blueprintId', 'artifact', 'uiSha256', 'factory',
    'hostRuntime', 'title', 'explanation', 'confirmLabel'];
  const text = (v: unknown, max: number) => typeof v === 'string' && v.length > 0 &&
    v.length <= max && !Array.from(v).some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127);
  const id = (v: unknown) => text(v, 128) && /^[a-z0-9][a-z0-9.-]+$/.test(v as string);
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).length !== keys.length || Object.keys(value).some(key => !keys.includes(key)) ||
      !id(value.releaseId) || !id(value.blueprintId) ||
      value.releaseId === value.blueprintId || !text(value.artifact, 200) ||
      !/^[a-f0-9]{64}$/.test(value.uiSha256) || value.protocol !== 1 ||
      value.factory !== 'doctor-controls-v1' || value.hostRuntime !== 'private-install-v1' ||
      !text(value.title, 100) || !text(value.explanation, 1200) || !text(value.confirmLabel, 100)) {
    throw new Error('Installation release is unavailable.');
  }
}

/** Stable descriptor digest, including every rendered field and compatibility selector. */
export async function deploymentInstallReleaseDigest(value: DeploymentInstallRelease): Promise<string> {
  validateDeploymentInstallRelease(value);
  const bytes = new TextEncoder().encode(JSON.stringify([value.releaseId, value.protocol,
    value.blueprintId, value.artifact, value.uiSha256, value.factory, value.hostRuntime,
    value.title, value.explanation, value.confirmLabel]));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}
