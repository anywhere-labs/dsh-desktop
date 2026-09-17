/** Process-local ownership marker shared with the patched upstream fallback. */

const RESOLVER_MARKER = Symbol.for('dsh-plugin-desktop.asar-module-resolver')

type ResolverState = Record<PropertyKey, unknown>

function state(): ResolverState {
  return globalThis as unknown as ResolverState
}

function retainedResolverCount(): number {
  const count = state()[RESOLVER_MARKER]
  return typeof count === 'number' ? count : 0
}

/**
 * Mark one active resolver. Patched upstream packages read this count to learn
 * that Desktop owns module resolution and that walking node_modules would fail:
 * the Desktop package ships outside any node_modules tree.
 */
export function retainAsarModuleResolver(): () => void {
  state()[RESOLVER_MARKER] = retainedResolverCount() + 1
  let active = true
  return () => {
    if (!active) return
    active = false
    const remaining = retainedResolverCount() - 1
    if (remaining > 0) state()[RESOLVER_MARKER] = remaining
    else delete state()[RESOLVER_MARKER]
  }
}
