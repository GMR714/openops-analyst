import assert from 'node:assert/strict'
import test from 'node:test'
import { orders, policies, tickets } from '../src/fixtures.js'
import { decideDelayEscalation, verifyAnswer } from '../src/verify.js'

test('rejects an escalation decision before the promised date', () => {
  const order = orders.find(row => row.id === 'O-0001')!
  const policy = policies.find(row => row.topic === 'delay')!
  const evidence = [order, policy].map(row => ({ source: row.source, payload: { ...row } }))
  const issues = verifyAnswer(
    'As of 2026-09-23, under the delay policy, can Northstar Supply escalate order O-0001?',
    evidence,
    { answer: 'Yes, order O-0001 can be escalated.', citations: ['orders:O-0001'], cannotAnswer: false }
  )
  assert.ok(issues.some(issue => issue.includes('must be No')))
  assert.ok(issues.some(issue => issue.includes('Cite policy:delay')))
})

test('requires the order and linked open ticket in a cross-source answer', () => {
  const order = orders.find(row => row.id === 'O-0001')!
  const ticket = tickets.find(row => row.orderId === order.id)!
  const evidence = [order, ticket].map(row => ({ source: row.source, payload: { ...row } }))
  const issues = verifyAnswer(
    'For Northstar Supply, which orders are delayed and are there open support tickets for them?',
    evidence,
    { answer: 'Order O-0001 is delayed and has an open ticket T-0001.', citations: ['orders:O-0001'], cannotAnswer: false }
  )
  assert.deepEqual(issues, ['Cite tickets:T-0001.'])
})


test('policy fallback produces a dated decision with both sources', () => {
  const order = orders.find(row => row.id === 'O-0001')!
  const policy = policies.find(row => row.topic === 'delay')!
  const evidence = [order, policy].map(row => ({ source: row.source, payload: { ...row } }))
  const decision = decideDelayEscalation(
    'As of 2026-09-23, under the delay policy, can Northstar Supply escalate order O-0001?',
    evidence
  )
  assert.ok(decision?.answer.startsWith('No.'))
  assert.deepEqual(decision?.citations, ['orders:O-0001', 'policy:delay'])
})
