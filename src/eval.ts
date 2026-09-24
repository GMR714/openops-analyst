import { mkdir, writeFile } from 'node:fs/promises'
import { analyze, type Mode } from './analyst.js'

type Case = { id: string; question: string; requiredSources: string[] }

const cases: Case[] = [
  {
    id: 'delayed-ticket',
    question: 'For Northstar Supply, which orders are delayed and are there open support tickets for them?',
    requiredSources: ['orders:O-0001', 'tickets:T-0001']
  },
  {
    id: 'stock',
    question: 'For Northstar Supply, how many Nova Controllers are available in inventory?',
    requiredSources: ['inventory:P-103']
  },
  {
    id: 'customer-region',
    question: 'Which region is Northstar Supply in?',
    requiredSources: ['customers:C-001']
  },
  {
    id: 'refund-policy',
    question: 'Does an open support ticket by Northstar Supply alone make the customer eligible for a refund under the policy?',
    requiredSources: ['policy:refund']
  },
  {
    id: 'delay-policy',
    question: 'As of 2026-09-23, under the delay policy, can Northstar Supply escalate order O-0001?',
    requiredSources: ['orders:O-0001', 'policy:delay']
  },
  {
    id: 'shipped-orders',
    question: 'For Morrow Retail, which orders are shipped and what are their promised dates?',
    requiredSources: ['orders:O-0005', 'orders:O-0006', 'orders:O-0008']
  }
]

const modes: Mode[] = ['all', 'str', 'str_cp']
const rows: Array<Record<string, unknown>> = []
for (const item of cases) {
  for (const mode of modes) {
    try {
      const result = await analyze(item.question, mode)
      const evidence = new Set(result.evidence.map(record => record.source))
      const citations = new Set(result.citations)
      rows.push({
        id: item.id, mode, question: item.question, requiredSources: item.requiredSources,
        answer: result.answer, citations: result.citations, tools: result.tools,
        evidenceCount: result.evidence.length, tokens: result.tokens, elapsedMs: result.elapsedMs,
        evidenceRecall: item.requiredSources.filter(source => evidence.has(source)).length / item.requiredSources.length,
        citationRecall: item.requiredSources.filter(source => citations.has(source)).length / item.requiredSources.length,
        cannotAnswer: result.cannotAnswer, resolution: result.resolution
      })
    } catch (error) {
      rows.push({ id: item.id, mode, error: error instanceof Error ? error.message : String(error) })
    }
    process.stdout.write(`${item.id} ${mode}\n`)
  }
}

const summaries = modes.map(mode => {
  const subset = rows.filter(row => row.mode === mode)
  const valid = subset.filter(row => 'tokens' in row)
  const average = (key: 'tokens' | 'elapsedMs' | 'evidenceRecall' | 'citationRecall') =>
    valid.length ? valid.reduce((sum, row) => sum + Number(row[key]), 0) / valid.length : null
  return { mode, cases: subset.length, completed: valid.length, meanTokens: average('tokens'),
    meanElapsedMs: average('elapsedMs'), meanEvidenceRecall: average('evidenceRecall'),
    meanCitationRecall: average('citationRecall'), ruleFallbacks: valid.filter(row => row.resolution === 'rule').length }
})

await mkdir('results', { recursive: true })
await writeFile('results/ablation.json', JSON.stringify({ model: process.env.OLLAMA_MODEL || 'qwen3:4b',
  embeddingModel: 'embeddinggemma', cases: rows, summaries }, null, 2) + '\n')
process.stdout.write(`${JSON.stringify(summaries, null, 2)}\n`)
if (summaries.some(summary => summary.completed !== summary.cases)) process.exitCode = 1
