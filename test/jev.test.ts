import assert from 'node:assert/strict'
import test from 'node:test'
import { pipelineSchema } from '../src/architecture.js'
import { checklistTools, requiredFields } from '../src/checklist.js'
import { askJev } from '../src/jev.js'
import { studioTools } from '../src/studio_tools.js'

test('Jev sends one typed batch and validates the pinned response', async () => {
  const originalFetch = globalThis.fetch
  const originalKey = process.env.TYPESAFE_API_KEY
  let calls = 0
  process.env.TYPESAFE_API_KEY = 'test-only-key'
  globalThis.fetch = async (_input, init) => {
    calls++
    const body = JSON.parse(String(init?.body))
    assert.equal(body.model, 'jev-1.13.0')
    assert.deepEqual(Object.keys(body.questions), ['identity', 'orders'])
    assert.deepEqual(body.state, { user_request: 'Which orders?' })
    assert.equal(init?.headers && (init.headers as Record<string, string>).Authorization, 'Bearer test-only-key')
    return Response.json({
      model: 'jev-1.13.0',
      answers: { identity: { type: 'noul', noul: 0.2 }, orders: { type: 'noul', noul: 0.91 } },
      usage: { input_tokens: 140, output_tokens: 12 }
    })
  }
  try {
    const result = await askJev({ user_request: 'Which orders?' }, {
      identity: { type: 'noul', instructions: 'Need identity?' },
      orders: { type: 'noul', instructions: 'Need orders?' }
    })
    assert.equal(calls, 1)
    assert.deepEqual(result.scores, { identity: 0.2, orders: 0.91 })
    assert.equal(result.inputTokens, 140)
  } finally {
    globalThis.fetch = originalFetch
    if (originalKey === undefined) delete process.env.TYPESAFE_API_KEY
    else process.env.TYPESAFE_API_KEY = originalKey
  }
})

test('compound checklist expands before the fact gate and tool selectors are exclusive', () => {
  const fields = requiredFields({ basic_profile: 0.7, tickets: 0.8 }, 0.5)
  assert.deepEqual(fields, ['tickets', 'identity', 'region'])
  assert.deepEqual(checklistTools(fields), ['customer_profile', 'support_tickets'])
  assert.equal(pipelineSchema.safeParse({ blocks: [{ id: 'str', params: {} }, { id: 'js', params: {} }] }).success, false)
  assert.ok(studioTools.length > 12)
  assert.ok(studioTools.every(tool => tool.description.includes('Input:') || tool.description.length > 40))
})
