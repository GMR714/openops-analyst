import assert from 'node:assert/strict'
import test from 'node:test'
import { pipelineSchema, type Pipeline } from '../src/architecture.js'
import { orders, tickets } from '../src/fixtures.js'
import { groundedFallback, requiredEvidence } from '../src/guardrails.js'

test('rejects incompatible memory modules and out-of-order stages', () => {
  const conflicting: Pipeline = { blocks: [{ id: 'mb', params: {} }, { id: 'm1', params: {} }] }
  const outOfOrder: Pipeline = { blocks: [{ id: 'rr', params: {} }, { id: 'str', params: {} }] }
  assert.equal(pipelineSchema.safeParse(conflicting).success, false)
  assert.equal(pipelineSchema.safeParse(outOfOrder).success, false)
})

test('retrieve-then-solve retains all records needed for a linked order and ticket answer', () => {
  const evidence = [
    ...orders.filter(item => item.customerId === 'C-001'),
    ...tickets.filter(item => item.customerId === 'C-001')
  ].map(item => ({ source: item.source, payload: { ...item } }))
  const question = 'For Northstar Supply, which orders are delayed and are there open support tickets for them?'
  assert.deepEqual(requiredEvidence(question, evidence), ['orders:O-0001', 'tickets:T-0001'])
  const decision = groundedFallback(question, evidence)
  assert.ok(decision?.answer.includes('O-0001'))
  assert.ok(decision?.answer.includes('T-0001'))
  assert.deepEqual(decision?.citations, ['orders:O-0001', 'tickets:T-0001'])
})
