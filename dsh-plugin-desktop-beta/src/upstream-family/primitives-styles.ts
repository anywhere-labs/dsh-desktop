/**
 * Install the stylesheets of the official Client primitives on a page the official frontend does not render. From dsh
 * 0.2.3 a static Client library publishes its compiled stylesheets in its module manifest, and the official renderer
 * installs them when the application mounts; importing the library no longer adds them. The Desktop native pages
 * (setup, recovery, startup notices) bundle the primitives without that renderer, so they install the sheets here, the
 * way the renderer does: one `<style data-plugin data-path>` per stylesheet.
 */
import * as primitives from '@deepseek-ai/dsh-client-ui-primitives'

/** The part of a Client module manifest that carries compiled stylesheets. */
interface StylesheetManifest {
  readonly id: string
  readonly meta?: () => { readonly stylesheets?: Readonly<Record<string, { text(context: { asset(path: string): string }): string }>> }
}

/** Stylesheet context for libraries whose sheets reference no package assets. */
const NO_ASSETS = {
  asset(path: string): string { throw new Error(`Desktop native pages provide no Client package asset (${path})`) },
}

/**
 * Add the primitives' stylesheets to a document once.
 * @param document - the page document.
 * @throws when the primitives publish no stylesheet manifest.
 */
export function installPrimitivesStyles(document: Document): void {
  const manifest = Reflect.get(primitives, '__$dsh_client_module_manifest') as StylesheetManifest | undefined
  const stylesheets = manifest?.meta?.().stylesheets
  if (manifest === undefined || stylesheets === undefined) throw new Error('The official Client primitives publish no stylesheets')
  for (const [path, stylesheet] of Object.entries(stylesheets)) {
    const installed = [...document.head.querySelectorAll('style[data-plugin]')]
      .some(element => element.getAttribute('data-plugin') === manifest.id && element.getAttribute('data-path') === path)
    if (installed) continue
    const element = document.createElement('style')
    element.setAttribute('data-plugin', manifest.id)
    element.setAttribute('data-path', path)
    element.textContent = stylesheet.text(NO_ASSETS)
    document.head.append(element)
  }
}
