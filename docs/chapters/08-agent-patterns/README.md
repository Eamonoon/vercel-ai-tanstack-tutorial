# 第8章 Agent 模式与多步推理

## 8.1 概述

AI Agent（代理）是一个能够自主决策和执行任务的 AI 系统。与简单的"一问一答"不同，Agent 可以思考、调用工具、观察结果、调整策略，直到完成任务。

**Agent vs 普通 Chat：**

| 特性 | 普通 Chat | Agent |
|------|-----------|-------|
| 交互方式 | 一问一答 | 多步推理 |
| 工具使用 | 用户手动操作 | 模型自主调用 |
| 状态管理 | 只有对话历史 | 有记忆、上下文、执行状态 |
| 复杂任务 | 需要用户分解 | 可自主规划执行 |
| 错误恢复 | 用户纠正 | 可自我纠正 |

Agent 的核心价值在于**将用户的意图转化为可执行的行动序列**。用户说"帮我查一下北京下周的天气，如果是晴天就推荐几个公园"，传统方式需要用户自己查天气、做判断、搜索公园。Agent 可以自主完成这一切。

**本章目标：** 理解 Agent 循环的原理，掌握 `maxSteps` 的深入使用，能够构建从简单到复杂的 AI Agent 应用。

## 8.2 Agent 循环原理

AI SDK 的 Agent 循环是自动化的"思考-行动-观察"过程：

```
用户输入 → 模型生成 → [是否调用工具？]
    ↓                        ↓
   否                      是
    ↓                        ↓
 输出回答           执行工具（execute）
                       ↓
                 工具结果返回模型
                       ↓
                 模型继续生成 →
                       ↓
                [是否调用工具？] ← 循环
                       ↓
                      否
                       ↓
                    输出最终回答
```

### 在代码中，这个循环由 `streamText` 和 `maxSteps` 自动管理：

```typescript
const result = streamText({
  model: getModel(provider),
  messages,
  tools: { search, calculate },
  maxSteps: 5, // 最多 5 轮 Agent 循环
  onStepFinish: (step) => {
    console.log('步骤完成:', {
      text: step.text,
      toolCalls: step.toolCalls,
      toolResults: step.toolResults,
      finishReason: step.finishReason,
    })
  },
})
```

### 关键观察点：

1. **每一步可以调用多个工具**：模型可以同时发出多个工具调用请求
2. **工具调用是并行的**：如果模型同时要求调用多个工具，SDK 会并行执行
3. **结果合并**：所有工具的执行结果会同时传回模型
4. **循环终止条件**：
   - 模型直接生成了最终回答（不调用工具）
   - 达到 `maxSteps` 上限
   - 工具执行抛出未捕获的异常

## 8.3 `maxSteps` 深入

### Token 消耗分析

每一步 Agent 循环都会消耗 Token：
- 输入：对话历史 + 工具定义 + 工具执行结果
- 输出：模型的思考过程和新的工具调用/回答

```typescript
const result = streamText({
  model: getModel(provider),
  messages,
  tools: { ... },
  maxSteps: 5,
})

// 读取最终消耗
const text = await result.text
const { usage } = await result
console.log('总 Token 消耗:', {
  prompt: usage.promptTokens,
  completion: usage.completionTokens,
  total: usage.totalTokens,
})
```

### 如何选择合适的 `maxSteps` 值

| 任务复杂度 | 建议 maxSteps | 说明 |
|-----------|---------------|------|
| 单步工具调用 | 2 | 一次工具调用 + 回答 |
| 简单问答 | 3 | 可能需 1-2 次工具调用 |
| 多步推理 | 5-8 | 搜索 → 分析 → 计算 |
| 复杂任务 | 10-15 | 多轮迭代 |
| 长时间任务 | 20-50 | 谨慎，注意 Token 消耗 |

### 循环控制与防止无限循环

```typescript
// 设置合理的 maxSteps，防止无限循环
const MAX_STEPS = 10

// 或使用 onFinish 检查消耗
const result = streamText({
  model: getModel(provider),
  messages,
  tools: { ... },
  maxSteps: MAX_STEPS,
  onFinish: ({ usage }) => {
    if (usage.totalTokens > 10000) {
      console.warn('Token 消耗过高，考虑简化任务')
    }
  },
})
```

## 8.4 Agent 状态管理

