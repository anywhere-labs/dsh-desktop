import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { availableParallelism } from 'node:os'
import { delimiter, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const manifestCache = new Map()
const activeChildren = new Set()
const maxSlots = Math.max(2, availableParallelism())
let usedSlots = 0
const waitQueue = []
let failed = false

function acquireSlots(weight) {
  const needed = Math.min(weight, maxSlots)
  if (usedSlots + needed <= maxSlots) {
    usedSlots += needed
    return Promise.resolve(needed)
  }
  return new Promise(resolveSlot => {
    waitQueue.push({ needed, resolveSlot })
  })
}

function releaseSlots(allocated) {
  usedSlots -= allocated
  while (waitQueue.length > 0 && usedSlots + waitQueue[0].needed <= maxSlots) {
    const next = waitQueue.shift()
    usedSlots += next.needed
    next.resolveSlot(next.needed)
  }
}

function readManifest(dir) {
  let manifest = manifestCache.get(dir)
  if (manifest === undefined) {
    const file = resolve(dir, 'package.json')
    manifest = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null
    manifestCache.set(dir, manifest)
  }
  return manifest
}

export function splitSequential(command) {
  const parts = []
  let current = ''
  let quote = null
  for (let i = 0; i < command.length; i += 1) {
    const ch = command[i]
    if (ch === '\\' && i + 1 < command.length) {
      current += ch + command[i + 1]
      i += 1
      continue
    }
    if (quote) {
      if (ch === quote) quote = null
      current += ch
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      current += ch
      continue
    }
    if (command.slice(i, i + 4) === ' && ') {
      if (current.trim()) parts.push(current.trim())
      current = ''
      i += 3
      continue
    }
    current += ch
  }
  if (current.trim()) parts.push(current.trim())
  return parts
}

export function parseParallelArgs(argString) {
  const args = []
  let current = ''
  let quote = null
  for (let i = 0; i < argString.length; i += 1) {
    const ch = argString[i]
    if (ch === '\\' && i + 1 < argString.length) {
      const next = argString[i + 1]
      if (quote === '"' && (next === '"' || next === '\\')) {
        current += next
        i += 1
        continue
      }
    }
    if (quote) {
      if (ch === quote) quote = null
      else current += ch
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      continue
    }
    if (/\s/.test(ch)) {
      if (current.length > 0) {
        args.push(current)
        current = ''
      }
      continue
    }
    current += ch
  }
  if (current.length > 0) args.push(current)
  return args
}

function buildEnv(cwd, extraEnv) {
  const env = { ...process.env, ...extraEnv }
  const pathKey = Object.keys(env).find(key => key.toUpperCase() === 'PATH') ?? 'PATH'
  const entries = [
    resolve(cwd, 'node_modules', '.bin'),
    resolve(rootDir, 'node_modules', '.bin'),
    dirname(process.execPath),
    ...(env[pathKey] ?? '').split(delimiter).filter(Boolean),
  ]
  env[pathKey] = [...new Set(entries)].join(delimiter)
  return env
}

async function runLeafCommand(rawCommand, cwd) {
  let command = rawCommand.trim()
  const extraEnv = {}
  while (true) {
    const envMatch = /^([A-Za-z_][A-Za-z0-9_]*)=([^\s]+)\s+(.+)$/s.exec(command)
    if (!envMatch) break
    extraEnv[envMatch[1]] = envMatch[2]
    command = envMatch[3].trim()
  }
  if (!command || command === 'true') return

  const weight = command.startsWith('vitest ') ? 2 : 1
  const allocated = await acquireSlots(weight)
  try {
    await new Promise((resolvePromise, rejectPromise) => {
      if (failed) {
        resolvePromise()
        return
      }
      const env = buildEnv(cwd, extraEnv)
      const isSimpleNode = command.startsWith('node ') && !/[|><;&*?$\\"']/u.test(command)
      const child = isSimpleNode
        ? spawn(process.execPath, command.slice(5).trim().split(/\s+/), {
          cwd,
          env,
          stdio: ['ignore', 'pipe', 'pipe'],
        })
        : spawn(command, {
          cwd,
          env,
          shell: true,
          stdio: ['ignore', 'pipe', 'pipe'],
        })
      activeChildren.add(child)
      const chunks = []
      child.stdout.on('data', chunk => chunks.push({ stream: process.stdout, chunk }))
      child.stderr.on('data', chunk => chunks.push({ stream: process.stderr, chunk }))
      child.on('error', error => {
        activeChildren.delete(child)
        rejectPromise(error)
      })
      child.on('close', code => {
        activeChildren.delete(child)
        if (failed && code !== 0) {
          resolvePromise()
          return
        }
        for (const { stream, chunk } of chunks) {
          stream.write(chunk)
        }
        if (code === 0) {
          resolvePromise()
        } else {
          failed = true
          for (const other of activeChildren) {
            try {
              other.kill()
            } catch {}
          }
          const error = new Error(`Command failed with exit code ${String(code)}: ${rawCommand}`)
          error.exitCode = code ?? 1
          rejectPromise(error)
        }
      })
    })
  } finally {
    releaseSlots(allocated)
  }
}

export async function runTask(rawTask, cwd) {
  if (failed) return
  const cleaned = rawTask.replace(/^true\s*&&\s*/, '').trim()
  if (!cleaned || cleaned === 'true') return

  const steps = splitSequential(cleaned)
  if (steps.length > 1) {
    for (const step of steps) {
      if (failed) return
      await runTask(step, cwd)
    }
    return
  }

  const single = steps[0]
  const workspaceMatch = /^yarn\s+workspace\s+([^\s]+)\s+(?:run\s+)?([a-zA-Z0-9:_-]+)$/.exec(single)
  if (workspaceMatch) {
    const [, workspace, scriptName] = workspaceMatch
    const workspaceDir = resolve(rootDir, workspace)
    const script = readManifest(workspaceDir)?.scripts?.[scriptName]
    if (typeof script === 'string') {
      await runTask(script, workspaceDir)
      return
    }
  }

  const scriptMatch = /^yarn(?:\s+run)?\s+([a-zA-Z0-9:_-]+)$/.exec(single)
  if (scriptMatch) {
    const [, scriptName] = scriptMatch
    const script = readManifest(cwd)?.scripts?.[scriptName]
    if (typeof script === 'string') {
      await runTask(script, cwd)
      return
    }
  }

  const parallelMatch = /^node\s+(?:\.\.\/)?scripts\/run-parallel\.mjs\s+(.+)$/s.exec(single)
  if (parallelMatch) {
    const subTasks = parseParallelArgs(parallelMatch[1])
    await Promise.all(subTasks.map(task => runTask(task, cwd)))
    return
  }

  await runLeafCommand(single, cwd)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const tasks = process.argv.slice(2)
  const cwd = process.cwd()
  Promise.all(tasks.map(task => runTask(task, cwd))).catch(error => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exit(typeof error?.exitCode === 'number' ? error.exitCode : 1)
  })
}
