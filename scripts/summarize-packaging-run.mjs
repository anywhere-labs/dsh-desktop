/**
 * Summarize a packaging phase journal (`DSH_DESKTOP_PACKAGING_RUN_DIR`) as a duration table.
 * CI appends it to the job summary, so every packaging run shows where its time went.
 */
import { appendFileSync, existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Read finished stages in the order they ended.
 * @param {string} text - Contents of `events.jsonl`.
 * @returns {{ stage: string, seconds: number, success: boolean }[]} One row per finished stage.
 */
export function finishedStages(text) {
  return text.split('\n').filter(line => line.trim() !== '').map(line => JSON.parse(line))
    .filter(event => event.type === 'stage-end')
    .map(event => ({ stage: event.stage, seconds: event.elapsedMs / 1000, success: event.success === true }))
}

/**
 * @param {readonly { stage: string, seconds: number, success: boolean }[]} stages - Finished stages.
 * @param {string} title - Table heading.
 * @returns {string} A Markdown table.
 */
export function stageTable(stages, title) {
  const rows = stages.map(({ stage, seconds, success }) => `| ${stage} | ${seconds.toFixed(1)} | ${success ? '' : 'failed'} |`)
  return [`### ${title}`, '', '| Stage | Seconds | |', '| --- | ---: | --- |', ...rows, ''].join('\n')
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [directory, title = 'Packaging phases'] = process.argv.slice(2)
  const journal = join(directory ?? '', 'events.jsonl')
  if (directory === undefined || !existsSync(journal)) {
    process.stdout.write(`summarize-packaging-run: no phase journal at ${journal}\n`)
  } else {
    const table = stageTable(finishedStages(readFileSync(journal, 'utf8')), title)
    process.stdout.write(`${table}\n`)
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${table}\n`)
  }
}
