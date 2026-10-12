import { describe, expect, it } from 'vitest'
import { electronBuilderEnvironment } from '../scripts/electron-builder-environment.ts'

describe('Electron Builder resource environment', () => {
  it('selects bounded dependency traversal without mutating the caller', () => {
    const source = { SAFE_VALUE: 'kept', NODE_OPTIONS: '--enable-source-maps' }

    expect(electronBuilderEnvironment(source)).toEqual({
      SAFE_VALUE: 'kept',
      DSH_ELECTRON_BUILDER_TRAVERSAL_ONLY: '1',
      NODE_OPTIONS: '--enable-source-maps',
    })
    expect(source).toEqual({ SAFE_VALUE: 'kept', NODE_OPTIONS: '--enable-source-maps' })
  })

  it('forces traversal when a caller tries to disable the product safeguard', () => {
    expect(electronBuilderEnvironment({ DSH_ELECTRON_BUILDER_TRAVERSAL_ONLY: '0' }))
      .toEqual({ DSH_ELECTRON_BUILDER_TRAVERSAL_ONLY: '1' })
  })
})
