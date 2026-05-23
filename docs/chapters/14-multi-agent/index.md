# 第14章 Multi-Agent 协作架构

## 14.1 概述

单一 Agent 可以处理简单的问答和工具调用，但当面临复杂业务场景时，一个 Agent 难以同时具备所有能力：

| 单 Agent 局限 | 后果 |
|---------------|------|
| 一个 Prompt 承担所有角色 | Prompt 庞大且相互冲突 |
| 所有任务共享一个模型 | 简单任务浪费成本，复杂任务能力不足 |
| 工具列表过长 | 模型选择工具的准确率下降 |
| 单一职责缺失 | 难以独立测试和迭代 |

**Multi-Agent（多 Agent）架构** 通过多个专业化 Agent 协同工作来解决这些问题。核心思想是"分而治之"——每个 Agent 只做一件事，但把这件事做到极致。

```
用户输入 → Supervisor (路由分发)
  ├── Agent A: 客服处理 (gpt-4o-mini, 低成本)
  ├── Agent B: 技术解答 (gpt-4o, 高质量)
  └── Agent C: 数据分析 (gpt-4o + 工具)
```

**本章目标：** 理解 Multi-Agent 架构模式，掌握 Supervisor 路由、专业 Agent 设计、Agent 间通信，能够构建生产级多 Agent 系统。

---

## 14.2 Supervisor 架构模式

Supervisor（也称作 Orchestrator / Router）是 Multi-Agent 系统的核心协调者。它不直接回答问题，而是：

1. **分析用户意图** — 理解用户想要什么
2. **选择合适 Agent** — 判断哪个 Agent 最擅长处理
3. **传递上下文** — 将必要的上下文传递给目标 Agent
4. **聚合结果** — 整合各 Agent 的返回结果

### 路由策略

| 策略 | 说明 | 适用场景 |
|------|------|---------|
| **基于分类** | 判断问题类型，路由到固定 Agent | 客服分流、工单分类 |
| **基于关键字** | 关键词匹配决定路由 | 简单规则场景 |
| **AI 路由** | Supervisor 用 LLM 做路由决策 | 复杂语义理解 |
| **混合路由** | 规则 + AI 结合 | 生产环境最佳实践 |

### 实现方式

在 Vercel AI SDK 中，Supervisor 通过 Tool Calling 实现路由——Supervisor 模型调用一个 `route_to_agent` 工具，该工具的执行函数内部调用目标 Agent。

---

## 14.3 专业化 Agent 设计

每个 Agent 应该有明确的职责边界和独立的配置：

### Agent 配置维度

```typescript
interface AgentConfig {
  name: string              // Agent 名称
  model: LanguageModelV1    // 使用的模型（不同 Agent 可用不同模型）
  systemPrompt: string      // 仅包含该 Agent 职责的 Prompt
  tools: Record<string, Tool> // 仅包含该 Agent 需要的工具
  maxSteps?: number         // 独立的最大推理步数
}
```

### 模型策略

| Agent 类型 | 推荐模型 | 原因 |
|-----------|---------|------|
| 客服、FAQ | `gpt-4o-mini` | 成本低、响应快 |
| 技术解答 | `gpt-4o` | 需要推理和代码能力 |
| 数据分析 | `gpt-4o` + 工具 | 需要调用外部工具 |
| Supervisor | `gpt-4o` | 路由决策需要强模型 |

---

## 14.4 Agent 间通信与数据传递

Multi-Agent 系统中，Agent 之间的数据传递需要清晰的协议：

### 通信模式

| 模式 | 说明 | 适用场景 |
|------|------|---------|
| **串行传递** | Agent A 输出 → Agent B 输入 | 分析 → 报告 |
| **并行分发** | Supervisor 同时调用多个 Agent | 多维度分析 |
| **聚合汇总** | 收集所有 Agent 结果后合并 | 综合报告 |
| **层级协作** | Agent 可以调用子 Agent | 复杂工作流 |

### 数据结构

Agent 间传递的数据应结构化：

```typescript
interface AgentMessage {
  from: string           // 来源 Agent
  to: string             // 目标 Agent
  type: 'request' | 'response'
  payload: unknown       // 业务数据
  metadata: {
    timestamp: number
    traceId: string      // 用于追踪完整调用链
  }
}
```

