/** A document-scoped native selection. A replaced document never receives an old dialog result. */
export interface DirectorySelectionOwner {
  readonly key: string
  current(): boolean
}

export interface DirectorySelectionOptions {
  pick(multiple: boolean): Promise<readonly string[] | null>
  admit(path: string): Promise<boolean>
}

export class DesktopDirectorySelection {
  private readonly pending = new Map<string, Promise<string[]>>()

  select(owner: DirectorySelectionOwner, multiple: boolean, options: DirectorySelectionOptions): Promise<string[]> {
    const key = owner.key
    const pending = this.pending.get(key)
    // One native dialog owns a document, even when legacy and multi-root callers overlap.
    if (pending) return multiple ? pending : pending.then(paths => paths.slice(0, 1))
    const task = this.run(owner, multiple, options).finally(() => {
      if (this.pending.get(key) === task) this.pending.delete(key)
    })
    this.pending.set(key, task)
    return task
  }

  private async run(owner: DirectorySelectionOwner, multiple: boolean, options: DirectorySelectionOptions): Promise<string[]> {
    if (!owner.current()) return []
    const paths = await options.pick(multiple)
    if (!paths || !owner.current()) return []
    const admitted: string[] = []
    for (const path of multiple ? paths : paths.slice(0, 1)) {
      if (!owner.current()) return []
      if (!admitted.includes(path)) {
        if (!await options.admit(path)) return []
        admitted.push(path)
      }
      if (!owner.current()) return []
    }
    return admitted
  }
}
