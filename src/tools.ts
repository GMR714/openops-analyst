import { customers, inventory, orders, policies, tickets } from './fixtures.js'

export type Evidence = { source: string; payload: Record<string, unknown> }
export type Tool = { name: string; description: string; run: (customerId?: string) => Evidence[] }

export const tools: Tool[] = [
  {
    name: 'customer_profile',
    description: 'Resolve a company and its region in the customer registry.',
    run: customerId => customers.filter(row => row.id === customerId).map(row => ({ source: `customers:${row.id}`, payload: row }))
  },
  {
    name: 'customer_orders',
    description: 'Read order status, promised date, product and quantity for a customer.',
    run: customerId => orders.filter(row => row.customerId === customerId).map(row => ({ source: row.source, payload: row }))
  },
  {
    name: 'support_tickets',
    description: 'Read open and closed support tickets and their linked orders for a customer.',
    run: customerId => tickets.filter(row => row.customerId === customerId).map(row => ({ source: row.source, payload: row }))
  },
  {
    name: 'inventory_status',
    description: 'Read available stock by product name and SKU.',
    run: () => inventory.map(row => ({ source: row.source, payload: row }))
  },
  {
    name: 'policy_lookup',
    description: 'Read published delay escalation and refund policy.',
    run: () => policies.map(row => ({ source: row.source, payload: row }))
  }
]

export function compact(evidence: Evidence[]): Evidence[] {
  return evidence.map(({ source, payload }) => {
    const kept = Object.fromEntries(Object.entries(payload).filter(([key, value]) =>
      value !== null && value !== '' && key !== 'audit' && key !== 'internalLog' && key !== 'source'
    ))
    return { source, payload: kept }
  })
}
