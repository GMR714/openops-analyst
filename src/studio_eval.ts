import { mkdir, writeFile } from 'node:fs/promises'
import { defaultPipeline, type BlockId, type Pipeline } from './architecture.js'
import { JEV_MODEL, jevConfigured } from './jev.js'
import { analyzePipeline } from './pipeline.js'
import { scenarios } from './scenarios.js'

const block = (ids: BlockId[]): Pipeline => ({ blocks: ids.map(id => ({ id, params: {} })) })
const profiles: Record<string, Pipeline> = {
  wide: block([]),
  local: defaultPipeline,
  jev: block(['ar', 'jc', 'js', 'tr', 'cp', 'rts', 'rr']),
  jev_memory: block(['ar', 'jc', 'js', 'tr', 'cp', 'rts', 'm1', 'rr'])
}
const option = (name: string, fallback: string) => {
  const index = process.argv.indexOf(name)
  return index < 0 ? fallback : process.argv[index + 1] || fallback
}
const ids = new Set(option('--ids', scenarios.map(item => item.id).join(',')).split(','))
const profileNames = option('--profiles', Object.keys(profiles).join(',')).split(',')
const chosen = scenarios.filter(item => ids.has(item.id))
const model = option('--model', process.env.OLLAMA_MODEL || 'qwen3:4b')
const out = option('--out', 'results/studio-eval.json')
if (!chosen.length || profileNames.some(name => !profiles[name])) throw new Error('Unknown scenario or profile')
if (profileNames.some(name => name.startsWith('jev')) && !jevConfigured()) process.stderr.write('JEV is not configured; those profiles will record semantic fallback.\n')

type Row = Record<string, unknown> & { profile: string; category: string; difficulty: string; pass?: boolean }
const rows: Row[] = []
for (const scenario of chosen) {
  for (const profile of profileNames) {
    try {
      const result = await analyzePipeline(scenario.question, profiles[profile], scenario.history || [], model)
      const citations = new Set(result.citations)
      const evidence = new Set(result.evidence.map(item => item.source))
      const outcomeOk = scenario.expected.outcome === 'abstain' ? result.cannotAnswer : !result.cannotAnswer
      const sourcesOk = scenario.expected.sources.every(id => citations.has(id))
      const containsOk = (scenario.expected.contains || []).every(value => result.answer.toLowerCase().includes(value.toLowerCase()))
      const excludesOk = (scenario.expected.excludes || []).every(value => !result.answer.toLowerCase().includes(value.toLowerCase()))
      const pass = outcomeOk && sourcesOk && containsOk && excludesOk
      rows.push({
        id: scenario.id, profile, category: scenario.category, difficulty: scenario.difficulty,
        pass, outcomeOk, sourcesOk, containsOk, excludesOk,
        expectedSources: scenario.expected.sources, citations: result.citations,
        evidenceRecall: scenario.expected.sources.length ? scenario.expected.sources.filter(id => evidence.has(id)).length / scenario.expected.sources.length : null,
        answer: result.answer, cannotAnswer: result.cannotAnswer, resolution: result.resolution,
        selectedTools: result.tools, toolCount: result.tools.length, evidenceCount: result.evidence.length,
        modelTokens: result.tokens, jev: result.jev, elapsedMs: result.elapsedMs
      })
      process.stdout.write(`${scenario.id} ${profile} ${pass ? 'pass' : 'fail'} ${result.elapsedMs}ms\n`)
    } catch (error) {
      rows.push({ id: scenario.id, profile, category: scenario.category, difficulty: scenario.difficulty, pass: false, error: error instanceof Error ? error.message : String(error) })
      process.stdout.write(`${scenario.id} ${profile} error\n`)
    }
  }
}

const summaries = profileNames.map(profile => {
  const subset = rows.filter(row => row.profile === profile)
  const valid = subset.filter(row => typeof row.toolCount === 'number')
  const average = (get: (row: Row) => number) => valid.length ? Math.round(valid.reduce((sum, row) => sum + get(row), 0) / valid.length) : null
  return {
    profile, cases: subset.length, completed: valid.length, passed: subset.filter(row => row.pass).length,
    meanTools: average(row => Number(row.toolCount)),
    meanModelTokens: average(row => Number(row.modelTokens)),
    meanJevInputTokens: average(row => Number((row.jev as { inputTokens: number }).inputTokens)),
    meanElapsedMs: average(row => Number(row.elapsedMs)),
    jevFallbacks: valid.filter(row => Boolean((row.jev as { fallback: boolean }).fallback)).length
  }
})
const byCategory = [...new Set(chosen.map(item => item.category))].map(category => ({
  category, cases: chosen.filter(item => item.category === category).length,
  profiles: Object.fromEntries(profileNames.map(profile => [profile, {
    passed: rows.filter(row => row.category === category && row.profile === profile && row.pass).length,
    completed: rows.filter(row => row.category === category && row.profile === profile && !row.error).length
  }]))
}))
await mkdir('results', { recursive: true })
await writeFile(out, JSON.stringify({ model, jevModel: JEV_MODEL, jevConfigured: jevConfigured(), scenarios: chosen.map(({ expected, ...item }) => ({ ...item, expected })), rows, summaries, byCategory }, null, 2) + '\n')
process.stdout.write(JSON.stringify({ summaries, byCategory }, null, 2) + '\n')
if (rows.some(row => row.error)) process.exitCode = 1
