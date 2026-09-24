import { z } from 'zod/v4'
import { architecture, parameter, pipelineSchema, type BlockId, type Pipeline, type PipelineBlock } from './architecture.js'
import { resolveCustomer } from './fixtures.js'
import { groundedFallback, requiredEvidence } from './guardrails.js'
import { collectEvidence } from './mcp_client.js'
import { selectTools } from './retrieval.js'
import { compact, tools, type Evidence, type Tool } from './tools.js'
import { decideDelayEscalation, decideRefundEligibility, verifyAnswer } from './verify.js'

export type Turn = { question: string; answer: string; tools?: string[] }
export type Trace = { block: BlockId; detail: string; ms: number; before?: number; after?: number }
export type PipelineResult = {
  answer: string
  citations: string[]
  cannotAnswer: boolean
  resolution: 'model' | 'rule' | 'abstain'
  evidence: Evidence[]
  tools: string[]
  tokens: number
  elapsedMs: number
  trace: Trace[]
  route: 'standard' | 'deep'
}

const draftSchema = z.object({ answer: z.string(), citations: z.array(z.string()), cannotAnswer: z.boolean() })
type Draft = z.infer<typeof draftSchema>

function words(text: string): Set<string> {
  return new Set(text.toLowerCase().match(/[a-z0-9]{3,}/g) || [])
}

function similarity(a: string, b: string): number {
  const left = words(a)
  const right = words(b)
  if (!left.size || !right.size) return 0
  let common = 0
  for (const term of left) if (right.has(term)) common++
  return common / Math.sqrt(left.size * right.size)
}

function graphRank(question: string, evidence: Evidence[], limit: number): Evidence[] {
  const neighbours = evidence.map(() => [] as number[])
  for (let i = 0; i < evidence.length; i++) {
    for (let j = i + 1; j < evidence.length; j++) {
      const a = evidence[i].payload
      const b = evidence[j].payload
      if ((a.customerId && a.customerId === b.customerId) || (a.orderId && a.orderId === b.id) || (b.orderId && b.orderId === a.id) || (a.product && a.product === b.name) || (b.product && b.product === a.name)) {
        neighbours[i].push(j)
        neighbours[j].push(i)
      }
    }
  }
  const seed = evidence.map(item => Math.max(.01, similarity(question, JSON.stringify(item.payload))))
  const total = seed.reduce((sum, score) => sum + score, 0)
  let rank = seed.map(score => score / total)
  for (let iteration = 0; iteration < 16; iteration++) {
    const next = seed.map(score => .45 * score / total)
    for (let i = 0; i < rank.length; i++) {
      if (!neighbours[i].length) { next[i] += .55 * rank[i]; continue }
      for (const j of neighbours[i]) next[j] += .55 * rank[i] / neighbours[i].length
    }
    rank = next
  }
  return evidence.map((item, i) => ({ item, score: rank[i], i }))
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .slice(0, limit).map(entry => entry.item)
}

function memoryText(id: BlockId, history: Turn[], block: PipelineBlock): string {
  if (!history.length) return ''
  const maxTurns = id === 'acc' ? 12 : parameter(block, 'maxTurns')
  const recent = history.slice(-maxTurns)
  if (id === 'mb') {
    const groups = new Map<string, Turn[]>()
    for (const turn of recent) {
      const area = /refund|policy|escalat/i.test(turn.question) ? 'policy' : /ticket|support/i.test(turn.question) ? 'support' : /stock|inventory/i.test(turn.question) ? 'inventory' : 'orders'
      const topic = (resolveCustomer(turn.question)?.name || 'General operations') + ' / ' + area
      groups.set(topic, [...(groups.get(topic) || []), turn])
    }
    return [...groups].map(([topic, turns]) => topic + ': ' + turns.map(turn => turn.question + ' → ' + turn.answer.slice(0, 160)).join(' | ')).join('\n')
  }
  if (id === 'm1') {
    return `Original goal: ${recent[0].question}\nAccumulated questions: ${recent.map(turn => turn.question).join(' | ')}\nLast observation: ${recent.at(-1)?.answer.slice(0, 280)}`
  }
  const entities = [...new Set(recent.map(turn => resolveCustomer(turn.question)?.name).filter(Boolean))]
  const constraints = recent.filter(turn => /policy|refund|delay|date/i.test(turn.question)).map(turn => turn.question)
  return JSON.stringify({ goal: recent.at(-1)?.question, entities, constraints: constraints.slice(-3), lastObservation: recent.at(-1)?.answer.slice(0, 180) }).slice(0, parameter(block, 'maxChars'))
}

async function chatJson<T>(model: string, schema: z.ZodType<T>, messages: Array<{ role: string; content: string }>): Promise<{ value: T; tokens: number }> {
  const response = await fetch('http://127.0.0.1:11434/api/chat', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, stream: false, think: false, format: z.toJSONSchema(schema), options: { temperature: 0, num_ctx: 8192 }, messages })
  })
  if (!response.ok) throw new Error(`Model request failed: ${response.status}`)
  const body = await response.json() as { message?: { content?: string }; prompt_eval_count?: number; eval_count?: number }
  return { value: schema.parse(JSON.parse(body.message?.content || '{}')), tokens: (body.prompt_eval_count || 0) + (body.eval_count || 0) }
}

