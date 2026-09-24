import { z } from 'zod/v4'

export const JEV_MODEL = 'jev-1.13.0'
type Question = { type: 'noul'; instructions: string }
type BatchResult = { scores: Record<string, number>; inputTokens: number; outputTokens: number; elapsedMs: number }

const responseSchema = z.object({
  model: z.literal(JEV_MODEL),
  answers: z.record(z.string(), z.object({ type: z.literal('noul'), noul: z.number().finite().min(0).max(1) })),
  usage: z.object({ input_tokens: z.number().int().nonnegative(), output_tokens: z.number().int().nonnegative() })
})

export function jevConfigured(): boolean {
  return Boolean(process.env.TYPESAFE_API_KEY)
}

export async function askJev(state: unknown, questions: Record<string, Question>): Promise<BatchResult> {
  const key = process.env.TYPESAFE_API_KEY
  if (!key) throw new Error('TYPESAFE_API_KEY is not configured')
  const began = performance.now()
  let response: Response | undefined
  for (let attempt = 0; attempt < 3; attempt++) {
    response = await fetch('https://api.typesafe.ai/v1/systemone', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: JEV_MODEL, state, questions }),
      signal: AbortSignal.timeout(15_000)
    })
    if (![429, 529].includes(response.status) || attempt === 2) break
    await new Promise(resolve => setTimeout(resolve, 400 * 2 ** attempt))
  }
  if (!response?.ok) throw new Error(`Jev request failed: HTTP ${response?.status || 'unknown'}`)
  const body = responseSchema.parse(await response.json())
  const expected = Object.keys(questions)
  if (Object.keys(body.answers).length !== expected.length || expected.some(id => !body.answers[id])) throw new Error('Jev returned an incomplete batch')
  return {
    scores: Object.fromEntries(expected.map(id => [id, body.answers[id].noul])),
    inputTokens: body.usage.input_tokens,
    outputTokens: body.usage.output_tokens,
    elapsedMs: Math.round(performance.now() - began)
  }
}
