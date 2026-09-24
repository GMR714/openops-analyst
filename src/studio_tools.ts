import { inventory, orders, policies, tickets } from './fixtures.js'
import { tools, type Tool } from './tools.js'

const focused: Tool[] = [
  {
    name: 'customer_identity',
    description: 'Read the registered customer name, identifier and region. Input: customerId.',
    run: customerId => tools[0].run(customerId)
  },
  {
    name: 'delayed_orders',
    description: 'List delayed orders with order ID, promised date, product, units and status. Input: customerId.',
    run: customerId => orders.filter(row => row.customerId === customerId && row.status === 'delayed').map(row => ({ source: row.source, payload: row }))
  },
  {
    name: 'shipped_orders',
    description: 'List shipped orders with order ID, promised date, product and units. Input: customerId.',
    run: customerId => orders.filter(row => row.customerId === customerId && row.status === 'shipped').map(row => ({ source: row.source, payload: row }))
  },
  {
    name: 'open_tickets',
    description: 'Read open support tickets, their category and linked order ID. Input: customerId.',
    run: customerId => tickets.filter(row => row.customerId === customerId && row.status === 'open').map(row => ({ source: row.source, payload: row }))
  },
  {
    name: 'billing_tickets',
    description: 'Read billing support tickets and linked orders. Input: customerId.',
    run: customerId => tickets.filter(row => row.customerId === customerId && row.category === 'billing').map(row => ({ source: row.source, payload: row }))
  },
  {
    name: 'quality_tickets',
    description: 'Read product quality support tickets and linked orders. Input: customerId.',
    run: customerId => tickets.filter(row => row.customerId === customerId && row.category === 'quality').map(row => ({ source: row.source, payload: row }))
  },
  {
    name: 'stock_shortages',
    description: 'Read products whose available stock is zero, with SKU and product name. Input: customerId is ignored.',
    run: () => inventory.filter(row => row.available === 0).map(row => ({ source: row.source, payload: row }))
  },
  {
    name: 'delay_policy',
    description: 'Read the published delay escalation rule and its source ID. Input: customerId is ignored.',
    run: () => policies.filter(row => row.topic === 'delay').map(row => ({ source: row.source, payload: row }))
  },
  {
    name: 'refund_policy',
    description: 'Read the published refund eligibility rule and its source ID. Input: customerId is ignored.',
    run: () => policies.filter(row => row.topic === 'refund').map(row => ({ source: row.source, payload: row }))
  }
]

export const studioTools: Tool[] = [...tools, ...focused]
