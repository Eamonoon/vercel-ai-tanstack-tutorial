# 第5章 工具调用（Tool Calling）实战

## 5.1 概述

工具调用（Tool Calling）是 AI SDK 最强大的能力之一。它让大语言模型不仅能够"说话"，还能"做事"——调用外部 API、查询数据库、执行业务逻辑，然后把结果融入对话。

**为什么需要工具调用？**

大语言模型的训练数据有截止日期，无法获取实时信息（天气、股价、新闻），也无法访问你的私有数据（用户信息、订单记录、内部文档）。工具调用就是解决这个问题的桥梁：模型决定"什么时候需要外部信息"，你的代码负责"去获取这些信息"，模型再基于结果生成最终回答。

**本章目标：** 掌握 `tool()` 函数的完整用法，理解 `maxSteps` 多步推理机制，能够构建带真实/模拟工具调用的 AI 应用。

## 5.2 `tool()` 函数详解

`tool()` 是 AI SDK 中定义工具的核心函数，接收一个配置对象，包含以下关键属性：

### description（必需）

描述工具的功能，帮助模型判断何时调用此工具。描述越清晰，模型选对工具的概率越高。

```typescript
import { tool } from 'ai'
import { z } from 'zod'

const weatherTool = tool({
  description: '根据城市名称查询实时天气信息，支持国内外主要城市',
  parameters: z.object({
    city: z.string().describe('城市名称，如 北京、上海、Tokyo、New York'),
  }),
  execute: async ({ city }) => {
    // 实际 API 调用
    const res = await fetch(`https://api.weather.com/v1/cities/${city}`)
    return res.json()
  },
})
```

### parameters（必需）

使用 Zod Schema 定义工具需要的参数。模型会根据这个 Schema 自动生成符合格式的参数。

```typescript
parameters: z.object({
  city: z.string().describe('城市名称'),
  units: z.enum(['celsius', 'fahrenheit']).optional().describe('温度单位，默认摄氏'),
})
```

### execute（可选）

工具的实际执行函数。如果不提供 execute，工具仅用于"让模型决定调用"（适合需要人工确认的场景）。

```typescript
execute: async ({ city, units }) => {
  const data = await fetchWeather(city, units ?? 'celsius')
  return data
}
```

## 5.3 `maxSteps` 多步推理

`maxSteps` 控制工具调用的最大迭代轮次。AI SDK 的 Agent 循环是自动的：

1. 模型接收用户消息
2. 模型决定调用工具（返回工具调用请求）
3. SDK 自动执行 `execute` 函数
4. 执行结果传回模型
5. 模型继续推理，可能再次调用工具或生成最终回答
6. 重复直到模型生成最终回答或达到 `maxSteps` 上限

```typescript
const result = streamText({
  model: getModel(provider),
  messages,
  tools: { tool1, tool2 },
  maxSteps: 5, // 最多允许 5 轮工具调用
})
```

**关键点：**
- 每一步模型可以同时调用多个工具
- `maxSteps=1` 相当于只允许一次工具调用
- 建议初始值设为 3-5，避免过度消耗 Token
- 长时间运行的 Agent 任务可以设为 10-20

## 5.4 真实 API 调用 vs 模拟数据

工具调用中 `execute` 函数可以返回真实数据或模拟数据，取决于你的使用场景：

| 场景 | 推荐方式 | 原因 |
|------|----------|------|
| 原型开发 | 模拟数据 | 快速迭代，不依赖外部服务 |
| 测试 | 模拟数据 | 确定性输出，方便断言 |
| 生产环境 | 真实 API | 返回真实数据给用户 |
| 演示 | 模拟数据 | 避免 API 调用延时和费用 |

**真实 API 调用示例：**

```typescript
execute: async ({ city }) => {
  const apiKey = process.env.WEATHER_API_KEY
  const res = await fetch(
    `https://api.openweathermap.org/data/2.5/weather?q=${city}&appid=${apiKey}`
  )
  if (!res.ok) throw new Error(`天气 API 返回错误: ${res.status}`)
  return await res.json()
}
```

**模拟数据示例：**

```typescript
execute: async ({ city }) => {
    const mockDb: Record<string, { temperature: number; condition: string; humidity: number }> = {
    '北京': { temperature: 22, condition: '晴', humidity: 45 },
    '上海': { temperature: 28, condition: '多云', humidity: 70 },
  }
  return mockDb[city] ?? { error: `未找到 ${city} 的天气数据` }
}
```

## 5.5 代码示例

### 示例1：天气查询工具

本示例展示一个带流式输出的天气查询工具。用户输入城市名，模型自动调用天气工具获取数据并生成回答。

`src/app/api/weather/route.ts`：

```typescript
import { streamText, tool } from 'ai'
import { getModel } from '@/lib/ai'
import { z } from 'zod'

