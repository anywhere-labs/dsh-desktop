import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { parse } from 'yaml'

const REQUIRED = ['id', 'owner', 'entrypoints', 'deadline', 'cancellation', 'exclusivity', 'idempotency', 'persistedState', 'retry', 'recovery', 'evidence', 'faultContracts']
const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*(?:\.[a-z0-9]+(?:-[a-z0-9]+)*){2,}$/u

export async function loadOperationReliabilityMatrix(root = resolve(import.meta.dirname, '..')) {
  const path = resolve(root, 'docs/operation-reliability-matrix.yaml')
  return { path, document: parse(await readFile(path, 'utf8')) }
}

export async function verifyOperationReliability(root = resolve(import.meta.dirname, '..')) {
  const { path, document } = await loadOperationReliabilityMatrix(root)
  const failures = []
  if (document?.version !== 1 || document?.schema !== 'operation-reliability-matrix/v1') failures.push('document must declare schema version 1')
  const operations = document?.operations
  if (!Array.isArray(operations) || operations.length < 6) failures.push('at least six operations are required')
  const operationIds = new Set()
  const scenarioIds = new Set()
  for (const operation of operations ?? []) {
    if (!operation || typeof operation !== 'object') { failures.push('operation must be a mapping'); continue }
    if (typeof operation.id !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(operation.id)) failures.push('operation id must be kebab-case')
    if (operationIds.has(operation.id)) failures.push(`duplicate operation id: ${operation.id}`)
    operationIds.add(operation.id)
    for (const field of REQUIRED) if (!(field in operation)) failures.push(`${operation.id}: missing ${field}`)
    for (const field of ['deadline', 'cancellation', 'persistedState', 'retry']) {
      if (!operation[field] || typeof operation[field] !== 'object') failures.push(`${operation.id}: ${field} must be explicit`)
    }
    if (!Array.isArray(operation.faultContracts) || operation.faultContracts.length === 0) failures.push(`${operation.id}: faultContracts must not be empty`)
    for (const scenario of operation.faultContracts ?? []) {
      if (!scenario || typeof scenario.id !== 'string' || !ID.test(scenario.id)) failures.push(`${operation.id}: invalid scenario id`)
      if (scenarioIds.has(scenario.id)) failures.push(`duplicate scenario id: ${scenario.id}`)
      scenarioIds.add(scenario.id)
      if (!scenario.id?.startsWith(`${operation.id}.`)) failures.push(`${operation.id}: scenario ${scenario.id} has wrong prefix`)
      const testPath = resolve(root, scenario.test ?? '')
      try {
        const source = await readFile(testPath, 'utf8')
        if (!source.includes(`'${scenario.title}'`) && !source.includes(`"${scenario.title}"`)) failures.push(`${operation.id}: test title not found: ${scenario.title}`)
      } catch { failures.push(`${operation.id}: test file not found: ${scenario.test}`) }
    }
  }
  return { path, operationCount: operationIds.size, scenarioCount: scenarioIds.size, failures }
}
