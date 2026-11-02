/**
 * Client parts that differ between the DSH releases Next and Beta follow. Like src/upstream-family.ts, this file is a
 * declared difference between the variants (scripts/verify-desktop-variants.mjs); client modules import these names
 * from here so that the rest of the client stays mirrored.
 */
import type { ReactNode } from 'react'
import type { Context } from '@deepseek-ai/cordis'

// dsh 0.2.1 ships no official Computer Use bundle, so the Computer Use (Next) page has no row for it.
export const installOfficialComputerUseStyles: (() => () => void) | undefined = undefined
export const useOfficialComputerUse: ((options: {
  context: Context
  t: (chinese: string, english: string) => string
  page: boolean
  revision: number
  onError(message: string): void
  onNotice(message: string): void
  onChanged(): void
}) => { row: ReactNode; componentCount(commandActive: boolean): string } | undefined) | undefined = undefined