Agent 的状态不仅包含对话历史，还包括上下文、临时数据和执行状态。虽然没有内置的状态管理，但可以通过以下模式实现：

```typescript
// Agent 执行上下文
interface AgentContext {
  userId: string
  sessionId: string
  task: string
  progress: string[]
  results: Record<string, unknown>
  errors: string[]
}

// 在工具中访问上下文（通过闭包）
function createAgentTools(context: AgentContext) {
  return {
    save_progress: tool({
      description: '保存当前进度',
      parameters: z.object({ step: z.string() }),
      execute: async ({ step }) => {
        context.progress.push(step)
        return { ok: true, totalSteps: context.progress.length }
      },
    }),
    get_history: tool({
      description: '获取当前执行历史',
      parameters: z.object({}),
      execute: async () => {
        return {
          progress: context.progress,
          results: context.results,
          errors: context.errors,
        }
      },
    }),
  }
}
```

## 8.5 代码示例

### 示例1：简单 Agent（单个工具）

一个基础的 Agent，配备搜索工具，可以自主决定何时调用。

`src/app/api/simple-agent/route.ts`：

```typescript
import { streamText, tool } from 'ai'
import { getModel } from '@/lib/ai'
import { z } from 'zod'

const searchTool = tool({
  description: '搜索知识库，获取关于编程、技术框架、工具的信息',
  parameters: z.object({
    query: z.string().describe('搜索关键词'),
  }),
  execute: async ({ query }) => {
    const knowledge: Record<string, string> = {
      'React': 'React 是一个用于构建用户界面的 JavaScript 库，由 Meta 维护。核心概念包括组件、状态（state）、属性（props）和虚拟 DOM。',
      'Next.js': 'Next.js 是一个 React 全栈框架，支持 App Router、服务端组件、静态生成和 API 路由。',
      'TypeScript': 'TypeScript 是 JavaScript 的超集，添加了静态类型系统。支持泛型、接口、枚举等特性。',
      'Tailwind CSS': 'Tailwind CSS 是一个实用优先的 CSS 框架，通过原子化 class 快速构建自定义 UI。',
      'Prisma': 'Prisma 是一个 Node.js/TypeScript ORM，提供类型安全的数据库访问和迁移工具。',
    }

    const results = Object.entries(knowledge)
      .filter(([key]) => key.toLowerCase().includes(query.toLowerCase()) || query.toLowerCase().includes(key.toLowerCase()))
      .map(([key, value]) => ({ topic: key, content: value }))

    return results.length > 0
      ? { results }
      : { results: [{ topic: '未找到', content: `没有关于 "${query}" 的信息` }] }
  },
})

export async function POST(req: Request) {
  try {
    const { messages } = await req.json()

    const result = streamText({
      model: getModel(provider),
      messages: [
        {
          role: 'system',
          content: '你是一个技术问答 Agent。当用户问技术问题时，如果需要最新或更详细的信息，使用搜索工具查询知识库。基于查询结果回答。',
        },
        ...messages,
      ],
      tools: { search: searchTool },
      maxSteps: 5,
    })

    return result.toDataStreamResponse()
  } catch (error) {
    console.error('Agent 错误:', error)
    return new Response(
      JSON.stringify({ error: '处理请求时发生错误，请稍后重试' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
}
```

`src/app/simple-agent/page.tsx`：

```tsx
'use client'

import { useChat } from 'ai/react'

export default function SimpleAgentPage() {
  const { messages, input, handleInputChange, handleSubmit, isLoading } = useChat({
    api: '/api/simple-agent',
  })

  return (
    <div className="max-w-3xl mx-auto p-4">
      <h1 className="text-2xl font-bold mb-2">🤖 简单 Agent</h1>
      <p className="text-gray-500 mb-4">
        技术问答 Agent，可自动搜索知识库回答问题。试试"什么是 React？"
      </p>

      <div className="border rounded-lg p-4 mb-4 h-96 overflow-y-auto space-y-3">
        {messages.map((m) => {
          if (m.role === 'tool') return null
          return (
            <div
              key={m.id}
              className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-[80%] px-4 py-2 rounded-lg whitespace-pre-wrap ${
                  m.role === 'user' ? 'bg-blue-500 text-white' : 'bg-gray-100'
                }`}
              >
                {m.content || (m.toolInvocations ? '🔍 搜索中...' : '')}
              </div>
            </div>
          )
        })}
        {isLoading && messages[messages.length - 1]?.role === 'user' && (
          <div className="flex justify-start">
            <div className="bg-gray-100 px-4 py-2 rounded-lg">
              <span className="animate-pulse">思考中...</span>
            </div>
          </div>
        )}
      </div>

      <form onSubmit={handleSubmit}>
        <div className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={handleInputChange}
            placeholder="问一个技术问题..."
            className="flex-1 border rounded px-3 py-2"
            disabled={isLoading}
          />
          <button
            type="submit"
            disabled={isLoading}
            className="bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600 disabled:bg-gray-300"
          >
            发送
          </button>
        </div>
      </form>
    </div>
  )
}
```

### 示例2：多工具 Agent（搜索+计算）

Agent 配备搜索和计算两个工具，可以协同工作解决复杂问题。

`src/app/api/multi-tool-agent/route.ts`：

```typescript
import { streamText, tool } from 'ai'
import { getModel } from '@/lib/ai'
import { z } from 'zod'