function scoreQuestion(question: string): number {
  let score = 0
  if (/\b(which|compare|across|all|each|under|policy|between)\b/i.test(question)) score++
  if (/\b(and|also|linked|related|ticket|order)\b/i.test(question)) score++
  if (/\b(refund|escalat|eligible|why|evidence)\b/i.test(question)) score++
  if (question.split(/\s+/).length > 25) score++
  return score
}

function expandAutoTool(question: string, selected: Tool[], threshold: number, history: Turn[]): Tool[] {
  const transitions: Record<string, Array<{ next: string; cue: RegExp; weight: number }>> = {
    customer_orders: [{ next: 'support_tickets', cue: /ticket|support|issue|delay/i, weight: .82 }, { next: 'inventory_status', cue: /stock|available|product/i, weight: .68 }],
    support_tickets: [{ next: 'policy_lookup', cue: /refund|policy|eligible/i, weight: .78 }],
    inventory_status: [{ next: 'customer_orders', cue: /order|shipment/i, weight: .64 }]
  }
  const result = new Set(selected.map(tool => tool.name))
  const observed = new Map<string, Map<string, number>>()
  for (const turn of history) for (let i = 1; i < (turn.tools?.length || 0); i++) {
    const from = turn.tools![i - 1], to = turn.tools![i]
    const counts = observed.get(from) || new Map<string, number>()
    counts.set(to, (counts.get(to) || 0) + 1)
    observed.set(from, counts)
  }
  for (const current of selected) {
    for (const edge of transitions[current.name] || []) {
      if (edge.weight * 100 >= threshold && edge.cue.test(question)) result.add(edge.next)
    }
    const counts = observed.get(current.name)
    if (counts) for (const [next, count] of counts) {
      const candidate = tools.find(tool => tool.name === next)
      if (candidate && count / history.length * 100 >= threshold && similarity(question, candidate.description) > .1) result.add(next)
    }
  }
  const cap = selected.length + 1
  return [...selected, ...tools.filter(tool => result.has(tool.name) && !selected.some(chosen => chosen.name === tool.name)).slice(0, cap - selected.length)]
}


