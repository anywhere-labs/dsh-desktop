import type { ArtifactRef, VerificationResult } from '../contracts/index.js'

export function verifyArtifacts(artifacts: readonly ArtifactRef[], businessAccepted = true): VerificationResult {
  const outputValid = artifacts.length > 0 && artifacts.every(artifact => artifact.valid)
  return {
    process: 'PROCESS_EXITED', output: outputValid ? 'OUTPUT_VALID' : 'OUTPUT_MISSING',
    business: businessAccepted && outputValid ? 'BUSINESS_ACCEPTED' : 'BUSINESS_PENDING',
    delivery: businessAccepted && outputValid ? 'DELIVERED' : 'DELIVERY_PENDING',
    reasons: outputValid ? [] : ['no valid artifact was produced'],
  }
}