const searchTool = tool({
  description: '搜索知识库获取技术信息和文档',
  parameters: z.object({
    query: z.string().describe('搜索词'),
  }),
  execute: async ({ query }) => {
    const db: Record<string, string> = {
      'gpt-4': 'GPT-4 是 OpenAI 的大语言模型，上下文窗口 128K，支持多模态。',
      'text-embedding-3-small': 'OpenAI Embedding 模型，1536 维，性价比最高。',
      'claude': 'Claude 是 Anthropic 的大语言模型，注重安全性和长文本处理。',
      'token': 'Token 是大语言模型处理文本的最小单位。1 个中文汉字约 1-2 个 Token。',
    }
    const results = Object.entries(db)
      .filter(([k]) => k.includes(query.toLowerCase()))
      .map(([k, v]) => ({ topic: k, info: v }))
    return { results: results.length > 0 ? results : [{ topic: query, info: `没有找到 "${query}" 的相关信息` }] }
  },
})

// 安全的数学表达式解析器（仅支持 + - * / 和括号）
function safeEvaluate(expr: string): number {
  const tokens = expr.match(/\d+\.?\d*|[-+*/()]|\s+/g)
  if (!tokens) throw new Error('无效的表达式')

  // 使用 Function 构造函数的替代方案：分步解析二元运算
  // 先处理括号，再处理乘除，最后处理加减
  let sanitized = expr.replace(/\s+/g, '')

  // 验证只允许数字和运算符
  if (!/^[\d+\-*/.()]+$/.test(sanitized)) {
    throw new Error('表达式包含非法字符')
  }

  // 递归解析括号
  while (sanitized.includes('(')) {
    const match = sanitized.match(/\(([^()]+)\)/)
    if (!match) throw new Error('括号不匹配')
    const value = evaluateSimple(match[1])
    sanitized = sanitized.replace(match[0], String(value))
  }

  return evaluateSimple(sanitized)
}

function evaluateSimple(expr: string): number {
  // 处理乘除
  let temp = expr
  while (/[*/]/.test(temp)) {
    const match = temp.match(/([\d.]+)([*/])([\d.]+)/)
    if (!match) break
    const [, left, op, right] = match
    const value = op === '*' ? Number(left) * Number(right) : Number(left) / Number(right)
    temp = temp.replace(match[0], String(value))
  }
  // 处理加减
  let result = 0
  let sign = 1
  let num = ''
  for (let i = 0; i <= temp.length; i++) {
    const char = temp[i] || '+'
    if (/[\d.]/.test(char)) {
      num += char
    } else if (/[+-]/.test(char)) {
      result += sign * (num ? Number(num) : 0)
      sign = char === '+' ? 1 : -1
      num = ''
    } else if (char) {
      throw new Error('无效的运算符')
    }
  }
  return result
}

const calculatorTool = tool({
  description: '执行数学计算，支持加减乘除、百分比等运算',
  parameters: z.object({
    expression: z.string().describe('数学表达式，如 "15000 * 0.8"、"100 + 200 * 3"'),
  }),
  execute: async ({ expression }) => {
    const sanitized = expression.replace(/[^0-9+\-*/.()\s]/g, '')
    if (!sanitized) {
      return { error: '表达式包含非法字符' }
    }
    try {
      // 安全解析：仅支持数字、运算符、括号和点号
      const result = safeEvaluate(sanitized)
      return { expression, result: Number(result.toFixed(2)) }
    } catch {
      return { error: `表达式 "${expression}" 无效，请检查格式` }
    }
  },
})

