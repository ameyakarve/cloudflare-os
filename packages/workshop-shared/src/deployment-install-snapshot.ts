import { deploymentInstallReleaseDigest, type DeploymentInstallRelease } from './deployment-install.js';

/** Bounded plain-file transport from the private frozen publisher, never a catalog archive or URL. */
export interface DeploymentInstallSnapshot {
  /** Digest of the complete reviewed descriptor, including its display text. */
  releaseDigest: string;
  /** Exact immutable blueprint identity. */
  blueprintId: string;
  /** Exact workspace title from the frozen blueprint. */
  title: string;
  /** Declared output identity; conveys no binding authority. */
  output: { id: string; title: string };
  /** Fixed inert bootstrap files. No bindings, owner selectors or archive extensions. */
  files: { 'README.md': string; 'client.js': string; 'server.js': string };
}

/** Private transport envelope. The publisher must pin this digest in reviewed generated source. */
export interface DeploymentInstallSnapshotEnvelope {
  /** Frozen plain-file content. */
  snapshot: DeploymentInstallSnapshot;
  /** SHA-256 of the canonical snapshot encoding, not a mutable catalog checksum. */
  sha256: string;
}

function exactKeys(value: unknown, keys: string[]): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).length === keys.length && Object.keys(value).every(key => keys.includes(key));
}

/** Canonical bounded encoding. Reject unexpected selectors rather than silently stripping them. */
export function encodeDeploymentInstallSnapshot(value: DeploymentInstallSnapshot): Uint8Array {
  const text = (v: unknown, max: number) => typeof v === 'string' && v.length > 0 &&
    v.length <= max && !Array.from(v).some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127);
  if (!exactKeys(value, ['releaseDigest', 'blueprintId', 'title', 'output', 'files']) ||
      typeof value.releaseDigest !== 'string' || !/^[a-f0-9]{64}$/.test(value.releaseDigest) ||
      !text(value.blueprintId, 128) || !text(value.title, 100) ||
      !exactKeys(value.output, ['id', 'title']) || !text(value.output.id, 128) || !text(value.output.title, 100) ||
      !exactKeys(value.files, ['README.md', 'client.js', 'server.js']) ||
      Object.values(value.files).some(file => typeof file !== 'string' || !file.length || file.length > 65_536)) {
    throw new Error('Installation snapshot is unavailable.');
  }
  const bytes = new TextEncoder().encode(JSON.stringify([value.releaseDigest, value.blueprintId,
    value.title, value.output.id, value.output.title, value.files['README.md'],
    value.files['client.js'], value.files['server.js']]));
  if (bytes.byteLength > 196_608) throw new Error('Installation snapshot is unavailable.');
  return bytes;
}

/** Validate trusted transport and its exact reviewed descriptor before any workspace allocation.
 * This checks integrity, not publisher authority: an attacker-supplied hash is not an allowlist.
 */
export async function validateDeploymentInstallSnapshot(
  envelope: DeploymentInstallSnapshotEnvelope, release: DeploymentInstallRelease,
): Promise<DeploymentInstallSnapshot> {
  if (!exactKeys(envelope, ['snapshot', 'sha256']) || typeof envelope.sha256 !== 'string' ||
      !/^[a-f0-9]{64}$/.test(envelope.sha256)) throw new Error('Installation snapshot is unavailable.');
  // Copy before the first await so a local caller cannot change bytes during validation.
  const bytes = encodeDeploymentInstallSnapshot(envelope.snapshot);
  const snapshot = structuredClone(envelope.snapshot);
  const expectedHash = envelope.sha256;
  const releaseId = release.blueprintId;
  const releaseDigest = await deploymentInstallReleaseDigest(release);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  if (hash !== expectedHash || snapshot.releaseDigest !== releaseDigest || snapshot.blueprintId !== releaseId) {
    throw new Error('Installation snapshot is unavailable.');
  }
  return snapshot;
}
