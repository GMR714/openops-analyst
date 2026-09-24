import type { Evidence } from './tools.js'

type Draft = { answer: string; citations: string[]; cannotAnswer: boolean }

export function verifyAnswer(question: string, evidence: Evidence[], draft: Draft): string[] {
  if (draft.cannotAnswer) return []
  const issues: string[] = []
  const cited = new Set(draft.citations)
  const available = new Set(evidence.map(item => item.source))
  const lower = question.toLowerCase()
  const required = new Set<string>()
  const orders = evidence.filter(item => item.source.startsWith('orders:'))
  const tickets = evidence.filter(item => item.source.startsWith('tickets:'))

  for (const id of draft.answer.match(/\b[OT]-\d{4}\b/g) || []) {
    const source = `${id.startsWith('O') ? 'orders' : 'tickets'}:${id}`
    if (available.has(source)) required.add(source)
  }

  if (/which orders are shipped/.test(lower)) {
    for (const item of orders.filter(item => item.payload.status === 'shipped')) {
      required.add(item.source)
      if (!draft.answer.includes(String(item.payload.id))) issues.push(`The answer omits shipped order ${item.payload.id}.`)
    }
  }

  if (/delayed/.test(lower) && /ticket/.test(lower)) {
    const delayed = orders.filter(item => item.payload.status === 'delayed')
    for (const item of delayed) {
      required.add(item.source)
      if (!draft.answer.includes(String(item.payload.id))) issues.push(`The answer omits delayed order ${item.payload.id}.`)
    }
    for (const item of tickets.filter(item => item.payload.status === 'open' && delayed.some(order => order.payload.id === item.payload.orderId))) {
      required.add(item.source)
      if (!draft.answer.includes(String(item.payload.id))) issues.push(`The answer omits open ticket ${item.payload.id}.`)
    }
  }

  if (/refund/.test(lower) && /open support ticket/.test(lower)) {
    if (!/\b(ticket|billing|return)\b/i.test(draft.answer) || draft.answer.length < 30) issues.push('Explain why a ticket alone does not establish refund eligibility.')
    if (available.has('policy:refund')) required.add('policy:refund')
  }

  if (/delay policy/.test(lower) && /escalat/.test(lower)) {
    const date = question.match(/\b20\d{2}-\d{2}-\d{2}\b/)?.[0]
    const orderId = question.match(/\bO-\d{4}\b/)?.[0]
    const order = orders.find(item => item.payload.id === orderId)
    const policy = evidence.find(item => item.source === 'policy:delay')
    if (!date || !order || !policy) issues.push('A dated escalation decision needs its order and delay policy.')
    else {
      required.add(order.source)
      required.add(policy.source)
      const eligible = order.payload.status === 'delayed' && date > String(order.payload.promisedOn)
      const startsYes = /^\s*yes\b/i.test(draft.answer)
      const startsNo = /^\s*no\b/i.test(draft.answer)
      if (eligible ? !startsYes : !startsNo) issues.push(`The policy decision must be ${eligible ? 'Yes' : 'No'} as of ${date}.`)
      if (!draft.answer.includes(String(order.payload.promisedOn))) issues.push(`State the promised date ${order.payload.promisedOn}.`)
    }
  }

  for (const source of required) if (!cited.has(source)) issues.push(`Cite ${source}.`)
  return issues
}

export function decideDelayEscalation(question: string, evidence: Evidence[]): { answer: string; citations: string[]; cannotAnswer: false } | undefined {
  if (!/delay policy/i.test(question) || !/escalat/i.test(question)) return undefined
  const date = question.match(/\b20\d{2}-\d{2}-\d{2}\b/)?.[0]
  const orderId = question.match(/\bO-\d{4}\b/)?.[0]
  const order = evidence.find(item => item.source === `orders:${orderId}`)
  const policy = evidence.find(item => item.source === 'policy:delay')
  if (!date || !order || !policy || !String(policy.payload.text).includes('after its promised date')) return undefined
  const promisedOn = String(order.payload.promisedOn)
  const status = String(order.payload.status)
  const eligible = status === 'delayed' && date > promisedOn
  const answer = eligible
    ? `Yes. Order ${orderId} is delayed and its promised date ${promisedOn} has passed as of ${date}. The delay policy permits escalation after the promised date.`
    : status !== 'delayed'
      ? `No. Order ${orderId} has status ${status} as of ${date}; the delay policy applies to delayed orders after their promised date.`
      : `No. Order ${orderId} is delayed, but its promised date ${promisedOn} is after ${date}. The delay policy permits escalation only after the promised date.`
  return { answer, citations: [order.source, policy.source], cannotAnswer: false }
}

export function decideRefundEligibility(question: string, evidence: Evidence[]): { answer: string; citations: string[]; cannotAnswer: false } | undefined {
  if (!/refund/i.test(question) || !/open support ticket/i.test(question)) return undefined
  const policy = evidence.find(item => item.source === 'policy:refund')
  if (!policy || !String(policy.payload.text).includes('An open ticket alone does not establish eligibility')) return undefined
  return {
    answer: 'No. An open support ticket alone does not establish refund eligibility. The policy requires a verified billing issue or an approved return.',
    citations: [policy.source],
    cannotAnswer: false
  }
}
