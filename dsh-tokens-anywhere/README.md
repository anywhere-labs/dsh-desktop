# @agents-anywhere/dsh-tokens-anywhere

English | [中文](README.zh.md)

Tokens Anywhere for DeepSeek Harness. Sign in to Tokens Anywhere with an Agents Anywhere account, and the chat models the site serves are set up as `llm-pi-ai` provider routes, one per vendor, with no API key to enter. Vendors follow the providers Tokens Anywhere names, and models that hold no conversation, such as video and embeddings models, are left out. Its page also shows the balance and the usage by day and model. Amounts are in the site's currency, as Tokens Anywhere bills: US dollars on the international site, yuan on the China site. On the international site, in Chinese, while Show local currency is on, the page shows them in yuan at the day's rate instead, rounded as the Tokens Anywhere console rounds them.

## In DSH Next

DSH Next does not load this plugin yet. Where a Desktop serves the `desktopTokensAnywhere` Host service, the plugin uses it for the shell half: the built-in sign-in window, sealing the refresh token with the system keychain, and Tokens Anywhere's `dsh://v1/tokens/login` link.

## Elsewhere

Without DSH Next, the page links the authorize page for the browser, and the refresh token is kept in memory only. After a restart the models keep working, and showing the balance and usage needs another sign-in. Both of Gemini's formats work there too.

## Compatibility

The plugin supports DSH `0.2.2-rc.3` and later 0.2 releases, prereleases included: `engines.dsh` in its `package.json`, `>=0.2.2-rc.3 <0.3.0-0`. Its `@deepseek-ai/dsh-credentials` peer has the same range, which package managers check and DSH releases from before `engines.dsh` read instead. It is built, type-checked and tested against the release its `devDependencies` pin, which is DSH Next's; the other releases in the range are declared, not checked.

DSH checks the range when it installs the plugin and when it starts, and refuses to install or load the plugin outside it. Do not exempt the plugin from the check: update DSH, or use a version of the plugin that supports it.

## Models

The model list comes from Tokens Anywhere each time it is read: on sign-in, on start, every six hours and on Refresh. It is one `/v1/models?protocol=any` request, which names each model's provider and the endpoints that reach it; a model none of whose endpoints holds a conversation is left out, and so is a model the public price list prices by the second of video. A Tokens Anywhere release that lists no endpoints is read once per format instead. Each provider Tokens Anywhere names is a vendor of its own. DeepSeek, Claude (Anthropic), GPT (OpenAI), Gemini, MiniMax, GLM, Kimi and Grok go through the protocols and thinking settings the plugin keeps for them. A vendor the plugin does not know yet is named by its provider id, gets a route of its own (`tokens-anywhere-<provider>`) in the first protocol that reaches its models, Chat Completions before Anthropic Messages before Gemini's own API, and offers no thinking levels. Models whose provider is not named share the plain `tokens-anywhere` route, listed as Other. Before sign-in, the page names the vendors the site serves that its public price list has a conversation model of.

The account page's Models tab lists the models by vendor: a whole vendor or a single model can be switched off for the model picker, and models renamed. Where the site serves Gemini, the tab also has a Configure Gemini models in Google's format switch: Gemini models go through OpenAI Chat Completions, and the switch sends them through Google's own Gemini API instead. It is the plugin's configuration (`geminiNative`, off). Anything more, such as a route's models or its retry policy, is edited in Settings → Models, the official model settings, which the tab's Custom configuration row opens; the tab shows a save there as soon as it lands. Renaming or removing models there comes back as the tab's own names and switches. Any other edit makes the routes the user's: Tokens Anywhere's list no longer changes them and the tab drops its switches, until Back to automatic puts Tokens Anywhere's routes back, which drops the edits.

## Settings

The account's key is for this computer only. The account page's Settings tab copies it, or rotates it, which stops the old key at once. For custom setups, Open configuration file opens the active Profile's `cordis.patch.yml`, where the models are written, as the Settings dialog's own button does; in DSH Next, Show credentials file shows the credentials file (`.credentials.yaml`), which holds the key, in the file manager. Whether the key and the models are written at all is the plugin's configuration (`storeKey` and `writeModels`, both on), saved in that same file; the models need the stored key, so turning the key off takes them with it.

## Display

The account page is in Settings. On its Display tab it can also add an entry to the left sidebar (on by default) and a View tab beside every conversation (off by default). Both choices are the plugin's configuration (`sidebar` and `conversation`), saved in the active Profile. For an account on the international site, the same tab also has Show local currency, which follows the account's setting in the Tokens Anywhere console, and stays off where the console says nothing; changing it here keeps the page's own choice (`localCurrency`) and leaves the console's setting alone. The China site's amounts are yuan already, so it has no such switch.

## Development

- `corepack yarn workspace @agents-anywhere/dsh-tokens-anywhere build`, `typecheck` and `test`.
- `DSH_NEXT_TOKENS_ANYWHERE_URL` points the plugin at another Tokens Anywhere: HTTPS, or HTTP on `localhost` and `127.0.0.1`.
