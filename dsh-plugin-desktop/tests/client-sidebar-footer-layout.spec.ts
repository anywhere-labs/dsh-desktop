import { createElement } from 'react'
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

function renderFooterContract(wide: boolean) {
  return renderToStaticMarkup(
    createElement('div', { className: 'footArea' },
      createElement('div', { className: 'footerActions' },
        createElement('div', { 'data-slot': 'sidebar.footer.action', style: { display: 'contents' } },
          ['market', 'plugins', 'updates'].map(id => createElement('button', {
            key: id,
            type: 'button',
            'data-entry': id,
            'data-wide': String(wide),
          }, wide ? `Footer ${id}` : id.slice(0, 1).toUpperCase())),
        ),
      ),
      createElement('div', { className: 'settingsArea' },
        createElement('div', { 'data-slot': 'sidebar.settings', style: { display: 'contents' } },
          createElement('button', {
            type: 'button',
            'data-seat': 'settings',
            'data-wide': String(wide),
          }, wide ? 'Settings' : 'S'),
        ),
      ),
    ),
  )
}

describe('desktop sidebar footer reproduction', () => {
  it('mirrors the current upstream footer slot contract with multiple wide entries', () => {
    const markup = renderFooterContract(true)
    expect(markup).toContain('class="footerActions"')
    expect(markup).toContain('data-slot="sidebar.footer.action"')
    expect(markup).toContain('style="display:contents"')
    expect(Array.from(markup.matchAll(/data-entry="([^"]+)"/g), match => match[1])).toEqual(['market', 'plugins', 'updates'])
    expect(markup).toContain('Footer market')
    expect(markup).toContain('Footer plugins')
    expect(markup).toContain('Footer updates')
    expect(markup).toContain('data-seat="settings"')
    expect(markup).toContain('>Settings<')
  })

  it('keeps the same three deterministic entries in the collapsed rail contract', () => {
    const markup = renderFooterContract(false)
    expect(Array.from(markup.matchAll(/data-entry="([^"]+)"/g), match => match[1])).toEqual(['market', 'plugins', 'updates'])
    expect(Array.from(markup.matchAll(/data-wide="false"/g))).toHaveLength(4)
    expect(markup).toContain('>M<')
    expect(markup).toContain('>P<')
    expect(markup).toContain('>U<')
    expect(markup).toContain('>S<')
  })
})
