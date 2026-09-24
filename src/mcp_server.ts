import { McpServer } from '@modelcontextprotocol/server'
import { serveStdio } from '@modelcontextprotocol/server/stdio'
import { z } from 'zod/v4'
import { studioTools } from './studio_tools.js'

function createServer(): McpServer {
  const server = new McpServer({ name: 'openops-records', version: '0.1.0' })
  for (const tool of studioTools) {
    server.registerTool(tool.name, {
      description: tool.description,
      inputSchema: z.object({ customerId: z.string().optional() })
    }, async ({ customerId }) => ({ content: [{ type: 'text', text: JSON.stringify(tool.run(customerId)) }] }))
  }
  return server
}

void serveStdio(createServer)
