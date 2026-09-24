import assert from 'node:assert/strict'
import test from 'node:test'
import { compact, tools } from '../src/tools.js'
import { customers } from '../src/fixtures.js'

test('every record has a stable source ID and belongs to the requested customer', () => {
  const customer = customers[0]
  const results = tools.filter(tool => ['customer_orders', 'support_tickets'].includes(tool.name)).flatMap(tool => tool.run(customer.id))
  assert.ok(results.length > 0)
  assert.ok(results.every(result => result.source && result.payload.customerId === customer.id))
})

test('payload compression preserves evidence and factual fields', () => {
  const raw = tools.find(tool => tool.name === 'customer_orders')!.run(customers[0].id)
  const reduced = compact(raw)
  assert.deepEqual(reduced.map(item => item.source), raw.map(item => item.source))
  assert.deepEqual(reduced.map(item => item.payload.status), raw.map(item => item.payload.status))
  assert.ok(JSON.stringify(reduced).length < JSON.stringify(raw).length)
})
