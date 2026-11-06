# tokens-anywhere

English | [中文](README.zh.md)

Tokens Anywhere for DeepSeek Harness. Sign in to Tokens Anywhere with an Agents Anywhere account, and its models (DeepSeek, Claude, GPT and Gemini) are set up as `llm-pi-ai` provider routes, one per vendor, with no API key to enter. Its page also shows the balance and the usage by day and model. Amounts are US dollars, as Tokens Anywhere bills; in Chinese, while Show local currency is on, the page shows them in yuan at the day's rate instead, rounded as the Tokens Anywhere console rounds them.

## In DSH Next

DSH Next ships this plugin and loads it for every Profile from its own bundle layer, so other launchers that share the Profile never see it. Next also serves the shell half as the `desktopTokensAnywhere` Host service: the built-in sign-in window, sealing the refresh token with the system keychain, and Tokens Anywhere's `dsh://v1/tokens/login` link.

Its card on the Plugins page, between Remote Control and Computer Use (Next), opens the account page and switches the plugin off; Safe Mode leaves it off. Switching it off does not remove the models it set up or their key, and they keep working. To sign out, switch it back on and sign out on the account page.

## Elsewhere

Without DSH Next, the page links the authorize page for the browser, and the refresh token is kept in memory only. After a restart the models keep working, and showing the balance and usage needs another sign-in. Gemini models go through Chat Completions there as well; Google's format needs DSH Next's `dsh-llm-pi-ai` patch.

## Settings

The account's key is for this computer only. The account page's Settings tab copies it, or rotates it, which stops the old key at once. Gemini models go through OpenAI Chat Completions; the tab's Configure Gemini models in Google's format switch sends them through Google's own Gemini API instead. It is the plugin's configuration (`geminiNative`, off), and it cannot be changed while custom configuration is on, since the routes are the user's then. For custom setups, Open configuration file opens the active Profile's `cordis.patch.yml`, where the models are written, as the Settings dialog's own button does; in DSH Next, Show credentials file shows the credentials file (`.credentials.yaml`), which holds the key, in the file manager. Whether the key and the models are written at all is the plugin's configuration (`storeKey` and `writeModels`, both on), saved in that same file; the models need the stored key, so turning the key off takes them with it.

## Display

The account page is in Settings. On its Display tab it can also add an entry to the left sidebar (on by default) and a View tab beside every conversation (off by default). Both choices are the plugin's configuration (`sidebar` and `conversation`), saved in the active Profile. Show local currency, on the same tab, follows the account's setting in the Tokens Anywhere console, and stays off where the console says nothing; changing it here keeps the page's own choice (`localCurrency`) and leaves the console's setting alone.

## Development

- `corepack yarn workspace tokens-anywhere build`, `typecheck` and `test`.
- `DSH_NEXT_TOKENS_ANYWHERE_URL` points the plugin at another Tokens Anywhere: HTTPS, or HTTP on `localhost` and `127.0.0.1`.
