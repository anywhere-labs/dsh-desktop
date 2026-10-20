import { expect, it } from 'vitest'
import { ensureUtf8Locale, utf8LocaleCandidates } from '../src/shell-locale.ts'

it('names UTF-8 locales for the system languages and ends with the locales every macOS installs', () => {
  expect(utf8LocaleCandidates(['zh-Hans-CN', 'en-US'])).toEqual(['zh_CN.UTF-8', 'en_US.UTF-8', 'C.UTF-8'])
  expect(utf8LocaleCandidates(['zh-Hant', 'zh-Hans', 'ja'])).toEqual(['zh_TW.UTF-8', 'zh_CN.UTF-8', 'en_US.UTF-8', 'C.UTF-8'])
  expect(utf8LocaleCandidates(['pt-BR', 'x', 'en-US'])).toEqual(['pt_BR.UTF-8', 'en_US.UTF-8', 'C.UTF-8'])
})

it('sets LANG only on macOS and only when the environment names no locale', () => {
  const installed = (name: string) => ['zh_CN.UTF-8', 'en_US.UTF-8', 'C.UTF-8'].includes(name)
  const bare: NodeJS.ProcessEnv = {}
  expect(ensureUtf8Locale(bare, 'darwin', ['zh-Hans-CN'], installed)).toBe('zh_CN.UTF-8')
  expect(bare).toEqual({ LANG: 'zh_CN.UTF-8' })
  expect(ensureUtf8Locale({}, 'darwin', ['fr-FR'], installed)).toBe('en_US.UTF-8')
  for (const environment of [{ LANG: 'C.UTF-8' }, { LC_ALL: 'en_US.UTF-8' }, { LC_CTYPE: 'UTF-8' }] as NodeJS.ProcessEnv[]) {
    const before = { ...environment }
    expect(ensureUtf8Locale(environment, 'darwin', ['zh-Hans-CN'], installed)).toBeUndefined()
    expect(environment).toEqual(before)
  }
  expect(ensureUtf8Locale({}, 'darwin', ['zh-Hans-CN'], () => false)).toBeUndefined()
  const linux: NodeJS.ProcessEnv = {}
  expect(ensureUtf8Locale(linux, 'linux', ['zh-Hans-CN'], installed)).toBeUndefined()
  expect(linux).toEqual({})
})

it('finds an installed UTF-8 locale on this macOS', { skip: process.platform !== 'darwin' }, () => {
  expect(ensureUtf8Locale({}, 'darwin', ['en-US'])).toBe('en_US.UTF-8')
})
