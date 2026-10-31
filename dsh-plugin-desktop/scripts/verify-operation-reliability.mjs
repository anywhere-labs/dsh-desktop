import { verifyOperationReliability } from './operation-reliability.mjs'

const result = await verifyOperationReliability()
if (result.failures.length > 0 || result.operationCount !== 7 || result.scenarioCount !== 18) {
  console.error('verify-operation-reliability: invalid operation reliability matrix')
  for (const failure of result.failures) console.error(`  ${failure}`)
  if (result.operationCount !== 7 || result.scenarioCount !== 18) {
    console.error(`  expected 7 operations / 18 scenarios, received ${result.operationCount} / ${result.scenarioCount}`)
  }
  process.exit(1)
}
console.log(`verify-operation-reliability: ${result.operationCount} operations and ${result.scenarioCount} fault contracts verified.`)
