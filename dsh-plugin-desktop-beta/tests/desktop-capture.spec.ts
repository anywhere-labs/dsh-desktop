/**
 * Unit coverage for the desktop screen-capture seam. The Electron launcher
 * provides the real implementation; here we exercise the headless/test memory
 * implementation and its optional-degradation contract.
 */

import { describe, expect, it } from 'vitest'
import { createMemoryCapture } from '../src/desktop-capture.ts'

describe('createMemoryCapture', () => {
  it('returns the injected data URL', async () => {
    const capture = createMemoryCapture('data:image/png;base64,AA')
    expect(await capture.captureScreen()).toBe('data:image/png;base64,AA')
  })

  it('returns undefined when no image was injected', async () => {
    const capture = createMemoryCapture()
    expect(await capture.captureScreen()).toBeUndefined()
  })
})
