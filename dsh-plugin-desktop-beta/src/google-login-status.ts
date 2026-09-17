/** Phases the panel renders for the Chrome Google login. */
export type GoogleLoginPhase =
  | 'idle'
  | 'launching'
  | 'waiting'
  | 'importing'
  | 'signed-in'
  | 'failed'
  | 'cancelled'

/** Snapshot of the Chrome Google login the panel and Host share. */
export interface GoogleLoginStatus {
  readonly phase: GoogleLoginPhase
  /** Failure code when `phase` is `failed`. */
  readonly error?: string
  /** Unix milliseconds of the last successful import. */
  readonly importedAt?: number
  /** Number of Google cookies last written into the guest profile. */
  readonly imported?: number
}
