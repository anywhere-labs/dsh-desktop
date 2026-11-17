import { rm } from 'node:fs/promises'

// Resolve from this script so cleaning never depends on the caller's directory.
await rm(new URL('../lib/', import.meta.url), { recursive: true, force: true })
