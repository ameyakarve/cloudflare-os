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

/** Read one fixed-schema own data property without executing accessors or enumerating extras.
 * Requires ordinary local/RPC data and intact intrinsics; arbitrary Proxy traps are not bounded.
 */
export function installationData(value: unknown, key: string): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Installation release or snapshot is unavailable.');
  }
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || !Object.hasOwn(descriptor, 'value')) {
    throw new Error('Installation release or snapshot is unavailable.');
  }
  return descriptor.value;
}

/** Bound source text before copying/encoding, reject invalid UTF-16 rather than replacing it. */
export function installationText(value: unknown, max: number, multiline = false): string {
  if (typeof value !== 'string' || !value.length || value.length > max) {
    throw new Error('Installation release or snapshot is unavailable.');
  }
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if ((!multiline && (code < 32 || code === 127)) ||
        (code >= 0xdc00 && code <= 0xdfff)) {
      throw new Error('Installation release or snapshot is unavailable.');
    }
    if (code >= 0xd800 && code <= 0xdbff) {
      const low = value.charCodeAt(++i);
      if (!(low >= 0xdc00 && low <= 0xdfff)) {
        throw new Error('Installation release or snapshot is unavailable.');
      }
    }
  }
  return value;
}

/** Project and validate private publisher data. Only the returned DTO may be stored/rendered.
 * Unknown extras are ignored, never copied; known accessors/inherited fields are rejected.
 */
export function validateDeploymentInstallRelease(input: DeploymentInstallRelease): DeploymentInstallRelease {
  const text = (key: string, max: number) => installationText(installationData(input, key), max);
  const protocol = installationData(input, 'protocol');
  const factory = installationData(input, 'factory');
  const hostRuntime = installationData(input, 'hostRuntime');
  if (protocol !== 1 || factory !== 'doctor-controls-v1' || hostRuntime !== 'private-install-v1') {
    throw new Error('Installation release is unavailable.');
  }
  const value: DeploymentInstallRelease = {
    releaseId: text('releaseId', 128),
    protocol,
    blueprintId: text('blueprintId', 128),
    artifact: text('artifact', 200),
    uiSha256: text('uiSha256', 64),
    factory,
    hostRuntime,
    title: text('title', 100),
    explanation: text('explanation', 1200),
    confirmLabel: text('confirmLabel', 100),
  };
  if (!/^[a-z0-9][a-z0-9.-]+$/.test(value.releaseId) ||
      !/^[a-z0-9][a-z0-9.-]+$/.test(value.blueprintId) ||
      value.releaseId === value.blueprintId || !/^[a-f0-9]{64}$/.test(value.uiSha256)) {
    throw new Error('Installation release is unavailable.');
  }
  return value;
}

/** Stable descriptor digest, including every rendered field and compatibility selector. */
export async function deploymentInstallReleaseDigest(input: DeploymentInstallRelease): Promise<string> {
  const value = validateDeploymentInstallRelease(input);
  const bytes = new TextEncoder().encode(JSON.stringify([value.releaseId, value.protocol,
    value.blueprintId, value.artifact, value.uiSha256, value.factory, value.hostRuntime,
    value.title, value.explanation, value.confirmLabel]));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}
