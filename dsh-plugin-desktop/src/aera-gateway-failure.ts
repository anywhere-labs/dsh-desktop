/** Finite owner-safe projection for Aera Gateway failures classified as AUTH by DSH. */
export function aeraGatewayAuthFailureMessage(message: string): string | null {
  if (message.includes('provider_execution_unauthorized') || message.includes('PROVIDER_EXECUTION_UNAUTHORISED')) {
    return 'Aera Gateway authentication is required.'
  }
  if (message.includes('PROVIDER_EXECUTION_FORBIDDEN')) {
    return 'Aera Gateway execution is not authorised for this runtime Session.'
  }
  if (message.includes('PROVIDER_DISABLED') || message.includes('PROVIDER_LOCKED') || message.includes('PROVIDER_DRAINING')) {
    return 'Aera Gateway provider execution is disabled.'
  }
  if (message.includes('SENTINEL_POLICY_UNAVAILABLE') || message.includes('CURRENT_AUTHORITY_UNAVAILABLE')) {
    return 'Aera Gateway governance is temporarily unavailable.'
  }
  if (message.includes('SENTINEL_DENIED')) {
    return 'Aera Gateway governance policy denied this request.'
  }
  return null
}
