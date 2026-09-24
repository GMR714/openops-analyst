import type { Evidence } from './tools.js'

export function requiredEvidence(question: string, evidence: Evidence[]): string[] {
  const lower = question.toLowerCase()
  const required = new Set<string>()
  const orders = evidence.filter(item => item.source.startsWith('orders:'))
  const tickets = evidence.filter(item => item.source.startsWith('tickets:'))
  if (/delayed/.test(lower) && /ticket/.test(lower)) {
    const delayed = orders.filter(item => item.payload.status === 'delayed')
    for (const order of delayed) required.add(order.source)
    for (const ticket of tickets.filter(item => item.payload.status === 'open' && delayed.some(order => order.payload.id === item.payload.orderId))) required.add(ticket.source)
  }
  if (/which orders are shipped/.test(lower)) for (const order of orders.filter(item => item.payload.status === 'shipped')) required.add(order.source)
  if (/refund/.test(lower)) for (const policy of evidence.filter(item => item.source === 'policy:refund')) required.add(policy.source)
  if (/delay policy/.test(lower)) {
    for (const policy of evidence.filter(item => item.source === 'policy:delay')) required.add(policy.source)
    const orderId = question.match(/\bO-\d{4}\b/)?.[0]
    if (orderId) for (const order of orders.filter(item => item.payload.id === orderId)) required.add(order.source)
  }
  if (/region/.test(lower)) for (const customer of evidence.filter(item => item.source.startsWith('customers:'))) required.add(customer.source)
  if (/stock|inventory|available/.test(lower)) for (const item of evidence.filter(item => item.source.startsWith('inventory:') && lower.includes(String(item.payload.name).toLowerCase()))) required.add(item.source)
  return [...required]
}

export function groundedFallback(question: string, evidence: Evidence[]): { answer: string; citations: string[]; cannotAnswer: false } | undefined {
  const lower = question.toLowerCase()
  if (/delayed/.test(lower) && /ticket/.test(lower)) {
    const delayed = evidence.filter(item => item.source.startsWith('orders:') && item.payload.status === 'delayed')
    if (!delayed.length) return undefined
    const linked = evidence.filter(item => item.source.startsWith('tickets:') && item.payload.status === 'open' && delayed.some(order => order.payload.id === item.payload.orderId))
    const orderText = delayed.map(item => `${item.payload.id} (promised ${item.payload.promisedOn})`).join(', ')
    const ticketText = linked.length ? linked.map(item => `${item.payload.id} for ${item.payload.orderId}`).join(', ') : 'none in the available records'
    return { answer: `Delayed orders: ${orderText}. Open support tickets linked to these orders: ${ticketText}.`, citations: [...delayed, ...linked].map(item => item.source), cannotAnswer: false }
  }
  if (/which orders are shipped/.test(lower)) {
    const shipped = evidence.filter(item => item.source.startsWith('orders:') && item.payload.status === 'shipped')
    if (!shipped.length) return undefined
    return { answer: `Shipped orders: ${shipped.map(item => `${item.payload.id} (promised ${item.payload.promisedOn})`).join(', ')}.`, citations: shipped.map(item => item.source), cannotAnswer: false }
  }
  return undefined
}