export async function POST(req: Request) {
  try {
    const { messages } = await req.json()

    const result = streamText({
      model: getModel(provider),
      messages: [
        {
          role: 'system',
          content: '你是一个多工具 Agent。你可以搜索知识库获取信息，也可以用计算器处理数学运算。面对复杂问题时，先搜索获取必要数据，再用计算器得出结果。',
        },
        ...messages,
      ],
      tools: {
        search: searchTool,
        calculate: calculatorTool,
      },
      maxSteps: 8,
    })

    return result.toDataStreamResponse()
  } catch (error) {
    console.error('Agent 错误:', error)
    return new Response(
      JSON.stringify({ error: '处理请求时发生错误，请稍后重试' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
}
```

`src/app/multi-tool-agent/page.tsx`：

```tsx
'use client'

import { useChat } from 'ai/react'

export default function MultiToolAgentPage() {
  const { messages, input, handleInputChange, handleSubmit, isLoading } = useChat({
    api: '/api/multi-tool-agent',
  })

  return (
    <div className="max-w-3xl mx-auto p-4">
      <h1 className="text-2xl font-bold mb-2">🛠 多工具 Agent</h1>
      <p className="text-gray-500 mb-4">
        可搜索 + 计算的 Agent。试试"GPT-4 的上下文多大？如果每轮对话消耗 2000 Token，128K 能支持多少轮？"
      </p>

      <div className="border rounded-lg p-4 mb-4 h-96 overflow-y-auto space-y-3">
        {messages.map((m) => {
          if (m.role === 'tool') return null
          return (
            <div
              key={m.id}
              className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-[80%] px-4 py-2 rounded-lg whitespace-pre-wrap ${
                  m.role === 'user' ? 'bg-purple-500 text-white' : 'bg-gray-100'
                }`}
              >
                {m.content || (m.toolInvocations ? '🔄 调用工具中...' : '')}
              </div>
            </div>
          )
        })}
      </div>

      <form onSubmit={handleSubmit}>
        <div className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={handleInputChange}
            placeholder="输入复杂的多步问题..."
            className="flex-1 border rounded px-3 py-2"
            disabled={isLoading}
          />
          <button
            type="submit"
            disabled={isLoading}
            className="bg-purple-500 text-white px-4 py-2 rounded hover:bg-purple-600 disabled:bg-gray-300"
          >
            {isLoading ? '处理中...' : '发送'}
          </button>
        </div>
      </form>
    </div>
  )
}
```

### 示例3：带记忆的 Agent

Agent 能够在多次对话中记住用户偏好和上下文。

`src/app/api/agent-with-memory/route.ts`：

```typescript
import { streamText, tool } from 'ai'
import { getModel } from '@/lib/ai'
import { z } from 'zod'

// 模拟持久化存储
const userMemory = new Map<string, Record<string, unknown>>()

function getUserMemory(userId: string): Record<string, unknown> {
  if (!userMemory.has(userId)) {
    userMemory.set(userId, { preferences: {}, history: [] })
  }
  return userMemory.get(userId)!
}

const memoryTool = tool({
  description: '记住用户的信息和偏好。当用户告诉你个人信息或偏好时，调用此工具保存。key 使用英文驼峰命名。',
  parameters: z.object({
    key: z.string().describe('信息的键名，如 favoriteColor、userName'),
    value: z.string().describe('信息的值'),
  }),
  execute: async ({ key, value }) => {
    const userId = 'default-user'
    const memory = getUserMemory(userId)
    memory.preferences = { ...memory.preferences as Record<string, string>, [key]: value }
    return { ok: true, saved: { [key]: value } }
  },
})

const recallTool = tool({
  description: '回忆用户之前告诉过你的信息',
  parameters: z.object({
    query: z.string().describe('想回忆的信息描述，如"用户喜欢的颜色"'),
  }),
  execute: async () => {
    const userId = 'default-user'
    const memory = getUserMemory(userId)
    return {
      preferences: memory.preferences,
      notes: Object.keys(memory.preferences as Record<string, string>).length === 0
        ? '暂无已保存的用户信息'
        : `已记住 ${Object.keys(memory.preferences as Record<string, string>).length} 条信息`,
    }
  },
})

export async function POST(req: Request) {
  try {
    const { messages } = await req.json()

    // 从最后一条 user 消息中提取用户标识
    const memory = getUserMemory('default-user')

    const result = streamText({
      model: getModel(provider),
      messages: [
        {
          role: 'system',
          content: `你是一个带记忆功能的 AI 助手。你有两个工具：
1. remember：当用户告诉你个人信息或偏好时，用这个工具保存
2. recall：当你需要回忆用户信息时，用这个工具查询

当前已知用户信息：${JSON.stringify(memory.preferences)}
永远不要在回答中直接暴露你正在使用记忆工具。自然地和用户交流即可。`,
        },
        ...messages,
      ],
      tools: {
        remember: memoryTool,
        recall: recallTool,
      },
      maxSteps: 5,
    })

    return result.toDataStreamResponse()
  } catch (error) {
    console.error('Agent 错误:', error)
    return new Response(
      JSON.stringify({ error: '处理请求时发生错误，请稍后重试' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
}
```

`src/app/agent-with-memory/page.tsx`：

```tsx
'use client'

import { useChat } from 'ai/react'

export default function AgentWithMemoryPage() {
  const { messages, input, handleInputChange, handleSubmit, isLoading } = useChat({
    api: '/api/agent-with-memory',
  })

  return (
    <div className="max-w-3xl mx-auto p-4">
      <h1 className="text-2xl font-bold mb-2">🧠 Agent 带记忆</h1>
      <p className="text-gray-500 mb-4">
        能记住你的偏好和信息的智能助手。试试"我喜欢喝拿铁"、"我住在北京"，然后问"你还记得我的信息吗？"
      </p>

      <div className="border rounded-lg p-4 mb-4 h-96 overflow-y-auto space-y-3">
        {messages.map((m) => {
          if (m.role === 'tool') return null
          return (
            <div
              key={m.id}
              className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-[80%] px-4 py-2 rounded-lg whitespace-pre-wrap ${
                  m.role === 'user' ? 'bg-teal-500 text-white' : 'bg-gray-100'
                }`}
              >
                {m.content}
              </div>
            </div>
          )
        })}
        {isLoading && (
          <div className="flex justify-start">
            <div className="bg-gray-100 px-4 py-2 rounded-lg animate-pulse">
              思考中...
            </div>
          </div>
        )}
      </div>

      <form onSubmit={handleSubmit}>
        <div className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={handleInputChange}
            placeholder="告诉我一些信息，或者问问题..."
            className="flex-1 border rounded px-3 py-2"
            disabled={isLoading}
          />
          <button
            type="submit"
            disabled={isLoading}
            className="bg-teal-500 text-white px-4 py-2 rounded hover:bg-teal-600 disabled:bg-gray-300"
          >
            发送
          </button>
        </div>
      </form>
    </div>
  )
}
```

### 示例4：Agent with Fallback（降级策略）

Agent 在执行复杂任务时，可能部分失败。本示例展示如何实现降级策略——当主要工具失败时，自动使用备选方案。

`src/app/api/agent-with-fallback/route.ts`：

```typescript
import { streamText, tool } from 'ai'
import { getModel } from '@/lib/ai'
import { z } from 'zod'

const flightSearchTool = tool({
  description: '搜索航班信息，包括航班号、时间、价格和状态',
  parameters: z.object({
    from: z.string().describe('出发城市'),
    to: z.string().describe('到达城市'),
    date: z.string().describe('出发日期，格式 YYYY-MM-DD'),
  }),
  execute: async ({ from, to, date }) => {
    const isWeekend = new Date(date).getDay() === 6 || new Date(date).getDay() === 0

    if (isWeekend) {
      return {
        error: '周末航班数据暂时不可用',
        fallbackAvailable: true,
        fallbackMessage: '周末航班需联系人工客服查询，建议选择工作日出行',
        alternativeDates: [
          { date: '2025-06-02', day: '周一' },
          { date: '2025-06-03', day: '周二' },
        ],
      }
    }

    const flights = [
      { flightNo: 'CA1234', from, to, departure: '08:00', arrival: '10:30', price: 1280 },
      { flightNo: 'MU5678', from, to, departure: '14:00', arrival: '16:30', price: 980 },
      { flightNo: 'CZ9012', from, to, departure: '19:00', arrival: '21:30', price: 750 },
    ]

    return { success: true, flights }
  },
})

const trainSearchTool = tool({
  description: '搜索高铁信息，作为无法查询到航班时的备选方案',
  parameters: z.object({
    from: z.string().describe('出发城市'),
    to: z.string().describe('到达城市'),
    date: z.string().describe('出发日期，格式 YYYY-MM-DD'),
  }),
  execute: async ({ from, to, date }) => {
    const trains = [
      { trainNo: 'G123', from, to, departure: '07:00', arrival: '11:30', price: 538, duration: '4h30m' },
      { trainNo: 'G456', from, to, departure: '12:00', arrival: '16:30', price: 538, duration: '4h30m' },
      { trainNo: 'G789', from, to, departure: '18:00', arrival: '22:30', price: 478, duration: '4h30m' },
    ]
    return { success: true, trains }
  },
})

const weatherCheckTool = tool({
  description: '查询目的地天气，帮助用户决定出行方式',
  parameters: z.object({
    city: z.string().describe('城市名称'),
    date: z.string().describe('日期，格式 YYYY-MM-DD'),
  }),
  execute: async ({ city, date }) => {
    const weathers: Record<string, { condition: string; temperature: number }> = {
      '北京': { condition: '晴', temperature: 25 },
      '上海': { condition: '多云', temperature: 28 },
      '广州': { condition: '阵雨', temperature: 32 },
      '成都': { condition: '阴', temperature: 22 },
    }
    return { city, date, ...weathers[city] ?? { condition: '未知', temperature: '未知' } }
  },
})

export async function POST(req: Request) {
  try {
    const { messages } = await req.json()

    const result = streamText({
      model: getModel(provider),
      messages: [
        {
          role: 'system',
          content: `你是一个智能出行助手。你的工作原则：
1. 优先查询航班信息
2. 如果航班查询返回错误且有 fallbackAvailable 标记，自动推荐高铁作为备选
3. 查询目的地天气，综合给出建议
4. 输出最终建议时，清晰地告诉用户可用的选项和你的推荐`,
        },
        ...messages,
      ],
      tools: {
        search_flights: flightSearchTool,
        search_trains: trainSearchTool,
        check_weather: weatherCheckTool,
      },
      maxSteps: 10,
    })

    return result.toDataStreamResponse()
  } catch (error) {
    console.error('Agent 错误:', error)
    return new Response(
      JSON.stringify({ error: '处理请求时发生错误，请稍后重试' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
}
```

`src/app/agent-with-fallback/page.tsx`：

```tsx
'use client'

import { useChat } from 'ai/react'

export default function AgentWithFallbackPage() {
  const { messages, input, handleInputChange, handleSubmit, isLoading } = useChat({
    api: '/api/agent-with-fallback',
  })

  return (
    <div className="max-w-3xl mx-auto p-4">
      <h1 className="text-2xl font-bold mb-2">🚀 智能出行 Agent</h1>
      <p className="text-gray-500 mb-4">
        航班查不到？自动推荐高铁。试试"6月1日（周六）从北京到上海的交通"或"6月2日（周一）从北京到广州"
      </p>

      <div className="border rounded-lg p-4 mb-4 h-96 overflow-y-auto space-y-3">
        {messages.map((m) => {
          if (m.role === 'tool') return null
          return (
            <div
              key={m.id}
              className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-[80%] px-4 py-2 rounded-lg whitespace-pre-wrap ${
                  m.role === 'user' ? 'bg-rose-500 text-white' : 'bg-gray-100'
                }`}
              >
                {m.content}
              </div>
            </div>
          )
        })}
        {isLoading && (
          <div className="flex justify-start">
            <div className="bg-gray-100 px-4 py-2 rounded-lg">
              <span className="animate-pulse">🔍 查询中...</span>
            </div>
          </div>
        )}
      </div>

      <form onSubmit={handleSubmit}>
        <div className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={handleInputChange}
            placeholder="例如：周一从北京到上海"
            className="flex-1 border rounded px-3 py-2"
            disabled={isLoading}
          />
          <button
            type="submit"
            disabled={isLoading}
            className="bg-rose-500 text-white px-4 py-2 rounded hover:bg-rose-600 disabled:bg-gray-300"
          >
            {isLoading ? '规划中...' : '发送'}
          </button>
        </div>
      </form>

      <div className="mt-4 p-3 bg-yellow-50 border border-yellow-200 rounded text-sm text-yellow-800">
        💡 <strong>提示：</strong>使用 2025-06-01（周六）试试周末降级效果
      </div>
    </div>
  )
}
```

## 8.6 运行验证

```bash
# 安装依赖
npm install ai @ai-sdk/openai zod

# 配置环境变量
echo "OPENAI_API_KEY=sk-your-key" > .env.local

# 启动开发服务器
npm run dev

# 测试简单 Agent
curl -X POST http://localhost:3000/api/simple-agent \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"什么是 Next.js？"}]}'

# 测试多工具 Agent（搜索+计算）
curl -X POST http://localhost:3000/api/multi-tool-agent \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"GPT-4 的上下文有多大？如果每次消耗 2000 Token，最多可以对话多少轮？"}]}'

# 测试带降级的出行 Agent
curl -X POST http://localhost:3000/api/agent-with-fallback \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"2025-06-01 从北京到上海的交通方案"}]}'
```

浏览器访问：
- `http://localhost:3000/simple-agent`
- `http://localhost:3000/multi-tool-agent`
- `http://localhost:3000/agent-with-memory`
- `http://localhost:3000/agent-with-fallback`

## 8.7 常见问题

### Q: Agent 总是超出 maxSteps 怎么办？

有两种可能：
1. **任务太复杂**：增加 `maxSteps`，或告诉模型尽量合并工具调用
2. **模型陷入循环**：检查工具的 `description` 是否清晰，或添加 `onStepFinish` 回调诊断问题

```typescript
const result = streamText({
  model: getModel(provider),
  messages,
  tools: { ... },
  maxSteps: 15,
  onStepFinish: (event) => {
    if (event.finishReason === 'tool-calls') {
      console.log('继续循环，已调用工具:', event.toolCalls.map(t => t.toolName))
    }
  },
})
```

### Q: Agent 如何支持并发工具调用？

AI SDK 原生支持并发。如果模型在同一轮返回多个工具调用，SDK 会自动并行执行。无需额外配置。

### Q: 如何限制 Agent 只使用特定工具？

在不同的 `streamText` 调用中可以配置不同的工具集。例如：

```typescript
// 第一阶段：只允许搜索
const step1 = streamText({ model, messages, tools: { search } })

// 第二阶段：只允许计算
const step2 = streamText({ model, messages: step1.messages, tools: { calculate } })
```

### Q: Agent 的 Token 消耗如何预估？

可以用这个粗略公式估算：
```
总消耗 ≈ 基础对话消耗 × (1 + 工具调用轮次 × 0.5)
```
每次工具调用都会把定义 + 执行结果传回模型，消耗大约为基础对话的 50%。

### Q: Agent 的执行结果如何持久化？

当前示例使用内存。生产环境应：
1. 将对话历史和工具结果存入数据库
2. 使用唯一 session ID 关联每次 Agent 运行
3. 考虑长任务使用队列（如 Bull/BullMQ）异步执行

### Q: 如何让 Agent 支持中断和恢复？

可以在 `execute` 中定期保存状态，并在下一个请求中恢复：

```typescript
const context = { currentStep: 0, maxSteps: 10, data: [] }

const myTool = tool({
  description: '...',
  parameters: z.object({ ... }),
  execute: async (args) => {
    context.currentStep++
    // 处理数据...
    context.data.push(result)
    // 保存 checkpoint
    await saveCheckpoint(context)
    return result
  },
})
```

### Q: `streamText` 和 `generateText` 在 Agent 模式下有什么区别？

`streamText` 适合需要逐步展示推理过程的 UI 场景。`generateText` 适合后端处理（如定时任务、批处理）。Agent 循环机制完全相同。

## 8.8 本章小结

本章全面介绍了 AI Agent 模式与多步推理：

- **Agent 循环原理**：思考 → 工具调用 → 观察结果 → 继续思考的自动化循环
- **`maxSteps` 深入**：从 Token 控制到循环终止条件，合理配置步骤数
- **四种 Agent 模式**：
  1. **简单 Agent**：单工具，适合基础问答
  2. **多工具 Agent**：搜索+计算协同，解决复杂问题
  3. **带记忆 Agent**：持久化用户偏好和上下文
  4. **降级 Agent**：主要工具失败时自动切换到备选方案

Agent 模式是 AI 应用的未来方向。从本章示例出发，你已经掌握了构建 AI Agent 的核心能力。在实战项目中，可以根据业务需求组合这些模式，构建出强大的 AI 自动化系统。
