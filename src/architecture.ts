import { z } from 'zod/v4'

export const architecture = [
  { id: 'ar', name: 'Adaptive router', stage: 'route', summary: 'Classifica a complexidade da pergunta e ajusta o orçamento de seleção de ferramentas.', paper: 'RouteLLM', url: 'https://arxiv.org/abs/2406.18665', relation: 'inspiration', settings: [{ key: 'deepThreshold', label: 'Limiar para rota profunda', min: 1, max: 4, value: 2 }] },
  { id: 'jc', name: 'Jev response checklist', stage: 'route', summary: 'Antes do LLM, pontua os campos que a resposta precisa conter. A meta orienta a coleta de fatos e a resposta.', paper: 'Jev model documentation', url: 'https://docs.typesafe.ai/models', relation: 'model documentation', settings: [{ key: 'threshold', label: 'Limiar dos campos (%)', min: 1, max: 99, value: 50 }] },
  { id: 'str', name: 'Semantic tool retrieval', stage: 'select', summary: 'Compara a pergunta às descrições das ferramentas e ativa as mais relevantes.', paper: 'ToolLLM / ToolRetriever', url: 'https://arxiv.org/abs/2307.16789', relation: 'inspiration', settings: [{ key: 'topK', label: 'Ferramentas iniciais', min: 1, max: 5, value: 2 }] },
  { id: 'js', name: 'Jev tool selection', stage: 'select', summary: 'Pontua todas as ferramentas em uma chamada e entrega ao executor um conjunto limitado. Em falha, usa seleção semântica.', paper: 'Jev API reference', url: 'https://docs.typesafe.ai/api', relation: 'model documentation', settings: [{ key: 'maxTools', label: 'Máximo de ferramentas', min: 3, max: 12, value: 12 }, { key: 'minCandidates', label: 'Acionar acima de N ferramentas', min: 1, max: 14, value: 12 }] },
  { id: 'at', name: 'AutoTool', stage: 'select', summary: 'Usa transições entre ferramentas para antecipar uma consulta relacionada, com limite de expansão.', paper: 'AutoTool', url: 'https://arxiv.org/abs/2511.14650', relation: 'adaptation', settings: [{ key: 'threshold', label: 'Confiança mínima (%)', min: 1, max: 100, value: 45 }] },
  { id: 'tr', name: 'TeaRAG', stage: 'retrieve', summary: 'Relaciona registros por entidade e vínculo operacional, depois reordena evidências por proximidade à pergunta.', paper: 'TeaRAG', url: 'https://arxiv.org/abs/2511.05385', relation: 'adaptation', settings: [{ key: 'maxRecords', label: 'Registros no contexto', min: 4, max: 40, value: 24 }] },
  { id: 'cp', name: 'Compact payload', stage: 'context', summary: 'Retira campos diagnósticos repetidos dos registros sem remover fatos operacionais ou IDs de origem.', paper: 'LLMLingua', url: 'https://arxiv.org/abs/2310.05736', relation: 'inspiration', settings: [] },
  { id: 'mb', name: 'Membox', stage: 'memory', summary: 'Agrupa turnos anteriores por assunto e oferece um resumo de tópicos ao modelo.', paper: 'Membox', url: 'https://arxiv.org/abs/2601.03785', relation: 'adaptation', settings: [{ key: 'maxTurns', label: 'Turnos anteriores', min: 1, max: 12, value: 6 }] },
  { id: 'm1', name: 'MEM1', stage: 'memory', summary: 'Mantém apenas objetivo, estado condensado e observação recente, em vez de reproduzir toda a conversa.', paper: 'MEM1', url: 'https://arxiv.org/abs/2506.15841', relation: 'inference adaptation', settings: [{ key: 'maxTurns', label: 'Turnos no estado', min: 1, max: 12, value: 4 }] },
  { id: 'acc', name: 'ACC', stage: 'memory', summary: 'Atualiza um estado cognitivo limitado que separa objetivo, entidades e restrições mencionadas.', paper: 'AI Agents Need Memory Control Over More Context', url: 'https://arxiv.org/abs/2601.11653', relation: 'adaptation', settings: [{ key: 'maxChars', label: 'Limite do estado (caracteres)', min: 120, max: 1200, value: 480 }] },
  { id: 'rts', name: 'Retrieve then solve', stage: 'context', summary: 'Primeiro seleciona IDs de evidências relevantes; depois responde com o contexto reduzido.', paper: 'Context Length Alone Hurts LLM Performance Despite Perfect Retrieval', url: 'https://arxiv.org/abs/2510.05381', relation: 'adaptation', settings: [{ key: 'maxRecords', label: 'Registros selecionados', min: 2, max: 30, value: 16 }] },
  { id: 'rv', name: 'Review loop', stage: 'review', summary: 'Pede uma crítica estruturada da resposta e permite uma revisão quando encontra uma lacuna.', paper: 'Self-Refine', url: 'https://arxiv.org/abs/2303.17651', relation: 'inspiration', settings: [] },
  { id: 'rr', name: 'Review repair', stage: 'review', summary: 'Verifica invariantes de fontes e política; tenta reparar a resposta e recua para regra quando cabível.', paper: 'Reflexion', url: 'https://arxiv.org/abs/2303.11366', relation: 'inspiration', settings: [] }
] as const

export type BlockId = typeof architecture[number]['id']
export type Stage = typeof architecture[number]['stage']
export type PipelineBlock = { id: BlockId; params: Record<string, number> }
export type Pipeline = { blocks: PipelineBlock[] }

const ids = architecture.map(item => item.id) as [BlockId, ...BlockId[]]
const blockSchema = z.object({ id: z.enum(ids), params: z.record(z.string(), z.number().finite()).default({}) })
export const pipelineSchema = z.object({ blocks: z.array(blockSchema).max(architecture.length) }).superRefine((value, context) => {
  const seen = new Set<BlockId>()
  let previous = -1
  const stages = ['route', 'select', 'retrieve', 'context', 'memory', 'review']
  for (const block of value.blocks) {
    const definition = architecture.find(item => item.id === block.id)!
    if (seen.has(block.id)) context.addIssue({ code: 'custom', message: `Bloco repetido: ${block.id}` })
    seen.add(block.id)
    const position = stages.indexOf(definition.stage)
    if (position < previous) context.addIssue({ code: 'custom', message: 'Os blocos precisam seguir a ordem das etapas.' })
    previous = position
    for (const [key, val] of Object.entries(block.params)) {
      const setting = definition.settings.find(item => item.key === key)
      if (!setting || !Number.isInteger(val) || val < setting.min || val > setting.max) context.addIssue({ code: 'custom', message: `Parâmetro inválido: ${block.id}.${key}` })
    }
  }
  const incompatible: BlockId[][] = [['mb', 'm1'], ['mb', 'acc'], ['m1', 'acc'], ['str', 'js']]
  if (incompatible.some(pair => pair.every(id => seen.has(id)))) context.addIssue({ code: 'custom', message: 'Escolha uma estratégia por função: memória ou seleção de ferramentas.' })
})

export const defaultPipeline: Pipeline = { blocks: ['ar', 'str', 'at', 'tr', 'cp', 'rts', 'rr'].map(id => ({ id: id as BlockId, params: {} })) }

export function parameter(block: PipelineBlock, key: string): number {
  const definition = architecture.find(item => item.id === block.id)!
  const setting = definition.settings.find(item => item.key === key)
  if (!setting) throw new Error(`Unknown parameter ${block.id}.${key}`)
  return block.params[key] ?? setting.value
}
