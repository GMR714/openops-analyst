# OpenOps Analyst

A local operations analyst for a fictional distributor. It answers questions across orders, support tickets, inventory, customer profiles, and policy, with source IDs that can be inspected beside the answer. The data and prompts in this repository were created for the demo; no employer code or data is included.

![Architecture Studio showing the Jev hover explanation and model documentation link](results/architecture-studio-hover.png)

## Run locally

Requires Node.js 24 and [Ollama](https://ollama.com/) running on `127.0.0.1:11434`. The default chat model is `qwen3:4b`; the studio also lists other locally installed chat models. Set `TYPESAFE_API_KEY` in the server environment to enable Jev; without it, the checklist is skipped and the tool selector uses semantic fallback.

```bash
npm ci
ollama pull embeddinggemma
ollama pull qwen3:4b
npm run web
```

Open `http://127.0.0.1:4173`. Drag a block from the library into its stage, or click it to add it. Hover over a block to open a preview with its purpose, adjustable parameters, and a direct link to the related paper or model documentation. The detail panel keeps the selected block visible while you configure it. Ask the same question with a different pipeline to compare its answer, citations, tools, token count, and step trace. `?demo=1` runs the default question on load. The pipeline configuration is saved in browser local storage; conversation history stays in the current tab and can be cleared. The scenario shelf offers 12 cases across lookup, inventory, lists, joins, policy, memory, missing coverage and adversarial instructions. After a run, use **Fixar última execução** to pin it, change the blocks or parameters, then choose **Comparar com referência**. The comparison reuses the pinned question, model and input history, and shows both answers, citations, tool counts, tokens and latency. It does not add a turn to the conversation.

The command-line workflow and its original three-mode diagnostic are still available:

```bash
npm run ask -- str_cp "For Northstar Supply, which orders are delayed and are there open support tickets for them?"
npm run eval
npm test
npm run typecheck
```

## Architecture Studio

The studio accepts an ordered, validated pipeline. Stages run as route and goal setting → tool selection → retrieval → context shaping → memory → review. Blocks can be removed, reordered within a stage, or configured independently. Memory strategies are mutually exclusive, as are the semantic and Jev tool selectors. Every execution returns the selected tools, evidence, model tokens, elapsed time, answer path, and a trace of each active block.

| Block | What this demo executes | Research link |
| --- | --- | --- |
| Adaptive router (`AR`) | A transparent complexity heuristic changes the tool retrieval budget. It does not train a model router. | [RouteLLM](https://arxiv.org/abs/2406.18665), related inspiration |
| Semantic tool retrieval (`STR`) | EmbeddingGemma ranks tool descriptions; keyword coverage protects explicit tool needs. | [ToolLLM / ToolRetriever](https://arxiv.org/abs/2307.16789), related inspiration |
| Jev response checklist (`JC`) | The first batched Jev call scores answer fields before any tool call. Selected fields become the answer goal; a code gate fetches missing canonical sources and builds a fact sheet directly from tool JSON. | [Jev model documentation](https://docs.typesafe.ai/models), model integration |
| Jev tool selection (`JS`) | The second batched call scores 14 general and focused MCP tools from purpose and input descriptions. Above the configured catalog size, scores ≥ 0.5 select at most 12 tools with a floor of 3; on failure, semantic selection takes over. | [TypeSafe API](https://docs.typesafe.ai/api), model integration |
| AutoTool (`AT`) | Seeded tool-transition edges can add one relevant tool; prior tool sequences in the tab contribute observed edges. | [AutoTool](https://arxiv.org/abs/2511.14650), adaptation |
| TeaRAG (`TR`) | A record graph connects shared customers, orders, and products; personalized propagation ranks the records. This is a small structured-data adaptation, without TeaRAG's full corpus pipeline. | [TeaRAG](https://arxiv.org/abs/2511.05385), adaptation |
| Compact payload (`CP`) | Removes diagnostic fields while preserving operational facts and source IDs. It does not run the LLMLingua compressor. | [LLMLingua](https://arxiv.org/abs/2310.05736), related inspiration |
| Membox (`MB`) | Groups prior turns by customer and operational topic, passing short summaries instead of the full transcript. | [Membox](https://arxiv.org/abs/2601.03785), adaptation |
| MEM1 (`M1`) | Passes the original goal, accumulated question state, and latest observation. This is inference-time context control, not MEM1 training. | [MEM1](https://arxiv.org/abs/2506.15841), inference adaptation |
| ACC (`ACC`) | Builds a bounded state with the recent goal, named entities, mentioned constraints, and latest observation. | [AI Agents Need Memory Control Over More Context](https://arxiv.org/abs/2601.11653), adaptation |
| Retrieve then solve (`RTS`) | Selects source IDs first, then asks the model to solve using the corresponding records. Required records for supported joins and policy checks are retained. | [Context Length Alone Hurts LLM Performance Despite Perfect Retrieval](https://arxiv.org/abs/2510.05381), adaptation |
| Review loop (`RV`) | A separate model pass reviews the draft against the records and requests one revision for concrete issues. | [Self-Refine](https://arxiv.org/abs/2303.17651), related inspiration |
| Review repair (`RR`) | Deterministic checks catch missing citations, incomplete lists, and unsupported policy decisions. It attempts repair, a grounded rule answer, or abstention. | [Reflexion](https://arxiv.org/abs/2303.11366), related inspiration |

The paper labels deliberately distinguish an adapted mechanism from a related idea. Jev links point to the model and API documentation, not to a paper. This is a portfolio-scale implementation for testing architecture choices on synthetic operational data, not a reproduction of the original papers or of a private production system.

## Under the hood

The legacy CLI uses LangGraph. The studio's configurable runner is a typed pipeline that calls read-only tools through a local MCP server, sends structured requests to Ollama, and filters cited IDs against the records actually supplied to the model. Jev runs before Ollama when its blocks are enabled: checklist after entity resolution, tool selection next, then MCP retrieval. This demo has one customer per turn and a single retrieval pass; its fact sheet is built from that turn’s tool JSON rather than a persistent session ledger. The optional review stages add model critique and record-level invariants. An answer can abstain when the data is missing or its citations cannot be verified.

The API exposes `GET /api/architecture`, `GET /api/scenarios`, `GET /api/models`, and `POST /api/analyze`. A request with `pipeline.blocks` invokes the studio runner; a request with a legacy `mode` (`all`, `str`, `str_cp`) invokes the original LangGraph workflow. No API key is required for the local Ollama setup; Jev needs a server-side TypeSafe key. The browser never receives that key. The HTTP server binds to `127.0.0.1`.

## Scenario evaluation

![Scenario shelf with difficulty and category filters](results/scenario-shelf.png)

`npm run eval:studio` runs 12 synthetic cases through four fixed profiles: broad retrieval (`wide`), semantic retrieval (`local`), Jev checklist plus tool selection (`jev`), and those Jev blocks with memory (`jev_memory`). The cases range from direct lookups to cross-record joins, date-sensitive policy checks, a follow-up turn, missing data, ambiguous customers, and an injected order ID. The [recorded case results](results/studio-eval.json) include each answer, selected tools, citations, token counts, latency, and pass/fail checks.

| Profile | Checks passed | Mean tools | Mean Ollama tokens | Mean Jev input tokens | Mean wall time |
| --- | ---: | ---: | ---: | ---: | ---: |
| `wide` | 8/12 | 12 | 1,133 | 0 | 2.61 s |
| `local` | 10/12 | 3 | 590 | 0 | 3.74 s |
| `jev` | 11/12 | 4 | 697 | 1,385 | 4.98 s |
| `jev_memory` | 12/12 | 4 | 736 | 1,524 | 5.11 s |

The checks require expected outcomes and specified citations, and reject known unsupported claims; they are not a complete factual-accuracy measure. This is one small local run using fictional fixtures and `qwen3:4b`. The Jev checklist covered the compound customer profile that semantic selection missed; adding memory passed the follow-up case. The date-sensitive policy cases passed with the guarded profiles. Jev added remote tokens and latency. The table separates Ollama and Jev token counts; it does not imply lower total cost. Run the evaluation yourself with Ollama and `TYPESAFE_API_KEY` configured. The key is read only from the server process environment and is never written to the results file.

```bash
npm run eval:studio
```

## Existing local diagnostic

`npm run eval` runs six hand-authored questions in each legacy mode with the same local `qwen3:4b` model. The previously recorded run completed 18/18 requests; full per-case output is in [`results/ablation.json`](results/ablation.json).

| Mode | Mean model tokens | Mean wall time | Required evidence recall | Required citation recall | Policy rule fallbacks |
| --- | ---: | ---: | ---: | ---: | ---: |
| `all` | 1,586 | 2.71 s | 100% | 100% | 2/6 |
| `str` | 818 | 2.29 s | 100% | 100% | 2/6 |
| `str_cp` | 508 | 2.04 s | 100% | 100% | 2/6 |

These figures describe the legacy diagnostic, not the new studio's 13-block configurations. The sample is too small to claim general accuracy or latency gains. Recorded fallback decisions are included in timing and token totals. A valid source ID establishes record provenance, while the explicit checks cover only their coded invariants. All fixtures are fictional.

Core dependencies: [LangGraph](https://docs.langchain.com/oss/javascript/langgraph/quickstart), [Ollama chat](https://docs.ollama.com/api/chat) and [embeddings](https://docs.ollama.com/api/embed), and the [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/get-started/first-server.md).
