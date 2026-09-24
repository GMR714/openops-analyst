import type { Evidence } from './tools.js'

export const checklistFields = [
  { id: 'identity', label: 'customer identity', description: 'the registered customer name and ID', tool: 'customer_profile' },
  { id: 'region', label: 'customer region', description: 'the customer region', tool: 'customer_profile' },
  { id: 'order_ids', label: 'order identifiers', description: 'the identifiers of relevant orders', tool: 'customer_orders' },
  { id: 'order_status', label: 'order status', description: 'the status of relevant orders', tool: 'customer_orders' },
  { id: 'promised_dates', label: 'promised dates', description: 'the promised dates of relevant orders', tool: 'customer_orders' },
  { id: 'order_products', label: 'ordered products', description: 'the products or quantities on relevant orders', tool: 'customer_orders' },
  { id: 'tickets', label: 'support tickets', description: 'the support ticket IDs, states and linked orders', tool: 'support_tickets' },
  { id: 'inventory', label: 'inventory availability', description: 'available stock and SKU for relevant products', tool: 'inventory_status' },
  { id: 'delay_policy', label: 'delay policy', description: 'the delay escalation rule', tool: 'policy_lookup' },
  { id: 'refund_policy', label: 'refund policy', description: 'the refund eligibility rule', tool: 'policy_lookup' },
  { id: 'basic_profile', label: 'basic customer profile', description: 'basic customer details as a group: name, ID and region', tool: 'customer_profile' }
] as const

export type FieldId = typeof checklistFields[number]['id']

export function requiredFields(scores: Record<string, number>, threshold: number): FieldId[] {
  const selected = new Set<FieldId>(checklistFields.filter(field => (scores[field.id] ?? 0) >= threshold).map(field => field.id))
  if (selected.delete('basic_profile')) {
    selected.add('identity')
    selected.add('region')
  }
  return [...selected]
}

export function checklistTools(fields: FieldId[]): string[] {
  return [...new Set(checklistFields.filter(field => fields.includes(field.id)).map(field => field.tool))]
}

export function factSheet(evidence: Evidence[]): Record<string, unknown> {
  const pick = (prefix: string, keys: string[]) => evidence.filter(item => item.source.startsWith(prefix)).map(item => ({
    source: item.source,
    ...Object.fromEntries(keys.filter(key => item.payload[key] !== undefined).map(key => [key, item.payload[key]]))
  }))
  return {
    customers: pick('customers:', ['id', 'name', 'region']),
    orders: pick('orders:', ['id', 'status', 'promisedOn', 'product', 'units']),
    tickets: pick('tickets:', ['id', 'status', 'orderId', 'category', 'summary']),
    inventory: pick('inventory:', ['sku', 'name', 'available']),
    policies: pick('policy:', ['topic', 'text'])
  }
}
