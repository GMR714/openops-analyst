import { analyze, type Mode } from './analyst.js'

const rawMode = process.argv[2] || 'str_cp'
if (!['all', 'str', 'str_cp'].includes(rawMode)) throw new Error(`Unknown mode: ${rawMode}`)
const mode = rawMode as Mode
const question = process.argv.slice(3).join(' ') || 'For Northstar Supply, which orders are delayed and are there open support tickets for them?'
const result = await analyze(question, mode)
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
