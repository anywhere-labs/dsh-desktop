import { rmSync } from 'node:fs'

rmSync(new URL('../lib', import.meta.url), { recursive: true, force: true })
