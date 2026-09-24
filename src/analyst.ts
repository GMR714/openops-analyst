import { StateGraph, StateSchema, START, END } from '@langchain/langgraph'
import { z } from 'zod/v4'
import { resolveCustomer } from './fixtures.js'
import { selectTools } from './retrieval.js'
import { compact, type Evidence } from './tools.js'
import { collectEvidence } from './mcp_client.js'
import { decideDelayEscalation, decideRefundEligibility, verifyAnswer } from './verify.js'

export type Mode = 'all' | 'str' | 'str_cp'
export type Analysis = { answer: string; citations: string[]; cannotAnswer: boolean; evidence: Evidence[]; tools: string[]; tokens: number; elapsedMs: number; resolution: 'model' | 'rule' | 'abstain' }

const State = new StateSchema({
  question: z.string(),
  mode: z.enum(['all', 'str', 'str_cp']),
  selected: z.array(z.string()).default([]),
  evidence: z.array(z.object({ source: z.string(), payload: z.record(z.string(), z.unknown()) })).default([]),
  answer: z.string().default(''),
  citations: z.array(z.string()).default([]),
  cannotAnswer: z.boolean().default(false),
  tokens: z.number().default(0),
  resolution: z.enum(['model', 'rule', 'abstain']).default('model')
})

export async function analyze(question: string, mode: Mode = 'str_cp', model = process.env.OLLAMA_MODEL || 'qwen3:4b'): Promise<Analysis> {
  const started = performance.now()
  const selectedTools = await selectTools(question, mode)
  const graph = new StateGraph(State)
    .addNode('route', async () => ({ selected: selectedTools.map(tool => tool.name) }))
    .addNode('collect', async state => {
      const customer = resolveCustomer(state.question)
      if (!customer) return { evidence: [] }
      const raw = await collectEvidence(selectedTools, customer.id)
      return { evidence: mode === 'str_cp' ? compact(raw) : raw }
    })
    .addNode('respond', async state => {
      if (!state.evidence.length) return { answer: 'The available records do not identify a single customer or do not cover this question.', cannotAnswer: true, citations: [], resolution: 'abstain' }
      const system = 'Answer only from the supplied records. Return JSON with answer (string), citations (array of source IDs used), and cannotAnswer (boolean). Give a concise explanation, not a yes-or-no fragment. When the answer applies a policy to an order or ticket, state the relevant record fact and the policy rule, and cite both source IDs. If a requested fact is absent, say what is missing. Never infer a refund, delivery, or policy outcome from an unrelated field. Cite only supplied source IDs.'
      const answerSchema = z.object({ answer: z.string(), citations: z.array(z.string()), cannotAnswer: z.boolean() })
      const messages: Array<{ role: string; content: string }> = [
        { role: 'system', content: system },
        { role: 'user', content: JSON.stringify({ question: state.question, records: state.evidence }) }
      ]
      const available = new Set(state.evidence.map(item => item.source))
      let tokens = 0
      for (let attempt = 0; attempt < 2; attempt++) {
        const response = await fetch('http://127.0.0.1:11434/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model, stream: false, think: false, format: z.toJSONSchema(answerSchema), options: { temperature: 0, num_ctx: 8192 }, messages })
        })
        if (!response.ok) throw new Error(`Model request failed: ${response.status}`)
        const body = await response.json() as { message?: { content?: string }; prompt_eval_count?: number; eval_count?: number }
        tokens += (body.prompt_eval_count || 0) + (body.eval_count || 0)
        const parsed = answerSchema.parse(JSON.parse(body.message?.content || '{}'))
        const citations = [...new Set(parsed.citations.filter(source => available.has(source)))]
        const draft = { ...parsed, citations }
        const issues = verifyAnswer(state.question, state.evidence, draft)
        if (!issues.length) return { ...draft, cannotAnswer: draft.cannotAnswer || (!citations.length && !draft.cannotAnswer), tokens, resolution: 'model' }
        const decision = decideDelayEscalation(state.question, state.evidence) || decideRefundEligibility(state.question, state.evidence)
        if (decision) return { ...decision, tokens, resolution: 'rule' }
        messages.push({ role: 'assistant', content: JSON.stringify(draft) })
        messages.push({ role: 'user', content: `Revise the answer using these record checks: ${issues.join(' ')}` })
      }
      return { answer: 'The answer could not be verified against the collected records.', citations: [], cannotAnswer: true, tokens, resolution: 'abstain' }

    })
    .addEdge(START, 'route')
    .addEdge('route', 'collect')
    .addEdge('collect', 'respond')
    .addEdge('respond', END)
    .compile()
  const result = await graph.invoke({ question, mode })
  return { answer: result.answer, citations: result.citations, cannotAnswer: result.cannotAnswer, evidence: result.evidence, tools: result.selected, tokens: result.tokens, elapsedMs: Math.round(performance.now() - started), resolution: result.resolution }
}
