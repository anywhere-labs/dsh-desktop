/** Use the same installed package locale metadata as the detail page, without changing install identity. */
export function localizeInstalledDialog<T extends {
  phase: string
  installed: string | null
  subject: { description?: string; [key: string]: unknown } | null
}>(install: T, packages: readonly {
  name: string
  installed: boolean
  meta?: { title?: unknown; description?: unknown }
}[], resolveText: (text: unknown) => string): T {
  if (install.phase !== 'done' || !install.subject || !install.installed) return install
  const pkg = packages.find(pkg => pkg.name === install.installed && pkg.installed)
  if (!pkg?.meta) return install
  return {
    ...install,
    subject: {
      ...install.subject,
      ...(pkg.meta.title === undefined ? {} : { displayTitle: resolveText(pkg.meta.title) || undefined }),
      description: pkg.meta.description === undefined ? install.subject.description
        : resolveText(pkg.meta.description) || install.subject.description,
    },
  }
}
