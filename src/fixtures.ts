export type Customer = { id: string; name: string; region: string }
export type Order = { id: string; customerId: string; product: string; units: number; status: 'shipped' | 'delayed' | 'delivered'; promisedOn: string; source: string; audit: string }
export type Ticket = { id: string; customerId: string; orderId: string; category: 'delivery' | 'quality' | 'billing'; status: 'open' | 'closed'; summary: string; internalLog: string; source: string }
export type Product = { sku: string; name: string; available: number; source: string }

const names = [
  'Northstar Supply', 'Morrow Retail', 'Juniper Works', 'Ridgeway Foods',
  'Brightwell Labs', 'Harborcraft', 'Pinecrest Stores', 'Westbridge Tools',
  'Amberline Market', 'Bluefield Systems', 'Cedar Street Co', 'Summit House'
]
const products = [
  { sku: 'P-101', name: 'Atlas Sensor', available: 48, source: 'inventory:P-101' },
  { sku: 'P-102', name: 'Orion Gateway', available: 13, source: 'inventory:P-102' },
  { sku: 'P-103', name: 'Nova Controller', available: 0, source: 'inventory:P-103' },
  { sku: 'P-104', name: 'Lumen Kit', available: 27, source: 'inventory:P-104' }
] satisfies Product[]

export const customers: Customer[] = names.map((name, i) => ({
  id: `C-${String(i + 1).padStart(3, '0')}`,
  name,
  region: ['North', 'South', 'East', 'West'][i % 4]
}))

export const inventory = products

export const orders: Order[] = customers.flatMap((customer, i) =>
  products.map((product, j) => {
    const id = `O-${String(i * products.length + j + 1).padStart(4, '0')}`
    const status = (i + j) % 7 === 0 ? 'delayed' : (i + j) % 3 === 0 ? 'delivered' : 'shipped'
    return {
      id, customerId: customer.id, product: product.name, units: 2 + ((i * 3 + j) % 12), status,
      promisedOn: `2026-10-${String(1 + ((i * 5 + j) % 25)).padStart(2, '0')}`,
      source: `orders:${id}`,
      audit: `Batch ${i + 1} was imported by a synthetic warehouse job. `.repeat(5)
    }
  })
)

export const tickets: Ticket[] = orders.filter((_, i) => i % 3 === 0).map((order, i) => ({
  id: `T-${String(i + 1).padStart(4, '0')}`,
  customerId: order.customerId,
  orderId: order.id,
  category: order.status === 'delayed' ? 'delivery' : i % 2 === 0 ? 'quality' : 'billing',
  status: i % 4 === 0 ? 'open' : 'closed',
  summary: order.status === 'delayed' ? `Shipment for ${order.id} missed the expected dispatch window.` : `Customer asked for a review of ${order.id}.`,
  internalLog: `Synthetic note for ${order.id}. No customer data is present. `.repeat(8),
  source: `tickets:T-${String(i + 1).padStart(4, '0')}`
}))

export const policies = [
  { topic: 'delay', text: 'A delayed order may be escalated after its promised date. Confirm the order status before recommending escalation.', source: 'policy:delay' },
  { topic: 'refund', text: 'A refund requires a verified billing issue or an approved return. An open ticket alone does not establish eligibility.', source: 'policy:refund' }
]

export function resolveCustomer(question: string): Customer | undefined {
  const matches = customers.filter(customer => question.toLowerCase().includes(customer.name.toLowerCase()))
  return matches.length === 1 ? matches[0] : undefined
}
