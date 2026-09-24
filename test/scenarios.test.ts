import assert from 'node:assert/strict'
import test from 'node:test'
import { customers } from '../src/fixtures.js'
import { publicScenarios, scenarios } from '../src/scenarios.js'
import { studioTools } from '../src/studio_tools.js'

test('scenario gold sources exist and stay out of the browser catalog', () => {
  const sources = new Set(customers.flatMap(customer => studioTools.flatMap(tool => tool.run(customer.id).map(item => item.source))))
  assert.equal(new Set(scenarios.map(item => item.id)).size, scenarios.length)
  assert.ok(scenarios.some(item => item.difficulty === 'easy'))
  assert.ok(scenarios.some(item => item.difficulty === 'hard'))
  for (const scenario of scenarios) {
    assert.ok(scenario.expected.sources.every(source => sources.has(source)), scenario.id)
    assert.ok(scenario.expected.outcome === 'abstain' || scenario.expected.sources.length > 0, scenario.id)
  }
  assert.ok(publicScenarios.every(item => !('expected' in item)))
})
