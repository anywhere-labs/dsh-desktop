/** The Installed view's update checks: one package's registry lookups at a time, and a newer request replaces a queued one. */
import { useCallback, useRef, useState } from 'react'
import type { MarketInstallationUpdateCheck } from '../../api-types.js'
import { readMarketInstallationUpdate } from '../api.js'
import type { UpdateChecks } from './model.js'

/**
 * Keep the update check state of the market surface.
 * @returns the checks to render, the refs the surface reconciles and aborts, and the queue entry point.
 */
export function useUpdateChecks() {
  const [updateChecks, setUpdateChecks] = useState<UpdateChecks>({})
  const updateCheckRequest = useRef<AbortController>()
  const updateChecksRef = useRef<UpdateChecks>({})
  const updateQueue = useRef<{ readonly packageName: string; readonly seq: number }[]>([])
  const updateCheckSeq = useRef(0)

  const commitUpdateChecks = useCallback((next: UpdateChecks) => {
    updateChecksRef.current = next
    setUpdateChecks(next)
  }, [])

  /** Run the queued update checks one after another, so at most one package's registry lookups run at a time. */
  const drainUpdateChecks = useCallback(async () => {
    if (updateCheckRequest.current !== undefined) return
    const request = new AbortController()
    updateCheckRequest.current = request
    try {
      for (let next = updateQueue.current.shift(); next !== undefined; next = updateQueue.current.shift()) {
        const { packageName, seq } = next
        const queued = updateChecksRef.current[packageName]
        if (queued?.phase !== 'checking' || queued.seq !== seq) continue
        let check: MarketInstallationUpdateCheck
        try {
          check = (await readMarketInstallationUpdate(packageName, request.signal)).check
        } catch (cause) {
          if (request.signal.aborted) return
          // A refused or lost request reads as a check no registry answered.
          check = { status: 'failed', problem: 'unknown', reason: cause instanceof Error ? cause.message : '' }
        }
        if (request.signal.aborted) return
        const current = updateChecksRef.current[packageName]
        if (current?.phase === 'checking' && current.seq === seq) {
          commitUpdateChecks({ ...updateChecksRef.current, [packageName]: { phase: 'done', check } })
        }
      }
    } finally {
      if (updateCheckRequest.current === request) updateCheckRequest.current = undefined
    }
  }, [commitUpdateChecks])

  /** Check packages without a check; `force` checks the others again, replacing a check still queued or in flight. */
  const queueUpdateChecks = useCallback((packageNames: readonly string[], force: boolean) => {
    let next = updateChecksRef.current
    for (const packageName of packageNames) {
      if (!force && next[packageName] !== undefined) continue
      updateCheckSeq.current += 1
      next = { ...next, [packageName]: { phase: 'checking', seq: updateCheckSeq.current } }
      updateQueue.current.push({ packageName, seq: updateCheckSeq.current })
    }
    if (next === updateChecksRef.current) return
    commitUpdateChecks(next)
    void drainUpdateChecks()
  }, [commitUpdateChecks, drainUpdateChecks])

  return { updateChecks, updateChecksRef, updateCheckRequest, commitUpdateChecks, queueUpdateChecks }
}
