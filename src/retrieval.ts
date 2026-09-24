import { tools, type Tool } from './tools.js'

function cosine(a: number[], b: number[]): number {
  const dot = a.reduce((sum, value, i) => sum + value * b[i], 0)
  const lengthA = Math.sqrt(a.reduce((sum, value) => sum + value * value, 0))
  const lengthB = Math.sqrt(b.reduce((sum, value) => sum + value * value, 0))
  return dot / (lengthA * lengthB || 1)
}

export async function selectTools(question: string, mode: 'all' | 'str' | 'str_cp', topK = 2): Promise<Tool[]> {
  if (mode === 'all') return tools
  const request = () => fetch('http://127.0.0.1:11434/api/embed', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'embeddinggemma', input: [question, ...tools.map(tool => tool.description)] })
  })
  let response = await request()
  if (response.status >= 500) {
    await new Promise(resolve => setTimeout(resolve, 500))
    response = await request()
  }
  if (!response.ok) throw new Error(`Embedding request failed: ${response.status} ${await response.text()}`)
  const body = await response.json() as { embeddings: number[][] }
  if (body.embeddings.length !== tools.length + 1) throw new Error('Unexpected embedding count')
  const ranked = tools.map((tool, i) => ({ tool, score: cosine(body.embeddings[0], body.embeddings[i + 1]) }))
    .sort((a, b) => b.score - a.score)
  const selected = new Set(ranked.slice(0, Math.min(tools.length, Math.max(1, topK))).map(item => item.tool.name))
  const lower = question.toLowerCase()
  if (/ticket|support|complaint|issue/.test(lower)) selected.add('support_tickets')
  if (/order|shipment|deliver/.test(lower)) selected.add('customer_orders')
  if (/stock|inventory|available/.test(lower)) selected.add('inventory_status')
  if (/policy|refund|escalat/.test(lower)) selected.add('policy_lookup')
  return tools.filter(tool => selected.has(tool.name))
}