export async function analyzePipeline(question: string, pipelineInput: Pipeline, history: Turn[] = [], model = process.env.OLLAMA_MODEL || 'qwen3:4b'): Promise<PipelineResult> {
  const pipeline = pipelineSchema.parse(pipelineInput)
  const start = performance.now()
  const trace: Trace[] = []
  const chosen = (id: BlockId) => pipeline.blocks.find(block => block.id === id)
  const record = (id: BlockId, began: number, detail: string, before?: number, after?: number) => trace.push({ block: id, detail, ms: Math.round(performance.now() - began), before, after })
  const routeBlock = chosen('ar')
  const difficulty = scoreQuestion(question)
  const route = routeBlock && difficulty >= parameter(routeBlock, 'deepThreshold') ? 'deep' : 'standard'
  if (routeBlock) record('ar', performance.now(), `Route ${route}; difficulty ${difficulty}/4`)

  const memoryBlock = pipeline.blocks.find(block => ['mb', 'm1', 'acc'].includes(block.id))
  const customer = resolveCustomer(question) || (memoryBlock ? [...history].reverse().map(turn => resolveCustomer(turn.question)).find(Boolean) : undefined)
  let selected = tools
  const strBlock = chosen('str')
  if (strBlock) {
    const began = performance.now()
    selected = await selectTools(question, 'str', parameter(strBlock, 'topK') + (route === 'deep' ? 1 : 0))
    record('str', began, selected.map(tool => tool.name).join(', '), tools.length, selected.length)
  }
  const atBlock = chosen('at')
  if (atBlock) {
    const began = performance.now()
    const before = selected.length
    selected = expandAutoTool(question, selected, parameter(atBlock, 'threshold'), history)
    record('at', began, selected.map(tool => tool.name).join(', '), before, selected.length)
  }

  if (!customer) return { answer: 'No single customer could be identified in the question or conversation.', citations: [], cannotAnswer: true, resolution: 'abstain', evidence: [], tools: selected.map(tool => tool.name), tokens: 0, elapsedMs: Math.round(performance.now() - start), trace, route }
  let evidence = await collectEvidence(selected, customer.id)
  const original = evidence
  const trBlock = chosen('tr')
  if (trBlock) {
    const began = performance.now()
    evidence = graphRank(question, evidence, parameter(trBlock, 'maxRecords'))
    record('tr', began, `Evidence graph for ${customer.name}`, original.length, evidence.length)
  }
  const cpBlock = chosen('cp')
  if (cpBlock) {
    const began = performance.now()
    const before = JSON.stringify(evidence).length
    evidence = compact(evidence)
    record('cp', began, 'Removed diagnostic fields; source IDs preserved', before, JSON.stringify(evidence).length)
  }
  let tokens = 0
  const rtsBlock = chosen('rts')
  if (rtsBlock && evidence.length) {
    const began = performance.now()
    const ids = evidence.map(item => item.source)
    const selectionSchema = z.object({ sourceIds: z.array(z.string()).max(40) })
    const picked = await chatJson(model, selectionSchema, [
      { role: 'system', content: 'Select only source IDs necessary to answer the question. Preserve all records needed for lists, joins, and policy decisions. Return JSON.' },
      { role: 'user', content: JSON.stringify({ question, sources: evidence.map(item => ({ source: item.source, preview: JSON.stringify(item.payload).slice(0, 220) })) }) }
    ])
    tokens += picked.tokens
    const allowed = new Set(ids)
    const wanted = new Set(picked.value.sourceIds.filter(id => allowed.has(id)).slice(0, parameter(rtsBlock, 'maxRecords')))
    for (const id of requiredEvidence(question, evidence)) wanted.add(id)
    if (wanted.size) evidence = evidence.filter(item => wanted.has(item.source))
    record('rts', began, `${wanted.size || ids.length} verified source IDs recited`, ids.length, evidence.length)
  }
  let memory = ''
  if (memoryBlock) {
    const began = performance.now()
    memory = memoryText(memoryBlock.id, history, memoryBlock)
    record(memoryBlock.id, began, memory ? `${history.length} turn(s) condensed to ${memory.length} characters` : 'No earlier turns supplied', history.length, memory.length)
  }
  if (!evidence.length) return { answer: 'The selected tools returned no evidence for this customer.', citations: [], cannotAnswer: true, resolution: 'abstain', evidence, tools: selected.map(tool => tool.name), tokens, elapsedMs: Math.round(performance.now() - start), trace, route }

  const system = 'Answer only from the supplied records. Return JSON with answer, citations (source IDs), and cannotAnswer. Explain the relevant record fact and policy rule when applying a policy. Cite both sources. For lists, include every matching record. If evidence is insufficient, say so. Do not treat conversation memory as evidence.'
  const messages = [
    { role: 'system', content: system },
    { role: 'user', content: JSON.stringify({ question, records: evidence, conversationMemory: memory || undefined }) }
  ]
  const generated = await chatJson(model, draftSchema, messages)
  tokens += generated.tokens
  const available = new Set(evidence.map(item => item.source))
  let draft: Draft = { ...generated.value, citations: [...new Set(generated.value.citations.filter(id => available.has(id)))] }
  let resolution: PipelineResult['resolution'] = 'model'

  const rvBlock = chosen('rv')
  if (rvBlock && !draft.cannotAnswer) {
    const began = performance.now()
    const feedbackSchema = z.object({ issues: z.array(z.string()).max(5) })
    const feedback = await chatJson(model, feedbackSchema, [
      { role: 'system', content: 'Review the draft against records. Report concrete unsupported claims or omissions only. Return an empty issues array when sound.' },
      { role: 'user', content: JSON.stringify({ question, records: evidence, draft }) }
    ])
    tokens += feedback.tokens
    if (feedback.value.issues.length) {
      const repair = await chatJson(model, draftSchema, [...messages, { role: 'assistant', content: JSON.stringify(draft) }, { role: 'user', content: `Revise using this review: ${feedback.value.issues.join(' ')}` }])
      tokens += repair.tokens
      draft = { ...repair.value, citations: [...new Set(repair.value.citations.filter(id => available.has(id)))] }
    }
    record('rv', began, `${feedback.value.issues.length} issue(s); ${feedback.value.issues.length ? 'revised' : 'passed'}`)
  }
  const rrBlock = chosen('rr')
  if (rrBlock && !draft.cannotAnswer) {
    const began = performance.now()
    let issues = verifyAnswer(question, evidence, draft)
    if (issues.length) {
      const rule = decideDelayEscalation(question, evidence) || decideRefundEligibility(question, evidence) || groundedFallback(question, evidence)
      if (rule) { draft = rule; resolution = 'rule' }
      else {
        const repaired = await chatJson(model, draftSchema, [...messages, { role: 'assistant', content: JSON.stringify(draft) }, { role: 'user', content: `Fix these record checks: ${issues.join(' ')}` }])
        tokens += repaired.tokens
        draft = { ...repaired.value, citations: [...new Set(repaired.value.citations.filter(id => available.has(id)))] }
        issues = verifyAnswer(question, evidence, draft)
        if (issues.length) { draft = { answer: 'The answer could not be verified against the collected records.', citations: [], cannotAnswer: true }; resolution = 'abstain' }
      }
    }
    record('rr', began, resolution === 'rule' ? 'Grounded fallback' : resolution === 'abstain' ? 'Abstained after failed repair' : 'Source checks passed')
  }
  if (!draft.cannotAnswer && !draft.citations.length) { draft = { answer: 'The answer had no verifiable source citation.', citations: [], cannotAnswer: true }; resolution = 'abstain' }
  return { ...draft, resolution, evidence, tools: selected.map(tool => tool.name), tokens, elapsedMs: Math.round(performance.now() - start), trace, route }
}

export const publicArchitecture = architecture.map(({ id, name, stage, summary, paper, url, relation, settings }) => ({ id, name, stage, summary, paper, url, relation, settings }))
