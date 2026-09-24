import { Client } from '@modelcontextprotocol/client'
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio'
import { z } from 'zod/v4'
import type { Evidence, Tool } from './tools.js'

const EvidenceSchema = z.array(z.object({ source: z.string(), payload: z.record(z.string(), z.unknown()) }))

export async function collectEvidence(selected: Tool[], customerId: string): Promise<Evidence[]> {
  const client = new Client({ name: 'openops-analyst', version: '0.1.0' })
  const transport = new StdioClientTransport({ command: process.execPath, args: ['--import', 'tsx', 'src/mcp_server.ts'] })
  try {
    await client.connect(transport)
    const evidence: Evidence[] = []
    for (const tool of selected) {
      const result = await client.callTool({ name: tool.name, arguments: { customerId } })
      if (result.isError) throw new Error(`MCP tool failed: ${tool.name}`)
      const block = result.content.find(item => item.type === 'text')
      if (!block || block.type !== 'text') throw new Error(`MCP tool returned no text: ${tool.name}`)
      evidence.push(...EvidenceSchema.parse(JSON.parse(block.text)))
    }
    return [...new Map(evidence.map(item => [item.source, item])).values()]
  } finally {
    await client.close()
  }
}