---

## 14.5 代码示例

### 示例 1：简单路由 Agent（分类 → 分发）

Supervisor 判断问题类型，路由到对应 Agent。

**`app/api/simple-router/route.ts`**

```typescript
import { generateText, streamText, tool } from 'ai'
import { openai } from '@ai-sdk/openai'
import { z } from 'zod'

async function generalAgent(query: string) {
  const { text } = await generateText({
    model: openai('gpt-4o-mini'),
    system: '你是一个通用助手，回答日常问题。保持简洁。',
    prompt: query,
  })
  return text
}

async function codingAgent(query: string) {
  const { text } = await generateText({
    model: openai('gpt-4o'),
    system: '你是一个编程专家。提供代码示例和详细解释。',
    prompt: query,
  })
  return text
}

async function mathAgent(query: string) {
  const { text } = await generateText({
    model: openai('gpt-4o'),
    system: '你是一个数学专家。一步步解释数学问题。',
    prompt: query,
  })
  return text
}

const routerTool = tool({
  description: '将用户问题路由到最合适的专业 Agent',
  parameters: z.object({
    agent: z.enum(['general', 'coding', 'math']),
    query: z.string(),
    reason: z.string(),
  }),
  execute: async ({ agent, query }) => {
    const agents = { general: generalAgent, coding: codingAgent, math: mathAgent }
    const response = await agents[agent](query)
    return { agent, response }
  },
})

export async function POST(req: Request) {
  const { messages } = await req.json()

  const result = streamText({
    model: openai('gpt-4o'),
    system: '你是一个智能路由协调员。分析用户输入，选择合适的 Agent 来回答问题。用 tool 路由。',
    messages,
    tools: { route: routerTool },
    maxSteps: 3,
  })

  return result.toDataStreamResponse()
}
```

**`app/simple-router/page.tsx`**

```tsx
'use client'

import { useChat } from 'ai/react'

export default function SimpleRouterPage() {
  const { messages, input, handleInputChange, handleSubmit, isLoading } = useChat({
    api: '/api/simple-router',
  })

  return (
    <div className="max-w-3xl mx-auto p-4">
      <h1 className="text-2xl font-bold mb-2">智能路由 Agent</h1>
      <p className="text-sm text-gray-500 mb-4">
        根据问题自动路由到通用 / 编程 / 数学 Agent。试试："什么是 JavaScript 闭包？"、"计算 256 的平方根"。
      </p>
      <div className="border rounded-lg p-4 mb-4 h-96 overflow-y-auto">
        {messages.map((m) => (
          <div key={m.id} className={`mb-3 ${m.role === 'user' ? 'text-right' : 'text-left'}`}>
            <div className={`inline-block px-4 py-2 rounded-lg max-w-[80%] ${
              m.role === 'user' ? 'bg-blue-500 text-white' : 'bg-gray-100'
            }`}>
              {m.content}
            </div>
          </div>
        ))}
      </div>
      <form onSubmit={handleSubmit}>
        <input
          type="text"
          value={input}
          onChange={handleInputChange}
          placeholder="输入问题..."
          className="w-full border rounded px-3 py-2"
          disabled={isLoading}
        />
      </form>
    </div>
  )
}
```

---

### 示例 2：客服/技术/数据 多 Agent 系统

更贴近真实业务场景的多 Agent 协作。

**`app/api/customer-hub/route.ts`**

```typescript
import { generateText, streamText, tool } from 'ai'
import { openai } from '@ai-sdk/openai'
import { anthropic } from '@ai-sdk/anthropic'
import { z } from 'zod'

async function supportAgent(query: string) {
  const { text } = await generateText({
    model: openai('gpt-4o-mini'),
    system: `你是一个电商客服助手。可以回答关于：订单查询、退换货流程、物流跟踪、优惠券使用的问题。
保持友善和耐心。如果不确定，引导用户联系人工客服。`,
    prompt: query,
  })
  return text
}

async function techAgent(query: string) {
  const { text } = await generateText({
    model: openai('gpt-4o'),
    system: `你是一个技术专家。可以回答关于：API 集成、SDK 使用、Webhook 配置、错误码排查的技术问题。
