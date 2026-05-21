# 第3章：Vercel AI SDK 进阶用法

## 概述

第2章介绍了 AI SDK 的基础 API。本章深入进阶特性：工具调用（Tool Calling）、结构化输出、Agent 循环、多模型编排、以及 Embedding。

**本章目标：** 掌握 AI SDK 的高级模式，能够构建可交互、可扩展的 AI 应用。

## 核心概念

### Tool Calling（工具调用）

让模型能够调用外部函数（API、数据库、计算等）。模型返回工具调用请求，开发者执行后把结果传回模型继续生成。

```typescript
import { tool } from 'ai'
import { z } from 'zod'

const weatherTool = tool({
  description: '获取指定城市的天气信息',
  parameters: z.object({
    city: z.string().describe('城市名称'),
  }),
  execute: async ({ city }) => {
    const res = await fetch(`https://api.weather.com/${city}`)
    return res.json()
  },
})
```

### Structured Output（结构化输出）

强制模型输出符合 JSON Schema 的结构化数据，而不是自然语言。适合数据提取、分类、表单填充。

```typescript
import { generateObject } from 'ai'
import { z } from 'zod'

const { object } = await generateObject({
  model: openai('gpt-4o'),
  schema: z.object({
    sentiment: z.enum(['positive', 'negative', 'neutral']),
    score: z.number().min(0).max(10),
    keywords: z.array(z.string()),
  }),
  prompt: '分析这句话的情感："今天天气真好！"',
})
```

### Agent 模式

让模型在循环中自主决策：思考 → 选择工具 → 执行 → 观察结果 → 继续思考。AI SDK 不内置 Agent 框架，但提供原语让你构建自己的 Agent。

### Embedding

将文本转为向量，用于语义搜索、聚类、RAG（检索增强生成）。

```typescript
import { embed, embedMany } from 'ai'
import { openai } from '@ai-sdk/openai'

const { embedding } = await embed({
  model: openai.embedding('text-embedding-3-small'),
  value: '需要向量化的文本',
})
```

## 代码示例

### 示例1：工具调用 — 天气查询

`app/api/chat-with-tools/route.ts`：

```typescript
import { streamText, tool } from 'ai'
import { openai } from '@ai-sdk/openai'
import { z } from 'zod'

const weatherTool = tool({
  description: '根据城市名称查询当前天气',
  parameters: z.object({
    city: z.string().describe('城市名称，如 北京、上海、Tokyo'),
  }),
  execute: async ({ city }) => {
    // 模拟天气 API 调用
    const weatherData: Record<string, any> = {
      '北京': { temperature: 22, condition: '晴', humidity: 45 },
      '上海': { temperature: 28, condition: '多云', humidity: 70 },
      'Tokyo': { temperature: 18, condition: '小雨', humidity: 85 },
    }
    return weatherData[city] || { temperature: '未知', condition: '未知' }
  },
})

export async function POST(req: Request) {
  const { messages } = await req.json()

  const result = streamText({
    model: openai('gpt-4o'),
    messages,
    tools: { get_weather: weatherTool },
    maxSteps: 5,
  })

  return result.toDataStreamResponse()
}
```

### 示例2：结构化输出 — 情感分析

`app/api/analyze-sentiment/route.ts`：

```typescript
import { generateObject } from 'ai'
import { openai } from '@ai-sdk/openai'
import { z } from 'zod'

const sentimentSchema = z.object({
  sentiment: z.enum(['positive', 'negative', 'neutral']),
  score: z.number().min(0).max(10),
  explanation: z.string(),
  keywords: z.array(z.string()).max(5),
})

export async function POST(req: Request) {
  const { text } = await req.json()

  const { object } = await generateObject({
    model: openai('gpt-4o'),
    schema: sentimentSchema,
    prompt: `请分析以下文本的情感：\n\n${text}`,
  })

  return Response.json(object)
}
```

### 示例3：Agent 循环 — 自主搜索与回答

`app/api/agent/route.ts`：

```typescript
import { streamText, tool } from 'ai'
import { openai } from '@ai-sdk/openai'
import { z } from 'zod'

const searchTool = tool({
  description: '搜索网络信息（模拟）',
  parameters: z.object({
    query: z.string().describe('搜索关键词'),
  }),
  execute: async ({ query }) => {
    const db: Record<string, string> = {
      'Vercel AI SDK': 'Vercel AI SDK 是一个开源 TypeScript 库，提供统一的 AI 接口。',
      'Next.js': 'Next.js 是一个 React 全栈框架。',
    }
    return { result: db[query] || `未找到 "${query}" 的相关信息` }
  },
})

const calculatorTool = tool({
  description: '执行数学计算',
  parameters: z.object({
    expression: z.string().describe('数学表达式，如 "2 + 2"'),
  }),
  execute: async ({ expression }) => {
    // ⚠️ 仅用于演示！生产环境请使用 mathjs 等安全解析库
    try {
      const result = Function(`"use strict"; return (${expression})`)()
      return { result: String(result) }
    } catch {
      return { error: '表达式无效' }
    }
  },
})

