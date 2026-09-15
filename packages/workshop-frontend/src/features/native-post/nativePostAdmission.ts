import {
  decodeNativeHumanReviewV1, encodeNativeHumanReviewV1, NATIVE_POST_CONTRACT_DIGEST,
  verifyNativeHumanReviewDigestsV1,
} from '@gadgets/workshop-shared/os-native-post-schema.generated'
import type { NativePostOwnerCandidate } from '@gadgets/workshop-shared/deployment-native-post'

export const admitReview = async (input: unknown, rendererPin: string, candidate: NativePostOwnerCandidate) => {
  const admitted = decodeNativeHumanReviewV1(encodeNativeHumanReviewV1(input))
  const e = admitted.response.evidence
  if (e.workspaceId !== candidate.workspaceId || e.workpieceId !== candidate.workpieceId ||
    e.deadline <= Date.now() || e.issuedAt > Date.now() ||
    !await verifyNativeHumanReviewDigestsV1(admitted.response, NATIVE_POST_CONTRACT_DIGEST, rendererPin)) {
    throw new Error('Unsupported or expired review')
  }
  return admitted
}

export const nativePostEnabled = () => import.meta.env.VITE_NATIVE_POST_HUMAN_V2 === 'true' &&
  /^[a-f0-9]{64}$/.test(import.meta.env.VITE_NATIVE_POST_RENDERER_ARTIFACT_DIGEST ?? '')
