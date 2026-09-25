import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { z } from 'zod/v4'
import { analyze } from './analyst.js'
import { defaultPipeline, pipelineSchema } from './architecture.js'
import { analyzePipeline, publicArchitecture } from './pipeline.js'
import { jevConfigured } from './jev.js'
import { publicScenarios } from './scenarios.js'

const page = fileURLToPath(new URL('../public/index.html', import.meta.url))
const stylesheet = fileURLToPath(new URL('../public/studio.css', import.meta.url))
const questionSchema = z.string().trim().min(8).max(500)
const schema = z.object({
  question: questionSchema,
  mode: z.enum(['all', 'str', 'str_cp']).optional(),
  model: z.string().regex(/^[A-Za-z0-9._:/-]+$/).max(80).optional(),
  pipeline: pipelineSchema.optional(),
  history: z.array(z.object({ question: questionSchema, answer: z.string().max(1200), tools: z.array(z.string()).max(14).optional() })).max(12).default([])
})

createServer(async (request, response) => {
  const pathname = new URL(request.url || '/', 'http://127.0.0.1').pathname
  if (request.method === 'GET' && pathname === '/') {
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
    response.end(await readFile(page))
    return
  }
  if (request.method === 'GET' && pathname === '/studio.css') {
    response.writeHead(200, { 'Content-Type': 'text/css; charset=utf-8', 'Cache-Control': 'no-store' })
    response.end(await readFile(stylesheet))
    return
  }
  if (request.method === 'GET' && pathname === '/api/architecture') {
    response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
    response.end(JSON.stringify({ blocks: publicArchitecture, pipeline: defaultPipeline, jevConfigured: jevConfigured() }))
    return
  }
  if (request.method === 'GET' && pathname === '/api/scenarios') {
    response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
    response.end(JSON.stringify({ scenarios: publicScenarios }))
    return
  }
  if (request.method === 'GET' && pathname === '/api/models') {
    try {
      const result = await fetch('http://127.0.0.1:11434/api/tags', { signal: AbortSignal.timeout(2500) })
      if (!result.ok) throw new Error('Ollama unavailable')
      const body = await result.json() as { models?: Array<{ name: string; size: number }> }
      response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
      response.end(JSON.stringify({ models: (body.models || []).filter(item => item.size > 0 && !/cloud$|embed|bge/i.test(item.name)).map(item => item.name) }))
    } catch {
      response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
      response.end(JSON.stringify({ models: [] }))
    }
    return
  }
  if (request.method === 'POST' && pathname === '/api/analyze') {
    try {
      let raw = ''
      for await (const chunk of request) {
        raw += chunk
        if (raw.length > 16000) throw new Error('Request too large')
      }
      const input = schema.parse(JSON.parse(raw))
      const result = input.mode && !input.pipeline
        ? await analyze(input.question, input.mode, input.model)
        : await analyzePipeline(input.question, input.pipeline || defaultPipeline, input.history, input.model)
      response.writeHead(200, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify(result))
    } catch (error) {
      const status = error instanceof z.ZodError || error instanceof SyntaxError || (error instanceof Error && error.message === 'Request too large') ? 400 : 500
      response.writeHead(status, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify({ error: status === 400 ? error instanceof z.ZodError ? error.issues.map(issue => issue.message).join('; ') : 'Invalid request' : String(error) }))
    }
    return
  }
  response.writeHead(404).end()
}).listen(4173, '127.0.0.1', () => process.stdout.write('OpenOps Analyst: http://127.0.0.1:4173\n'))