提供代码示例和排查步骤。`,
    prompt: query,
  })
  return text
}

async function dataAgent(query: string) {
  const { text } = await generateText({
    model: anthropic('claude-3-5-sonnet-20241022'),
    system: `你是一个数据分析师。根据提供的数据做分析和建议。
回答格式：先给出结论，再展示数据支持。`,
    prompt: query,
  })
  return text
}

const hubTools = {
  route: tool({
    description: '将用户问题路由到客服、技术或数据分析 Agent',
    parameters: z.object({
      agent: z.enum(['support', 'tech', 'data']),
      query: z.string(),
    }),
    execute: async ({ agent, query }) => {
      const agents = { support: supportAgent, tech: techAgent, data: dataAgent }
      const response = await agents[agent](query)
      return { agent, response }
    },
  }),
}

export async function POST(req: Request) {
  const { messages } = await req.json()

  const result = streamText({
    model: openai('gpt-4o'),
    system: `你是客户服务中心的智能路由。分析用户问题，选择：
- support: 订单、退款、物流等客服问题
- tech: API、集成、技术故障
- data: 数据分析、报表、趋势`,
    messages,
    tools: hubTools,
    maxSteps: 3,
  })

  return result.toDataStreamResponse()
}
```

**`app/customer-hub/page.tsx`**

```tsx
'use client'

import { useChat } from 'ai/react'

export default function CustomerHubPage() {
  const { messages, input, handleInputChange, handleSubmit, isLoading } = useChat({
    api: '/api/customer-hub',
  })

  return (
    <div className="max-w-3xl mx-auto p-4">
      <h1 className="text-2xl font-bold mb-2">客户服务中心</h1>
      <p className="text-sm text-gray-500 mb-4">
        智能分流：客服 → gpt-4o-mini，技术 → gpt-4o，数据 → Claude。自动路由最合适的 Agent 和模型。
      </p>
      <div className="border rounded-lg p-4 mb-4 h-96 overflow-y-auto">
        {messages.map((m) => (
          <div key={m.id} className={`mb-3 ${m.role === 'user' ? 'text-right' : 'text-left'}`}>
            <div className={`inline-block px-4 py-2 rounded-lg max-w-[80%] ${
              m.role === 'user' ? 'bg-blue-500 text-white' : 'bg-gray-100'
            }`}>
              {m.content}
            </div>
          </div>
        ))}
      </div>
      <form onSubmit={handleSubmit}>
        <input
          type="text"
          value={input}
          onChange={handleInputChange}
          placeholder="输入客服/技术/数据问题..."
          className="w-full border rounded px-3 py-2"
          disabled={isLoading}
        />
      </form>
    </div>
  )
}
```

---

### 示例 3：带工具的专业 Agent

Agent 不仅回答问题，还能调用外部工具（如搜索、数据库）。

**`app/api/tool-agent/route.ts`**

```typescript
import { generateText, streamText, tool } from 'ai'
import { openai } from '@ai-sdk/openai'
import { z } from 'zod'

const searchTool = tool({
  description: '搜索网络获取最新信息',
  parameters: z.object({
    query: z.string().describe('搜索关键词'),
  }),
  execute: async ({ query }) => {
    // 生产环境接入真实搜索 API
    return { result: `[模拟搜索结果] 关于 "${query}" 的搜索结果...`, source: 'web' }
  },
})

const weatherTool = tool({
  description: '查询城市天气',
  parameters: z.object({
    city: z.string().describe('城市名称'),
  }),
  execute: async ({ city }) => {
    return { city, temperature: '22°C', condition: '晴', humidity: '60%' }
  },
})

const agentSpecs = {
  search: {
    system: '你是一个搜索专家。使用搜索工具查找最新信息，总结并回复。',
    tools: { search: searchTool },
  },
  weather: {
    system: '你是一个天气预报员。使用天气工具查询并报告天气。',
    tools: { weather: weatherTool },
  },
  research: {
    system: '你是研究助手。结合搜索和天气工具回答复杂问题。',
    tools: { search: searchTool, weather: weatherTool },
  },
}

const router = tool({
  description: '路由到指定的专业 Agent',
  parameters: z.object({
    agent: z.enum(['search', 'weather', 'research']),
    query: z.string(),
  }),
  execute: async ({ agent, query }) => {
    const spec = agentSpecs[agent]
    const { text } = await generateText({
      model: openai('gpt-4o'),
      system: spec.system,
      prompt: query,
      tools: spec.tools,
      maxSteps: 3,
    })
    return { agent, response: text }
  },
})

export async function POST(req: Request) {
  const { messages } = await req.json()

  const result = streamText({
    model: openai('gpt-4o'),
    system: '路由到搜索、天气或综合研究 Agent。',
    messages,
    tools: { route: router },
    maxSteps: 3,
  })

  return result.toDataStreamResponse()
}
```

