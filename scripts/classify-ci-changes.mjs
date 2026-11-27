import { readFileSync } from 'node:fs'

const changedPaths = readFileSync(0)
  .toString('utf8')
  .split('\0')
  .filter(Boolean)

const productCriticalDocument = /(?:^|\/)(?:LICENSE(?:\.[^/]*)?|THIRD_PARTY_NOTICES\.md)$/u
const documentationPath = /^(?:docs\/|\.agents\/notes\/|\.github\/(?:ISSUE_TEMPLATE\/|PULL_REQUEST_TEMPLATE))/u
const nestedDocumentationPath = /\/docs\//u
const documentationFile = /(?:\.mdx?|\.i18n\.ya?ml)$/u

const productPaths = changedPaths.filter((path) => {
  // The plugin detail page loads its localized preview from this directory.
  if (path.startsWith('dsh-acp-bridge/docs/') && !documentationFile.test(path)) return true
  if (productCriticalDocument.test(path)) return true
  return !documentationPath.test(path)
    && !nestedDocumentationPath.test(path)
    && !documentationFile.test(path)
})

let scope = 'full'
if (changedPaths.length && !productPaths.length) scope = 'docs'
else if (productPaths.length && productPaths.every(path => path.startsWith('dsh-acp-bridge/'))) scope = 'acp'
console.log(scope)
