/**
 * tokens-anywhere: the Anywhere account (dsh-desktop#1583) as a DSH plugin. Its Host face signs in to Tokens Anywhere,
 * keeps the account's key and models in the active Profile and serves the routes the page in ./client drives. DSH Next
 * loads it for every Profile and lends it its built-in sign-in window and keychain (./host/shell.ts).
 */
import type { Context, Volatile } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-settings'
import { installAnywhereAccount } from './host/account.ts'
import { AnywhereSettings, installAnywherePlacement } from './host/settings.ts'

export const name = 'tokens-anywhere'

/** The page changes these, so a change never reloads the plugin. */
export interface Config {
  /** An entry in the left sidebar that opens the page. */
  sidebar: Volatile<boolean>
  /** A View tab beside every conversation. */
  conversation: Volatile<boolean>
  /** Keep the account's key in DSH's credentials document, where its model routes read it. */
  storeKey: Volatile<boolean>
  /** Write the account's models into the active Profile's configuration; they need the stored key. */
  writeModels: Volatile<boolean>
}

export const Config = z.object({
  sidebar: z.boolean().default(true).volatile().description('Show Tokens Anywhere in the left sidebar.'),
  conversation: z.boolean().default(false).volatile().description('Show Tokens Anywhere beside every conversation.'),
  storeKey: z.boolean().default(true).volatile().description('Keep the account\'s key in the credentials file.'),
  writeModels: z.boolean().default(true).volatile().description('Write the account\'s models into the Profile configuration.'),
})

export function apply(ctx: Context, config: Config): void {
  // The plugin draws its own page; Settings builds none from this Config.
  ctx.inject(['settings'], (child) => {
    child.effect(() => child.settings.configure({ auto: false }, ctx.fiber), 'tokens-anywhere: own settings page')
  })
  const settings = new AnywhereSettings(ctx, config)
  installAnywhereAccount(ctx, settings)
  installAnywherePlacement(ctx, settings)
}