**`app/tool-agent/page.tsx`**

```tsx
'use client'

import { useChat } from 'ai/react'

export default function ToolAgentPage() {
  const { messages, input, handleInputChange, handleSubmit, isLoading } = useChat({
    api: '/api/tool-agent',
  })

  return (
    <div className="max-w-3xl mx-auto p-4">
      <h1 className="text-2xl font-bold mb-2">带工具的专业 Agent</h1>
      <p className="text-sm text-gray-500 mb-4">
        每个 Agent 拥有独立工具集。搜索 Agent 可查网络，天气 Agent 可查天气。
      </p>
      <div className="border rounded-lg p-4 mb-4 h-96 overflow-y-auto">
        {messages.map((m) => (
          <div key={m.id} className={`mb-3 ${m.role === 'user' ? 'text-right' : 'text-left'}`}>
            <div className={`inline-block px-4 py-2 rounded-lg max-w-[80%] ${
              m.role === 'user' ? 'bg-blue-500 text-white' : 'bg-gray-100'
            }`}>
              {m.content}
            </div>
          </div>
        ))}
      </div>
      <form onSubmit={handleSubmit}>
        <input
          type="text"
          value={input}
          onChange={handleInputChange}
          placeholder="如：北京的天气？或者搜索最新 AI 新闻..."
          className="w-full border rounded px-3 py-2"
          disabled={isLoading}
        />
      </form>
    </div>
  )
}
```

---

### 示例 4：Agent 编排：串行协作（分析 → 报告）

Agent A 先分析数据，结果传递给 Agent B 生成报告。

**`app/api/serial-pipeline/route.ts`**

```typescript
import { streamText, tool } from 'ai'
import { openai } from '@ai-sdk/openai'
import { z } from 'zod'

interface PipelineContext {
  analysisResult?: string
  reportResult?: string
}

const pipelineTool = tool({
  description: '执行分析或报告任务',
  parameters: z.object({
    stage: z.enum(['analyze', 'report']).describe('pipeline 阶段'),
    data: z.string().describe('分析数据或分析结果'),
  }),
  execute: async ({ stage, data }) => {
    if (stage === 'analyze') {
      const { text } = await streamText({
        model: openai('gpt-4o'),
        system: '你是一个数据分析师。深入分析数据，找出关键洞察。输出结构化分析结果。',
        prompt: `请分析以下数据：\n\n${data}`,
      })
      // 简化：实际应收集完整流
      return { stage, result: text }
    } else {
      const { text } = await streamText({
        model: openai('gpt-4o'),
        system: '你是一个报告撰写专家。基于分析结果，撰写一份完整的报告。',
        prompt: `基于以下分析结果撰写报告：\n\n${data}`,
      })
      return { stage, result: text }
    }
  },
})

export async function POST(req: Request) {
  const { messages } = await req.json()

  const result = streamText({
    model: openai('gpt-4o'),
    system: `你是一个串行编排员。工作流程：
1. 先用 analyze 阶段分析数据
2. 将分析结果传给 report 阶段生成报告
不要跳过步骤。`,
    messages,
    tools: { pipeline: pipelineTool },
    maxSteps: 5,
  })

  return result.toDataStreamResponse()
}
```

**`app/serial-pipeline/page.tsx`**

