/** Empty lib/ before the build steps start: they write into it in parallel, so none of them may clean it. */
import { rmSync } from 'node:fs'

rmSync(new URL('../lib', import.meta.url), { recursive: true, force: true })
