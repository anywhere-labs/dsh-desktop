import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  desktopChannelHome,
  desktopSharedHomeNoticeRequired,
  resolveDesktopChannelHome,
} from '../src/desktop-channel-home.ts'
import { DESKTOP_RELEASE_IDENTITIES } from '../src/product-identity.ts'

const stable = DESKTOP_RELEASE_IDENTITIES.stable
const beta = DESKTOP_RELEASE_IDENTITIES.beta
const userHome = process.platform === 'win32' ? 'C:\Users\tester' : '/home/tester'
const legacy = resolve(join(userHome, '.dsh'))
const betaHome = resolve(join(userHome, '.dsh-beta'))
const inUse = (...paths: string[]) => (path: string) => paths.includes(path)
const none = () => false

describe('desktopChannelHome', () => {
  it('gives each release channel a distinct home', () => {
    expect(desktopChannelHome(stable, userHome)).toBe(legacy)
    expect(desktopChannelHome(beta, userHome)).toBe(betaHome)
  })
})

describe('resolveDesktopChannelHome', () => {
  it('keeps Stable on the shared home it already owns', () => {
    const resolution = resolveDesktopChannelHome({
      identity: stable,
      environment: {},
      homeDirectory: userHome,
      homeInUse: inUse(legacy),
    })
    expect(resolution.homeDir).toBe(legacy)
    expect(resolution.status).toBe('channel')
    expect(desktopSharedHomeNoticeRequired(resolution, 'default')).toBe(false)
  })

  it('sends a fresh Beta install straight to its own home', () => {
    const resolution = resolveDesktopChannelHome({
      identity: beta,
      environment: {},
      homeDirectory: userHome,
      homeInUse: none,
    })
    expect(resolution.homeDir).toBe(betaHome)
    expect(resolution.status).toBe('channel')
    expect(desktopSharedHomeNoticeRequired(resolution, 'default')).toBe(false)
  })

  it('leaves an installed Beta on the shared home and asks for the notice', () => {
    const resolution = resolveDesktopChannelHome({
      identity: beta,
      environment: {},
      homeDirectory: userHome,
      homeInUse: inUse(legacy),
    })
    expect(resolution.homeDir).toBe(legacy)
    expect(resolution.channelHome).toBe(betaHome)
    expect(resolution.status).toBe('legacy-shared')
    expect(desktopSharedHomeNoticeRequired(resolution, 'default')).toBe(true)
  })

  it('prefers the channel home once it holds data, even beside the shared home', () => {
    const resolution = resolveDesktopChannelHome({
      identity: beta,
      environment: {},
      homeDirectory: userHome,
      homeInUse: inUse(legacy, betaHome),
    })
    expect(resolution.homeDir).toBe(betaHome)
    expect(resolution.status).toBe('channel')
  })

  it('never overrides an explicit DSH_HOME', () => {
    const configured = resolve(join(userHome, 'elsewhere'))
    const resolution = resolveDesktopChannelHome({
      identity: beta,
      environment: { DSH_HOME: configured },
      homeDirectory: userHome,
      homeInUse: inUse(legacy),
    })
    expect(resolution.homeDir).toBe(configured)
    expect(resolution.status).toBe('explicit')
    expect(desktopSharedHomeNoticeRequired(resolution, 'environment')).toBe(false)
  })

  it('ignores a blank DSH_HOME', () => {
    const resolution = resolveDesktopChannelHome({
      identity: beta,
      environment: { DSH_HOME: '   ' },
      homeDirectory: userHome,
      homeInUse: inUse(legacy),
    })
    expect(resolution.status).toBe('legacy-shared')
  })
})

describe('desktopSharedHomeNoticeRequired', () => {
  it('stays silent once the user has chosen a directory in Recovery', () => {
    const resolution = resolveDesktopChannelHome({
      identity: beta,
      environment: {},
      homeDirectory: userHome,
      homeInUse: inUse(legacy),
    })
    expect(resolution.status).toBe('legacy-shared')
    expect(desktopSharedHomeNoticeRequired(resolution, 'desktop')).toBe(false)
  })
})