```tsx
'use client'

import { useChat } from 'ai/react'

export default function SerialPipelinePage() {
  const { messages, input, handleInputChange, handleSubmit, isLoading } = useChat({
    api: '/api/serial-pipeline',
  })

  return (
    <div className="max-w-3xl mx-auto p-4">
      <h1 className="text-2xl font-bold mb-2">串行 Agent 编排</h1>
      <p className="text-sm text-gray-500 mb-4">
        Agent A（分析）→ Agent B（报告）。输入数据，观察两步串行协作流程。
      </p>
      <div className="border rounded-lg p-4 mb-4 h-96 overflow-y-auto">
        {messages.map((m) => (
          <div key={m.id} className={`mb-3 ${m.role === 'user' ? 'text-right' : 'text-left'}`}>
            <div className={`inline-block px-4 py-2 rounded-lg max-w-[80%] ${
              m.role === 'user' ? 'bg-blue-500 text-white' : 'bg-gray-100'
            }`}>
              {m.content}
            </div>
          </div>
        ))}
      </div>
      <form onSubmit={handleSubmit}>
        <input
          type="text"
          value={input}
          onChange={handleInputChange}
          placeholder="输入要分析的数据..."
          className="w-full border rounded px-3 py-2"
          disabled={isLoading}
        />
      </form>
    </div>
  )
}
```

---

## 14.6 运行验证

### 安装依赖

```bash
npm install ai @ai-sdk/openai @ai-sdk/anthropic zod
```

### 验证步骤

1. **简单路由**：访问 `/simple-router`，输入编程问题、数学问题，观察路由到不同 Agent
2. **客服中心**：访问 `/customer-hub`，测试客服、技术、数据三类问题
3. **工具 Agent**：访问 `/tool-agent`，输入"北京天气怎么样"和"搜索最新的 AI 框架"
4. **串行编排**：访问 `/serial-pipeline`，输入一组销售数据或指标，观察两步协作

### 验证预期

| 测试场景 | 预期结果 |
|----------|---------|
| "JavaScript 闭包是什么？" | 路由到 coding Agent，gpt-4o 给出代码示例 |
| "我的订单在哪里？" | 路由到 support Agent，回复订单查询相关 |
| "北京的天气" | 路由到 weather Agent，调用天气工具 |
| 输入一组数据 | 先分析后生成报告 |

---

## 14.7 常见问题

### Q1: 多个 Agent 同时调用会不会超预算？

Multi-Agent 实际上可以省钱：简单问题用 `gpt-4o-mini`（比单一 `gpt-4o` 便宜 30 倍），只有复杂问题才用强模型。总成本取决于路由准确率。

### Q2: Supervisor 怎么保证路由准确？

提高准确率的方法：
- 给 Supervisor 更清晰的路由规则描述
- 添加 `reason` 字段让模型解释路由理由
- 在结果中加入 Agent 名称，帮助调试
- 对高频误分类做 prompt 调优

### Q3: Agent 间如何共享上下文？

通过 Supervisor 传递上下文数据。每个 Agent 收到的 prompt 中包含必要的上下文（用户问题 + 前置 Agent 结果）。复杂的上下文传递建议使用结构化消息格式。

### Q4: 串行模式中 Agent B 依赖 Agent A 的完整输出，如何处理流式？

在串行模式中，Agent A 应使用 `generateText`（非流式）产生完整输出后，再将结果传给 Agent B。如果必须流式，需要缓存 Agent A 的完整输出再传递。

### Q5: Multi-Agent 的调试难点是什么？

- **调用链追踪**：需要记录每个 Agent 的输入输出
- **路由决策**：需要知道为什么选了某个 Agent
- **性能瓶颈**：需要监控每个 Agent 的延迟和 Token 消耗
- 建议在开发阶段为每个 Agent 添加日志输出

---

## 14.8 本章小结

Multi-Agent 架构通过"分而治之"解决了单一 Agent 的能力瓶颈：

| 维度 | 单 Agent | Multi-Agent |
|------|---------|-------------|
| Prompt 复杂度 | 低（一个 Prompt 做所有事） | 高（各 Agent 独立优化） |
| 模型利用率 | 一刀切 | 按需匹配 |
| 可维护性 | 改一处影响全局 | 独立更新 |
| 性能 | 工具选择可能出错 | 工具集合更专注 |
| 成本 | 固定成本 | 可优化（简单 → 便宜模型） |

**关键要点：**
- Supervisor 通过 Tool Calling 实现路由分发
- 不同 Agent 可以使用不同模型和工具
- 串行和并行编排覆盖大部分业务场景
- Agent 通信需要结构化协议
- 日志和追踪是多 Agent 系统必不可少的观测手段