const weatherTool = tool({
  description: '查询指定城市的当前天气信息，包括温度、天气状况和湿度',
  parameters: z.object({
    city: z.string().describe('城市名称，如 北京、上海、广州'),
  }),
  execute: async ({ city }) => {
    const weatherDb: Record<string, { temperature: number; condition: string; humidity: number }> = {
      '北京': { temperature: 22, condition: '晴', humidity: 45 },
      '上海': { temperature: 28, condition: '多云', humidity: 70 },
      '广州': { temperature: 32, condition: '阵雨', humidity: 85 },
      '深圳': { temperature: 30, condition: '阴', humidity: 78 },
      '成都': { temperature: 20, condition: '小雨', humidity: 80 },
    }

    const data = weatherDb[city]
    if (!data) {
      return { error: `未找到 ${city} 的天气数据` }
    }

    return {
      city,
      ...data,
      updatedAt: new Date().toISOString(),
    }
  },
})

if (!process.env.OPENAI_API_KEY && !process.env.ANTHROPIC_API_KEY) {
  throw new Error('请设置 OPENAI_API_KEY 或 ANTHROPIC_API_KEY 环境变量')
}

export async function POST(req: Request) {
  try {
    const { messages } = await req.json()

    const result = streamText({
      model: getModel(provider),
      messages,
      tools: { get_weather: weatherTool },
      maxSteps: 5,
    })

    return result.toDataStreamResponse()
  } catch (error) {
    return new Response(
      JSON.stringify({ error: '处理请求时发生错误，请稍后重试' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
}
```

`src/app/weather/page.tsx`：

```tsx
'use client'

import { useChat } from 'ai/react'

export default function WeatherPage() {
  const { messages, input, handleInputChange, handleSubmit, isLoading } = useChat({
    api: '/api/weather',
  })

  return (
    <div className="max-w-3xl mx-auto p-4">
      <h1 className="text-2xl font-bold mb-2">🌤 天气查询助手</h1>
      <p className="text-gray-500 mb-4">输入城市名，查询实时天气信息</p>

      <div className="border rounded-lg p-4 mb-4 h-96 overflow-y-auto space-y-3">
        {messages.map((m) => (
          <div
            key={m.id}
            className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[80%] px-4 py-2 rounded-lg whitespace-pre-wrap ${
                m.role === 'user'
                  ? 'bg-blue-500 text-white'
                  : m.role === 'tool'
                    ? 'bg-yellow-50 border border-yellow-200 text-sm text-gray-600'
                    : 'bg-gray-100'
              }`}
            >
              {m.content || (m.toolInvocations ? '🔧 调用工具中...' : '')}
            </div>
          </div>
        ))}
      </div>

      <form onSubmit={handleSubmit}>
        <div className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={handleInputChange}
            placeholder="输入城市名称，如 北京"
            className="flex-1 border rounded px-3 py-2"
            disabled={isLoading}
          />
          <button
            type="submit"
            disabled={isLoading}
            className="bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600 disabled:bg-gray-300"
          >
            {isLoading ? '查询中...' : '发送'}
          </button>
        </div>
      </form>
    </div>
  )
}
```

### 示例2：数据库查询工具

本示例模拟一个查询用户订单信息的数据库工具。

`src/app/api/order-query/route.ts`：

```typescript
import { streamText, tool } from 'ai'
import { getModel } from '@/lib/ai'
import { z } from 'zod'

const orderDb = [
  { orderId: 'ORD-001', userId: 'U001', product: 'Vercel AI SDK 教程', amount: 99, status: '已支付', date: '2025-01-15' },
  { orderId: 'ORD-002', userId: 'U001', product: 'Next.js 从入门到精通', amount: 149, status: '已发货', date: '2025-02-20' },
  { orderId: 'ORD-003', userId: 'U002', product: 'TypeScript 高级编程', amount: 79, status: '待支付', date: '2025-03-01' },
  { orderId: 'ORD-004', userId: 'U002', product: 'React 设计模式', amount: 119, status: '已完成', date: '2025-01-10' },
]

const queryOrderTool = tool({
  description: '根据用户 ID 查询该用户的所有订单记录，包含订单状态、金额和日期',
  parameters: z.object({
    userId: z.string().describe('用户 ID，如 U001、U002'),
  }),
  execute: async ({ userId }) => {
    const orders = orderDb.filter((o) => o.userId === userId)
    if (orders.length === 0) {
      return { error: `未找到用户 ${userId} 的订单记录` }
    }
    return { userId, orders, total: orders.length }
  },
})

const queryUserTool = tool({
  description: '根据用户 ID 查询用户基本信息',
  parameters: z.object({
    userId: z.string().describe('用户 ID，如 U001、U002'),
  }),
  execute: async ({ userId }) => {
    const userDb: Record<string, { name: string; level: string; joinDate: string }> = {
      U001: { name: '张三', level: '黄金会员', joinDate: '2024-06-01' },
      U002: { name: '李四', level: '白银会员', joinDate: '2024-09-15' },
    }
    return userDb[userId] ?? { error: '用户不存在' }
  },
})

export async function POST(req: Request) {
  try {
    const { messages } = await req.json()

    const result = streamText({
      model: getModel(provider),
      messages,
      tools: {
        query_orders: queryOrderTool,
        query_user: queryUserTool,
      },
      maxSteps: 5,
    })

    return result.toDataStreamResponse()
  } catch (error) {
    return new Response(
      JSON.stringify({ error: '处理请求时发生错误，请稍后重试' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
}
```

`src/app/order-query/page.tsx`：

```tsx
'use client'

import { useChat } from 'ai/react'

export default function OrderQueryPage() {
  const { messages, input, handleInputChange, handleSubmit, isLoading } = useChat({
    api: '/api/order-query',
  })

  return (
    <div className="max-w-3xl mx-auto p-4">
      <h1 className="text-2xl font-bold mb-2">📦 订单查询助手</h1>
      <p className="text-gray-500 mb-4">查询用户信息和订单记录</p>

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
                  m.role === 'user'
                    ? 'bg-blue-500 text-white'
                    : 'bg-gray-100'
                }`}
              >
                {m.content}
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
            placeholder="例如：查询用户 U001 的订单"
            className="flex-1 border rounded px-3 py-2"
            disabled={isLoading}
          />
          <button
            type="submit"
            disabled={isLoading}
            className="bg-green-500 text-white px-4 py-2 rounded hover:bg-green-600 disabled:bg-gray-300"
          >
            {isLoading ? '查询中...' : '发送'}
          </button>
        </div>
      </form>
    </div>
  )
}
```

### 示例3：多工具组合（天气+搜索）

本示例展示多个工具协同工作：一个工具查询天气，另一个进行语义搜索。

`src/app/api/multi-tools/route.ts`：

```typescript
import { streamText, tool } from 'ai'
import { getModel } from '@/lib/ai'
import { z } from 'zod'

const weatherTool = tool({
  description: '查询城市的当前天气信息',
  parameters: z.object({
    city: z.string().describe('城市名称'),
  }),
  execute: async ({ city }) => {
    const db: Record<string, { temperature: number; condition: string }> = {
      '北京': { temperature: 22, condition: '晴' },
      '上海': { temperature: 28, condition: '多云' },
      '杭州': { temperature: 25, condition: '阴' },
      '深圳': { temperature: 30, condition: '阵雨' },
    }
    return db[city] ?? { error: `没有 ${city} 的天气数据` }
  },
})

const searchTool = tool({
  description: '搜索知识库中的信息，用于回答关于编程、技术等问题',
  parameters: z.object({
    query: z.string().describe('搜索关键词'),
  }),
  execute: async ({ query }) => {
    const knowledgeBase: Record<string, string> = {
      'Vercel AI SDK': 'Vercel AI SDK 是一个开源的 TypeScript 库，提供统一的 AI 接口层，支持 OpenAI、Anthropic 等多种模型提供商。',
      'Next.js': 'Next.js 是一个 React 全栈框架，支持服务端渲染、静态生成和 API 路由。',
      '工具调用': '工具调用（Tool Calling）让 LLM 能够调用外部函数获取数据或执行操作。',
      'maxSteps': 'maxSteps 控制工具调用的最大轮次，防止模型陷入无限循环。',
    }

    const results = Object.entries(knowledgeBase)
      .filter(([key]) => key.includes(query) || query.includes(key))
      .map(([key, value]) => ({ title: key, content: value }))

    return results.length > 0
      ? { results }
      : { results: [{ title: '未找到', content: `没有找到与 "${query}" 相关的信息` }] }
  },
})

export async function POST(req: Request) {
  try {
    const { messages } = await req.json()

    const result = streamText({
      model: getModel(provider),
      messages,
      tools: {
        get_weather: weatherTool,
        search_knowledge: searchTool,
      },
      maxSteps: 5,
    })

    return result.toDataStreamResponse()
  } catch (error) {
    return new Response(
      JSON.stringify({ error: '处理请求时发生错误，请稍后重试' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
}
```

`src/app/multi-tools/page.tsx`：

```tsx
'use client'

import { useChat } from 'ai/react'

export default function MultiToolsPage() {
  const { messages, input, handleInputChange, handleSubmit, isLoading } = useChat({
    api: '/api/multi-tools',
  })

  return (
    <div className="max-w-3xl mx-auto p-4">
      <h1 className="text-2xl font-bold mb-2">🛠 多工具助手</h1>
      <p className="text-gray-500 mb-4">
        我可以查天气、回答问题，试试说"北京天气怎么样？"或"什么是 Vercel AI SDK？"
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
                  m.role === 'user' ? 'bg-indigo-500 text-white' : 'bg-gray-100'
                }`}
              >
                {m.content}
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
            placeholder="问天气或问问题..."
            className="flex-1 border rounded px-3 py-2"
            disabled={isLoading}
          />
          <button
            type="submit"
            disabled={isLoading}
            className="bg-indigo-500 text-white px-4 py-2 rounded hover:bg-indigo-600 disabled:bg-gray-300"
          >
            {isLoading ? '思考中...' : '发送'}
          </button>
        </div>
      </form>
    </div>
  )
}
```

### 示例4：带错误恢复的工具调用

工具执行可能失败（网络错误、无效参数、数据不存在）。本示例展示如何让工具优雅处理错误，并让模型根据错误信息做出合理回应。

`src/app/api/tool-with-errors/route.ts`：

```typescript
import { streamText, tool } from 'ai'
import { getModel } from '@/lib/ai'
import { z } from 'zod'

const inventoryDb: Record<string, { name: string; price: number; stock: number; category: string }> = {
  'MACBOOK-PRO-14': { name: 'MacBook Pro 14英寸', price: 14999, stock: 10, category: '笔记本电脑' },
  'IPHONE-16-PRO': { name: 'iPhone 16 Pro', price: 8999, stock: 25, category: '手机' },
  'AIRPODS-4': { name: 'AirPods 4', price: 1299, stock: 0, category: '配件' },
  'IPAD-AIR': { name: 'iPad Air', price: 4799, stock: 5, category: '平板' },
}

const queryInventory = tool({
  description: '查询商品的库存信息，包括名称、价格、库存数量和分类',
  parameters: z.object({
    sku: z.string().describe('商品 SKU 编码，如 MACBOOK-PRO-14'),
  }),
  execute: async ({ sku }) => {
    const normalizedSku = sku.toUpperCase().trim()

    if (!normalizedSku) {
      return { error: 'SKU 编码不能为空' }
    }

    const product = inventoryDb[normalizedSku]
    if (!product) {
      return {
        error: `未找到 SKU 为 "${normalizedSku}" 的商品`,
        hint: '请检查 SKU 格式是否正确，可用商品包括：MACBOOK-PRO-14、IPHONE-16-PRO、AIRPODS-4、IPAD-AIR',
      }
    }

    if (product.stock === 0) {
      return {
        ...product,
        sku: normalizedSku,
        stock: 0,
        warning: '该商品当前无货',
        estimatedRestock: '2025-04-15',
      }
    }

    return { ...product, sku: normalizedSku, inStock: true }
  },
})

const calculateShipping = tool({
  description: '根据商品价格计算运费',
  parameters: z.object({
    price: z.number().positive().describe('商品价格（元）'),
    city: z.string().describe('收货城市'),
  }),
  execute: async ({ price, city }) => {
    const remoteCities = ['乌鲁木齐', '拉萨', '西宁']
    const baseFee = price >= 99 ? 0 : 15
    const remoteSurcharge = remoteCities.includes(city) ? 10 : 0
    return { shippingFee: baseFee + remoteSurcharge, freeShipping: baseFee === 0 }
  },
})

export async function POST(req: Request) {
  try {
    const { messages } = await req.json()

    const result = streamText({
      model: getModel(provider),
      messages,
      tools: {
        query_inventory: queryInventory,
        calculate_shipping: calculateShipping,
      },
      maxSteps: 5,
    })

    return result.toDataStreamResponse()
  } catch (error) {
    return new Response(
      JSON.stringify({ error: '处理请求时发生错误，请稍后重试' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
}
```

`src/app/tool-with-errors/page.tsx`：

```tsx
'use client'

import { useChat } from 'ai/react'

export default function ToolWithErrorsPage() {
  const { messages, input, handleInputChange, handleSubmit, isLoading } = useChat({
    api: '/api/tool-with-errors',
  })

  return (
    <div className="max-w-3xl mx-auto p-4">
      <h1 className="text-2xl font-bold mb-2">🏪 智能库存查询</h1>
      <p className="text-gray-500 mb-4">查询商品库存和运费，支持错误恢复</p>

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
                  m.role === 'user' ? 'bg-orange-500 text-white' : 'bg-gray-100'
                }`}
              >
                {m.content}
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
            placeholder="例如：查询 MACBOOK-PRO-14 的库存"
            className="flex-1 border rounded px-3 py-2"
            disabled={isLoading}
          />
          <button
            type="submit"
            disabled={isLoading}
            className="bg-orange-500 text-white px-4 py-2 rounded hover:bg-orange-600 disabled:bg-gray-300"
          >
            {isLoading ? '查询中...' : '发送'}
          </button>
        </div>
      </form>
    </div>
  )
}
```

## 5.6 运行验证

```bash
# 安装依赖（如果尚未安装）
npm install ai @ai-sdk/openai zod

# 配置环境变量
echo "OPENAI_API_KEY=sk-your-key" > .env.local

# 启动开发服务器
npm run dev

# 测试天气查询
curl -X POST http://localhost:3000/api/weather \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"北京的天气怎么样？"}]}'

# 测试多工具组合
curl -X POST http://localhost:3000/api/multi-tools \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"上海天气如何？顺便告诉我什么是工具调用"}]}'

# 测试带错误恢复的库存查询
curl -X POST http://localhost:3000/api/tool-with-errors \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"查一下 MACBOOK-PRO-14 有没有货"}]}'
```

浏览器访问对应路由：
- `http://localhost:3000/weather`
- `http://localhost:3000/multi-tools`
- `http://localhost:3000/tool-with-errors`

## 5.7 常见问题

### Q: `tool()` 的 `execute` 是否必须？

不是。如果不提供 `execute`，模型会返回工具调用请求，但 SDK 不会自动执行。适合需要人工确认或前端执行工具的场景。

### Q: 模型一直调用同一个工具怎么办？

检查 `maxSteps` 是否设置过低导致模型无法完成推理。也可能是工具 `description` 不够准确，导致模型理解错误。增加 `maxSteps` 或优化描述文本。

### Q: 工具执行结果太长会怎样？

工具 `execute` 的返回值会被完整传回模型。如果数据量很大（如查询返回 1000 条记录），会消耗大量 Token。建议在 `execute` 中对结果做摘要或分页。

### Q: 如何调试工具调用过程？

设置 `onStepFinish` 回调可以观察每一步的完整信息：

```typescript
const result = streamText({
  model: getModel(provider),
  messages,
  tools: { ... },
  maxSteps: 5,
  onStepFinish: (event) => {
    console.log('步骤完成:', {
      toolCalls: event.toolCalls,
      toolResults: event.toolResults,
      text: event.text,
    })
  },
})
```

### Q: 工具可以调用其他工具吗？

AI SDK 中的工具 `execute` 是独立的。如果需要工具链（A 工具调用 B 工具），需要在 `execute` 内部手动编排，或者利用 `maxSteps` 让模型在多个步骤中依次调用不同的工具。

### Q: 如何限制工具仅在特定条件下使用？

在 `execute` 函数内校验条件。也可以在多个模型调用之间切换——不同的 `streamText` 调用可以配置不同的工具集。

## 5.8 本章小结

本章深入介绍了 Vercel AI SDK 的工具调用机制：

- **`tool()` 函数**：通过 `description`、`parameters`（Zod Schema）和 `execute` 定义可供模型调用的工具
- **`maxSteps` 多步推理**：控制工具调用的迭代轮次，实现模型自主思考-执行-观察的循环
- **真实 vs 模拟数据**：根据场景选择合适的执行策略
- **错误恢复**：工具返回结构化错误信息，让模型理解并做出合适回应

工具调用是构建 AI Agent 的基础能力。在下一章中，我们将学习如何用 `generateObject` 获取结构化输出，让 AI 的输出更加可控、可预测。
