import { deploymentInstallReleaseDigest, installationData, installationText,
  validateDeploymentInstallRelease, type DeploymentInstallRelease } from './deployment-install.js';

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

function projectSnapshot(input: unknown): DeploymentInstallSnapshot {
  const text = (object: unknown, key: string, max: number, multiline = false) =>
    installationText(installationData(object, key), max, multiline);
  const output = installationData(input, 'output');
  const files = installationData(input, 'files');
  const value = {
    releaseDigest: text(input, 'releaseDigest', 64),
    blueprintId: text(input, 'blueprintId', 128),
    title: text(input, 'title', 100),
    output: { id: text(output, 'id', 128), title: text(output, 'title', 100) },
    files: {
      'README.md': text(files, 'README.md', 65_536, true),
      'client.js': text(files, 'client.js', 65_536, true),
      'server.js': text(files, 'server.js', 65_536, true),
    },
  };
  if (!/^[a-f0-9]{64}$/.test(value.releaseDigest)) throw new Error('Installation snapshot is unavailable.');
  return value;
}

// Only receives the detached projection. Count canonical JSON UTF-8 bytes before creating
// the JSON string or encoded copy, including escaping expansion of file control characters.
function encodeOwned(value: DeploymentInstallSnapshot): Uint8Array {
  const fields = [value.releaseDigest, value.blueprintId, value.title, value.output.id,
    value.output.title, value.files['README.md'], value.files['client.js'], value.files['server.js']];
  let size = 2 + fields.length * 2 + fields.length - 1;
  for (const field of fields) {
    for (let i = 0; i < field.length; i++) {
      const code = field.charCodeAt(i);
      if (code === 34 || code === 92 || code === 8 || code === 9 || code === 10 || code === 12 || code === 13) size += 2;
      else if (code < 32) size += 6;
      else if (code < 128) size++;
      else if (code < 2048) size += 2;
      else if (code >= 0xd800 && code <= 0xdbff) { size += 4; i++; }
      else size += 3;
      if (size > 196_608) throw new Error('Installation snapshot is unavailable.');
    }
  }
  return new TextEncoder().encode(JSON.stringify(fields));
}

/** Canonical bounded encoding of a fixed-schema own-data projection.
 * Unknown DTO extras (including path/binding selectors) are ignored, never accepted as files
 * or authority. Known accessors/inherited fields fail. No caller graph is cloned/enumerated.
 * Ordinary data and intact intrinsics are required; arbitrary Proxy traps are not bounded.
 */
export function encodeDeploymentInstallSnapshot(value: DeploymentInstallSnapshot): Uint8Array {
  return encodeOwned(projectSnapshot(value));
}

/** Validate trusted transport and its exact reviewed descriptor before any workspace allocation.
 * This checks integrity, not publisher authority: an attacker-supplied hash is not an allowlist.
 */
export async function validateDeploymentInstallSnapshot(
  envelope: DeploymentInstallSnapshotEnvelope, release: DeploymentInstallRelease,
): Promise<DeploymentInstallSnapshot> {
  const expectedHash = installationText(installationData(envelope, 'sha256'), 64);
  if (!/^[a-f0-9]{64}$/.test(expectedHash)) throw new Error('Installation snapshot is unavailable.');
  // Observe each known caller property once, synchronously, before hashing can yield.
  const snapshot = projectSnapshot(installationData(envelope, 'snapshot'));
  const descriptor = validateDeploymentInstallRelease(release);
  const bytes = encodeOwned(snapshot);
  const releaseId = descriptor.blueprintId;
  const releaseDigest = await deploymentInstallReleaseDigest(descriptor);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  if (hash !== expectedHash || snapshot.releaseDigest !== releaseDigest || snapshot.blueprintId !== releaseId) {
    throw new Error('Installation snapshot is unavailable.');
  }
  return snapshot;
}
