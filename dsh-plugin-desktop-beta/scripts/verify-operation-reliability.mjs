import { verifyOperationReliability } from './operation-reliability.mjs'

const result = await verifyOperationReliability()
if (result.failures.length > 0) {
  console.error('verify-operation-reliability: invalid operation reliability matrix')
  for (const failure of result.failures) console.error(`  ${failure}`)
  process.exit(1)
}
console.log(`verify-operation-reliability: ${result.operationCount} operations and ${result.scenarioCount} fault contracts verified.`)