export async function POST(req: Request) {
  const { messages } = await req.json()

  const result = streamText({
    model: openai('gpt-4o'),
    messages,
    tools: { search: searchTool, calculate: calculatorTool },
    maxSteps: 10,
  })

  return result.toDataStreamResponse()
}
```

### 示例4：Embedding + 语义搜索

`app/api/embed/route.ts`：

```typescript
import { embed, embedMany } from 'ai'
import { openai } from '@ai-sdk/openai'

const documents = [
  'Vercel AI SDK 支持 OpenAI GPT 系列模型',
  'Vercel AI SDK 支持 Anthropic Claude 系列模型',
  'Next.js 是一个基于 React 的全栈框架',
  'TypeScript 是 JavaScript 的超集，提供类型系统',
]

export async function POST(req: Request) {
  const { query } = await req.json()

  const { embedding: queryEmbedding } = await embed({
    model: openai.embedding('text-embedding-3-small'),
    value: query,
  })

  const { embeddings: docEmbeddings } = await embedMany({
    model: openai.embedding('text-embedding-3-small'),
    values: documents,
  })

  const similarities = docEmbeddings.map((docEmb, i) => ({
    document: documents[i],
    similarity: cosineSimilarity(queryEmbedding, docEmb),
  }))

  similarities.sort((a, b) => b.similarity - a.similarity)

  return Response.json({ results: similarities.slice(0, 3) })
}

function cosineSimilarity(a: number[], b: number[]): number {
  const dot = a.reduce((sum, val, i) => sum + val * b[i], 0)
  const magA = Math.sqrt(a.reduce((sum, val) => sum + val * val, 0))
  const magB = Math.sqrt(b.reduce((sum, val) => sum + val * val, 0))
  return dot / (magA * magB)
}
```

### 示例5：同时调用多个提供商的模型

`app/api/multi-model/route.ts`：

```typescript
import { generateText } from 'ai'
import { openai } from '@ai-sdk/openai'
import { anthropic } from '@ai-sdk/anthropic'

export async function POST(req: Request) {
  const { prompt } = await req.json()

  const [openaiResult, anthropicResult] = await Promise.all([
    generateText({ model: openai('gpt-4o'), prompt }),
    generateText({ model: anthropic('claude-3-5-sonnet-20241022'), prompt }),
  ])

  return Response.json({
    openai: openaiResult.text,
    anthropic: anthropicResult.text,
  })
}
```

### 示例6：使用 Anthropic 的工具调用

`app/api/chat-with-tools-anthropic/route.ts`：

```typescript
import { streamText, tool } from 'ai'
import { anthropic } from '@ai-sdk/anthropic'
import { z } from 'zod'

export async function POST(req: Request) {
  const { messages } = await req.json()

  const result = streamText({
    model: anthropic('claude-3-5-sonnet-20241022'),
    messages,
    tools: {
      translate: tool({
        description: '将文本翻译成指定语言',
        parameters: z.object({
          text: z.string().describe('待翻译的文本'),
          targetLang: z.string().describe('目标语言代码，如 zh、en、ja'),
        }),
        execute: async ({ text, targetLang }) => {
          // 在实际项目中调用翻译 API
          return { translated: `[${targetLang}] ${text}` }
        },
      }),
    },
    maxSteps: 5,
  })

  return result.toDataStreamResponse()
}
```

## 运行验证

```bash
# 测试工具调用
curl -X POST http://localhost:3000/api/chat-with-tools \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"北京的天气怎么样？"}]}'

# 测试结构化输出
curl -X POST http://localhost:3000/api/analyze-sentiment \
  -H "Content-Type: application/json" \
  -d '{"text":"这个产品太棒了，我非常喜欢！"}'

# 测试 Embedding 语义搜索
curl -X POST http://localhost:3000/api/embed \
  -H "Content-Type: application/json" \
  -d '{"query":"AI 模型"}'
```

## 常见问题

### Q: `maxSteps` 是什么？

`maxSteps` 控制工具调用的最大轮次。在每一步中，模型可以调用多个工具，执行结果会传回模型继续推理。建议初始设为 5，避免无限循环和 token 消耗。

### Q: Tool Calling 和 Function Calling 有什么区别？

AI SDK 统一称为 Tool Calling。`@ai-sdk/openai` 底层使用 OpenAI 的 Function Calling API，`@ai-sdk/anthropic` 使用 Anthropic 的 Tool Use API。作为开发者，你只需使用 AI SDK 的 `tool()` 函数定义工具。

### Q: 如何在没有网络的环境中测试 Tool Calling？

在 `execute` 函数中直接返回模拟数据即可。工具函数的执行环境在服务器端，你可以访问本地数据库、文件系统或缓存。

### Q: `generateObject` 和 `generateText` 的区别？

`generateText` 返回自由文本；`generateObject` 返回符合 Zod Schema 的 JSON 对象，适合需要保证输出格式的场景。

### Q: Embedding 模型如何选择？

- `text-embedding-3-small` — 性价比最高，1536 维
- `text-embedding-3-large` — 精度最高，3072 维
- Anthropic 不提供 Embedding API，建议使用 OpenAI 的 Embedding 模型

### Q: AI SDK 4.x 和 3.x 的区别？

AI SDK v4 引入了 Provider 架构、新的 `generateText`/`streamText` API，替代了 v3 的 `Completion` API。建议使用 v4 的最新版本。
