// @vitest-environment jsdom
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { DesktopFindBar, type DesktopFindBarProps } from '../src/client/DesktopFindBar.tsx'
import type { DesktopClientEnvironment } from '../src/client/environment.ts'
import { DesktopFindController, type FindViewport } from '../src/client/find-controller.ts'
import { en } from '../src/client/find-locales.ts'

const ENVIRONMENT: DesktopClientEnvironment = {
  version: '2.0.13-beta.1',
  mode: 'compatibility',
  platform: 'darwin',
  material: 'off',
  micaSupported: false,
}

function translator(key: string, params?: Record<string, unknown>): string {
  const template = (en as Record<string, string>)[key] ?? key
  return template.replace(/\{(\w+)\}/g, (_match, name: string) => String(params?.[name] ?? ''))
}

function viewportFor(matches: number, truncated = false): FindViewport {
  return {
    collect: () => ({ ranges: Array.from({ length: matches }, () => ({} as Range)), truncated }),
    paint: () => {},
    clear: () => {},
    reveal: () => false,
    scroll: () => false,
    frame: () => {},
  }
}

function renderBar(controller: DesktopFindController): string {
  const props = {
    controller,
    environment: ENVIRONMENT,
    t: translator,
  } as unknown as DesktopFindBarProps
  return renderToStaticMarkup(createElement(DesktopFindBar, props))
}

describe('DesktopFindBar', () => {
  it('renders nothing while closed', () => {
    const controller = new DesktopFindController({ viewport: viewportFor(0) })
    expect(renderBar(controller)).toBe('')
  })

  it('excludes its own surface from the page search', () => {
    const controller = new DesktopFindController({ viewport: viewportFor(0) })
    controller.open()
    expect(renderBar(controller)).toContain('data-dsh-find-excluded')
  })

  it('shows the query, the position, and the localized count', () => {
    const controller = new DesktopFindController({ viewport: viewportFor(3) })
    controller.open()
    controller.setQuery('beta')
    controller.next()
    const markup = renderBar(controller)
    expect(markup).toContain('value="beta"')
    expect(markup).toContain('2/3')
    expect(markup).toContain('Find in page')
  })

  it('reports an empty result set and disables navigation', () => {
    const controller = new DesktopFindController({ viewport: viewportFor(0) })
    controller.open()
    controller.setQuery('missing')
    const markup = renderBar(controller)
    expect(markup).toContain('No results')
    expect(markup).toContain('disabled')
  })

  it('marks truncation in the count and explains it in the title', () => {
    const controller = new DesktopFindController({ viewport: viewportFor(1000, true) })
    controller.open()
    controller.setQuery('beta')
    const markup = renderBar(controller)
    expect(markup).toContain('1/1000+')
    expect(markup).toContain('showing the first 1000 matches')
  })

  it('exposes case sensitivity as a pressed toggle', () => {
    const controller = new DesktopFindController({ viewport: viewportFor(1) })
    controller.open()
    controller.setQuery('beta')
    expect(renderBar(controller)).toContain('aria-pressed="false"')
    controller.toggleMatchCase()
    expect(renderBar(controller)).toContain('aria-pressed="true"')
  })
})
