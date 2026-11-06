# tokens-anywhere

English | [中文](README.zh.md)

Tokens Anywhere for DeepSeek Harness. Sign in to Tokens Anywhere with an Agents Anywhere account, and its models (DeepSeek, Claude, GPT and Gemini) are set up as `llm-pi-ai` provider routes, one per vendor, with no API key to enter. Its page also shows the balance and the usage by day and model.

## In DSH Next

DSH Next ships this plugin and loads it for every Profile from its own bundle layer, so other launchers that share the Profile never see it. Next also serves the shell half as the `desktopTokensAnywhere` Host service: the built-in sign-in window, sealing the refresh token with the system keychain, and Tokens Anywhere's `dsh://v1/tokens/login` link.

Its card on the Plugins page, between Remote Control and Computer Use (Next), opens the account page and switches the plugin off; Safe Mode leaves it off. Switching it off does not remove the models it set up or their key, and they keep working. To sign out, switch it back on and sign out on the account page.

## Elsewhere

Without DSH Next, the page links the authorize page for the browser, and the refresh token is kept in memory only. After a restart the models keep working, and showing the balance and usage needs another sign-in. Gemini models need DSH Next's `dsh-llm-pi-ai` patch.

## Settings

The account's key is for this computer only. The account page's Settings tab copies it, or rotates it, which stops the old key at once. Two switches there say what the account writes into DSH's own files: the key into the credentials file (`.credentials.yaml`), and the models into the active Profile's `cordis.patch.yml`. The models need the stored key, so switching the key off takes them with it. Both switches are the plugin's configuration (`storeKey` and `writeModels`), saved in the active Profile. DSH Next can also show either file in the file manager.

## Display

The account page is in Settings. On its Display tab it can also add an entry to the left sidebar (on by default) and a View tab beside every conversation (off by default). Both choices are the plugin's configuration (`sidebar` and `conversation`), saved in the active Profile.

## Development

- `corepack yarn workspace tokens-anywhere build`, `typecheck` and `test`.
- `DSH_NEXT_TOKENS_ANYWHERE_URL` points the plugin at another Tokens Anywhere: HTTPS, or HTTP on `localhost` and `127.0.0.1`.
