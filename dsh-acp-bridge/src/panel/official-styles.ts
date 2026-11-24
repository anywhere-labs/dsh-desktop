/**
 * The panel has no styles of its own. Its layout and type are the plugin detail page's (section heads,
 * fact lists, state and status lines) and its form is the official settings fields, compiled from the
 * installed official packages at build time.
 */
import detail, { stylesheet as detailStyle } from 'acp-styles:@deepseek-ai/dsh-client-ui-plugin-manager/src/client/PluginManagerPage.module.css?keep=installedPanel,detailSection,sectionHead,sectionTitle,sectionCount,versionSpacer,facts,rowState,detailActions,status,reason,subjectSpec'
import field, { stylesheet as fieldStyle } from 'acp-styles:@deepseek-ai/dsh-client-ui-primitives/src/settings-form/fields.module.css'

export { detail, field }
export const styles = `${detailStyle}\n${fieldStyle}`
