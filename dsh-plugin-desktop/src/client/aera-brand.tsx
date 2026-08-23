/** AERA-owned brand occupants for upstream-declared shell slots. */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { AERA_CODE_BRAND_ASSET_PATH } from '../aera-brand-contract.ts'
import { AERA_CODE_PRODUCT } from '../product-brand.ts'

function AeraBrandMark({ size }: { readonly size: number }): JSX.Element {
  return <img
    alt=""
    aria-hidden="true"
    src={AERA_CODE_BRAND_ASSET_PATH}
    width={size}
    height={size}
    style={{ display: 'block', objectFit: 'contain' }}
  />
}

function AeraBrandName(): JSX.Element {
  return <span style={{ whiteSpace: 'nowrap', fontWeight: 650, letterSpacing: '-0.01em' }}>
    {AERA_CODE_PRODUCT.productName}
  </span>
}

/** Replace upstream visual identity without changing its shell or agent runtime. */
export function applyAeraBrand(ctx: ClientContext): void {
  ctx.effect(() => {
    const applyTitle = (): void => {
      if (document.title !== AERA_CODE_PRODUCT.productName) document.title = AERA_CODE_PRODUCT.productName
    }
    applyTitle()
    const observer = new MutationObserver(applyTitle)
    observer.observe(document.head, { childList: true, subtree: true, characterData: true })
    return () => { observer.disconnect() }
  }, 'aera-code: native document title')

  ctx.slots.inject('sidebar.brand.mark', () => ctx.slots.inject('sidebar.brand.name', () => ctx.slots.inject('conversation.hero.brand.mark', function* () {
    yield ctx.slots.register({ name: 'sidebar.brand.mark', priority: -100 }, AeraBrandMark)
    yield ctx.slots.register({ name: 'sidebar.brand.name', priority: -100 }, AeraBrandName)
    yield ctx.slots.register({ name: 'conversation.hero.brand.mark', priority: -100 }, AeraBrandMark)
  })))
}
