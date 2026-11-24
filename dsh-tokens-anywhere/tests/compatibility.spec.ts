import { readFileSync } from 'node:fs'
import { satisfies } from 'semver'
import { expect, it } from 'vitest'

interface Manifest {
  engines: Record<string, string>
  peerDependencies: Record<string, string>
  devDependencies: Record<string, string>
}

const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as Manifest
const dshPackages = (dependencies: Record<string, string>) => Object.entries(dependencies)
  .filter(([name]) => name === '@deepseek-ai/dsh' || name.startsWith('@deepseek-ai/dsh-'))

/** Whether DSH `version` is in `range` as DSH reads ranges: an empty one admits nothing, and prereleases take part. */
const holds = (version: string, range: string | undefined) =>
  range !== undefined && range.trim() !== '' && satisfies(version, range, { includePrerelease: true })

it('declares the DSH releases it supports in engines.dsh, which DSH reads alone', () => {
  const releases = ['0.2.2-rc.2', '0.2.2-rc.3', '0.2.2', '0.2.3-alpha.1', '0.2.9', '0.3.0-alpha.1', '0.3.0']
  expect(releases.filter(version => holds(version, manifest.engines.dsh))).toEqual(['0.2.2-rc.3', '0.2.2', '0.2.3-alpha.1', '0.2.9'])
})

it('declares the same range in its DSH peers, for package managers and DSH releases that predate engines.dsh', () => {
  const ranges = dshPackages(manifest.peerDependencies).map(([, range]) => range)
  expect(ranges).not.toEqual([])
  expect(new Set(ranges)).toEqual(new Set([manifest.engines.dsh]))
})

it('supports the DSH release it is built against', () => {
  const built = [...new Set(dshPackages(manifest.devDependencies).map(([, version]) => version))]
  expect(built).toHaveLength(1)
  expect(built.filter(version => holds(version, manifest.engines.dsh))).toEqual(built)
})
