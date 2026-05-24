# 第6章 结构化输出：generateObject

## 6.1 概述

在大多数 AI 应用中，我们不仅需要 LLM 生成文本，还需要它返回结构化的数据——JSON 对象、枚举值、数组。比如情感分类（正/负/中性）、信息提取（从文章中提取姓名、日期、金额）、批量数据分类。

传统方法是用 `generateText` 生成文本，再用 `JSON.parse` 解析。但这种方法有两大问题：
1. 模型可能输出非标准 JSON（带注释、缺少引号、多余的逗号）
2. 没有类型校验，解析失败需要重试逻辑

**`generateObject` 解决了这些问题**：它要求模型直接输出符合 Zod Schema 的结构化数据，SDK 自动完成解析、校验和类型推断。

**本章目标：** 掌握 `generateObject` 的完整用法，理解它相比 `generateText` + `JSON.parse` 的优势，能够实现情感分析、信息提取、批量分类和嵌套 Schema 等常见场景。

## 6.2 `generateObject` API 详解

### 基本用法

```typescript
import { generateObject } from 'ai'
import { getModel } from '@/lib/ai'
import { z } from 'zod'

const { object } = await generateObject({
  model: getModel(provider),
  schema: z.object({
    name: z.string(),
    age: z.number(),
    hobbies: z.array(z.string()),
  }),
  prompt: '从这段文本中提取人物信息：张三，28岁，喜欢编程、摄影和篮球',
})
```

### 关键参数

| 参数 | 类型 | 说明 |
|------|------|------|
| `model` | Model | AI 模型实例 |
| `schema` | Zod Schema | 定义输出结构的 Schema |
| `prompt` | string | 用户提示词 |
| `system` | string | 系统提示词（可选） |
| `mode` | 'auto' \| 'json' \| 'tool' | 输出模式（可选）。`'json'` 为 OpenAI 专有，Anthropic 不支持 |

### 返回值

```typescript
const {
  object,       // 解析后的类型安全对象
  usage,        // Token 用量 { promptTokens, completionTokens, totalTokens }
  finishReason, // 结束原因
} = await generateObject({ ... })
```

### `mode` 参数

- `'auto'`（默认）：SDK 自动选择最佳模式
- `'json'`：强制模型以 JSON 格式输出（OpenAI 的 response_format）
- `'tool'`：通过工具调用机制获取结构化输出（某些模型对 JSON 模式支持更好）

```typescript
const { object } = await generateObject({
  model: getModel(provider),
  schema: mySchema,
  prompt: '...',
  mode: 'json', // 强制 JSON 模式
})
```

## 6.3 对比 `generateText` → `JSON.parse` vs `generateObject`

### 方法一：`generateText` + `JSON.parse`（不推荐）

```typescript
const { text } = await generateText({
  model: getModel(provider),
  prompt: `分析情感，返回 JSON: {"sentiment": "positive|negative|neutral", "score": 0-10}`,
})

try {
  const data = JSON.parse(text) // 可能失败！
  // data 类型为 any，无类型安全
} catch {
  // 需要重试逻辑
}
```

**常见问题：**
- 模型可能会输出 `\`\`\`json\n{...}\n\`\`\`` （Markdown 代码块）
- 模型可能会在 JSON 前后添加注释或额外文字
- 模型可能会输出格式不标准的 JSON（单引号、尾随逗号）
- 如果一次失败，没有自动重试机制

### 方法二：`generateObject`（推荐）

```typescript
const { object } = await generateObject({
  model: getModel(provider),
  schema: z.object({
    sentiment: z.enum(['positive', 'negative', 'neutral']),
    score: z.number().min(0).max(10),
  }),
  prompt: '分析情感："今天天气真好！"',
})
// object 有完整 TypeScript 类型推断
// object.sentiment 类型为 'positive' | 'negative' | 'neutral'
// object.score 类型为 number
```

**优势总结：**

| 维度 | `generateText` + `JSON.parse` | `generateObject` |
|------|------|------|
| 类型安全 | ❌ 需要手动定义类型 | ✅ 自动从 Zod 推断 |
| 错误处理 | ❌ 手动 try/catch + 重试 | ✅ 自动重试和校验 |
| 格式保证 | ❌ 模型可能输出非标准 JSON | ✅ 强制符合 Schema |
| 嵌套结构 | ❌ 手动处理 | ✅ 原生支持 |
| 代码量 | 较多 | 简洁 |

## 6.4 代码示例

### 示例1：情感分析

本示例对用户输入的文本进行情感分析，返回情感类别、评分和关键词。

`src/app/api/sentiment/route.ts`：

```typescript
import { generateObject } from 'ai'
import { getModel } from '@/lib/ai'
import { z } from 'zod'

const sentimentSchema = z.object({
  sentiment: z.enum(['positive', 'negative', 'neutral']),
  score: z.number().min(0).max(10).describe('情感强度，0最消极10最积极'),
  explanation: z.string().max(200).describe('情感分析的简要理由'),
  keywords: z.array(z.string()).max(5).describe('情感关键词，最多5个'),
  language: z.string().describe('检测到的文本语言代码，如 zh、en、ja'),
})

export async function POST(req: Request) {
  try {
    const { text } = await req.json()

    if (!text || typeof text !== 'string') {
      return Response.json({ error: '请提供要分析的文本' }, { status: 400 })
    }

    const { object, usage } = await generateObject({
      model: getModel(provider),
      schema: sentimentSchema,
      prompt: `请分析以下文本的情感：\n\n${text}`,
      system: '你是一个情感分析专家。请客观分析文本的情感倾向。',
    })

    return Response.json({
      data: object,
      usage: {
        promptTokens: usage.promptTokens,
        completionTokens: usage.completionTokens,
        totalTokens: usage.totalTokens,
      },
    })
  } catch (error) {
    return new Response(
      JSON.stringify({ error: '处理请求时发生错误，请稍后重试' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
}
```

`src/app/sentiment/page.tsx`：

```tsx
'use client'

import { useState } from 'react'

type SentimentResult = {
  sentiment: string
  score: number
  explanation: string
  keywords: string[]
  language: string
}

export default function SentimentPage() {
  const [text, setText] = useState('')
  const [result, setResult] = useState<SentimentResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const analyze = async () => {
    if (!text.trim()) return
    setLoading(true)
    setError('')
    setResult(null)

    try {
      const res = await fetch('/api/sentiment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      })
      const data = await res.json()
      if (data.error) {
        setError(data.error)
      } else {
        setResult(data.data)
      }
    } catch {
      setError('网络错误，请稍后重试')
    } finally {
      setLoading(false)
    }
  }

  const sentimentColor = (s: string) => {
    switch (s) {
      case 'positive': return 'text-green-600'
      case 'negative': return 'text-red-600'
      default: return 'text-gray-600'
    }
  }

  const sentimentLabel = (s: string) => {
    switch (s) {
      case 'positive': return '😊 正面'
      case 'negative': return '😟 负面'
      default: return '😐 中性'
    }
  }

  return (
    <div className="max-w-xl mx-auto p-4">
      <h1 className="text-2xl font-bold mb-2">📊 情感分析</h1>
      <p className="text-gray-500 mb-4">输入文本，AI 将分析其情感倾向</p>

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="输入要分析的文本..."
        className="w-full border rounded p-3 mb-3 h-32 resize-none"
      />

      <button
        onClick={analyze}
        disabled={loading || !text.trim()}
        className="bg-blue-500 text-white px-6 py-2 rounded hover:bg-blue-600 disabled:bg-gray-300 mb-4"
      >
        {loading ? '分析中...' : '分析情感'}
      </button>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 p-3 rounded mb-4">
          {error}
        </div>
      )}

      {result && (
        <div className="border rounded-lg p-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className={`text-lg font-bold ${sentimentColor(result.sentiment)}`}>
              {sentimentLabel(result.sentiment)}
            </span>
            <span className="text-lg">评分：{result.score}/10</span>
          </div>

          <div className="w-full bg-gray-200 rounded h-3">
            <div
              className={`h-3 rounded ${
                result.score >= 6 ? 'bg-green-500' : result.score >= 4 ? 'bg-yellow-500' : 'bg-red-500'
              }`}
              style={{ width: `${result.score * 10}%` }}
            />
          </div>

          <p className="text-gray-700">{result.explanation}</p>

          <div className="flex flex-wrap gap-2">
            {result.keywords.map((kw, i) => (
              <span key={i} className="bg-gray-100 px-2 py-1 rounded text-sm">
                {kw}
              </span>
            ))}
          </div>

          <p className="text-xs text-gray-400">检测语言：{result.language}</p>
        </div>
      )}
    </div>
  )
}
```

### 示例2：信息提取

从非结构化文本中提取结构化数据——适用于简历解析、发票识别、新闻摘要等场景。

`src/app/api/extract/route.ts`：

```typescript
import { generateObject } from 'ai'
import { getModel } from '@/lib/ai'
import { z } from 'zod'

const personSchema = z.object({
  name: z.string().describe('姓名'),
  age: z.number().int().positive().describe('年龄'),
  occupation: z.string().describe('职业'),
  email: z.string().email().nullable().describe('电子邮箱'),
  phone: z.string().nullable().describe('电话号码'),
  skills: z.array(z.string()).describe('技能列表'),
  workExperience: z.array(z.object({
    company: z.string(),
    position: z.string(),
    years: z.number().describe('工作年限'),
  })).describe('工作经历'),
  education: z.object({
    degree: z.string(),
    school: z.string(),
    graduationYear: z.number(),
  }).describe('教育背景'),
})

export async function POST(req: Request) {
  try {
    const { text } = await req.json()

    if (!text || typeof text !== 'string') {
      return Response.json({ error: '请提供要提取信息的文本' }, { status: 400 })
    }

    const { object } = await generateObject({
      model: getModel(provider),
      schema: personSchema,
      prompt: `从以下文本中提取个人信息：\n\n${text}`,
      system: '你是一个信息提取助手。从文本中提取结构化信息，如果某个字段没有找到，使用 null 或空数组。',
    })

    return Response.json({ data: object })
  } catch (error) {
    return new Response(
      JSON.stringify({ error: '处理请求时发生错误，请稍后重试' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
}
```

`src/app/extract/page.tsx`：

```tsx
'use client'

import { useState } from 'react'

type ExtractedPerson = {
  name: string
  age: number
  occupation: string
  email: string | null
  phone: string | null
  skills: string[]
  workExperience: { company: string; position: string; years: number }[]
  education: { degree: string; school: string; graduationYear: number }
}

export default function ExtractPage() {
  const [text, setText] = useState('')
  const [result, setResult] = useState<ExtractedPerson | null>(null)
  const [loading, setLoading] = useState(false)

  const sampleText = `张三，35岁，现任阿里巴巴高级前端工程师。
精通 JavaScript、TypeScript、React 和 Node.js。
2015年毕业于清华大学计算机科学专业。
曾在百度工作3年担任前端开发工程师，后在字节跳动工作4年担任高级工程师。
邮箱：zhangsan@example.com，电话：138-0000-0000。`

  const extract = async () => {
    if (!text.trim()) return
    setLoading(true)
    setResult(null)

    try {
      const res = await fetch('/api/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      })
      const data = await res.json()
      setResult(data.data)
    } catch {
      alert('提取失败')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="max-w-3xl mx-auto p-4">
      <h1 className="text-2xl font-bold mb-2">📋 信息提取</h1>
      <p className="text-gray-500 mb-4">从非结构化文本中提取结构化个人信息</p>

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="粘贴文本..."
        className="w-full border rounded p-3 mb-3 h-36 resize-none font-mono text-sm"
      />

      <div className="flex gap-2 mb-4">
        <button
          onClick={() => setText(sampleText)}
          className="text-sm text-blue-500 hover:underline"
        >
          加载示例文本
        </button>
        <button
          onClick={extract}
          disabled={loading || !text.trim()}
          className="bg-purple-500 text-white px-6 py-2 rounded hover:bg-purple-600 disabled:bg-gray-300 ml-auto"
        >
          {loading ? '提取中...' : '提取信息'}
        </button>
      </div>

      {result && (
        <div className="border rounded-lg p-4 space-y-4">
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 bg-purple-100 rounded-full flex items-center justify-center text-2xl">
              {result.name?.[0]}
            </div>
            <div>
              <h2 className="text-xl font-bold">{result.name}</h2>
              <p className="text-gray-500">{result.occupation} · {result.age}岁</p>
            </div>
          </div>

          {result.email && <p>📧 {result.email}</p>}
          {result.phone && <p>📞 {result.phone}</p>}

          <div>
            <h3 className="font-bold mb-1">技能</h3>
            <div className="flex flex-wrap gap-2">
              {result.skills.map((s, i) => (
                <span key={i} className="bg-purple-100 text-purple-700 px-2 py-1 rounded text-sm">{s}</span>
              ))}
            </div>
          </div>

          <div>
            <h3 className="font-bold mb-1">工作经历</h3>
            {result.workExperience.map((w, i) => (
              <div key={i} className="border-l-2 border-purple-300 pl-3 mb-2">
                <p className="font-medium">{w.position}</p>
                <p className="text-sm text-gray-500">{w.company} · {w.years}年</p>
              </div>
            ))}
          </div>

          <div>
            <h3 className="font-bold mb-1">教育背景</h3>
            <p>{result.education.degree} · {result.education.school} · {result.education.graduationYear}年毕业</p>
          </div>
        </div>
      )}
    </div>
  )
}
```

### 示例3：批量分类处理

同时处理多条数据并返回结果数组。适合批量审核、批量分类等场景。

`src/app/api/batch-classify/route.ts`：

```typescript
import { generateObject } from 'ai'
import { getModel } from '@/lib/ai'
import { z } from 'zod'

const reviewSchema = z.object({
  reviews: z.array(z.object({
    id: z.number(),
    originalText: z.string(),
    category: z.enum(['电子产品', '餐饮美食', '服装', '服务', '其他']).describe('商品类别'),
    rating: z.number().min(1).max(5).describe('评分 1-5'),
    isPositive: z.boolean().describe('是否为正面评价'),
    issues: z.array(z.string()).describe('提到的问题，没有则空数组'),
    suggestedAction: z.enum(['推荐', '需跟进', '忽略']).describe('建议操作'),
  })),
})

export async function POST(req: Request) {
  try {
    const { items } = await req.json()

    if (!Array.isArray(items) || items.length === 0) {
      return Response.json({ error: '请提供需要分类的项目列表' }, { status: 400 })
    }

    const { object } = await generateObject({
      model: getModel(provider),
      schema: reviewSchema,
      prompt: `请对以下用户评价进行分类和分析：\n\n${JSON.stringify(items, null, 2)}`,
      system: '你是一个评价分析助手。对每条评价进行分类、评分和分析。',
    })

    return Response.json({ data: object.reviews })
  } catch (error) {
    return new Response(
      JSON.stringify({ error: '处理请求时发生错误，请稍后重试' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
}
```

`src/app/batch-classify/page.tsx`：

```tsx
'use client'

import { useState } from 'react'

const sampleReviews = [
  { id: 1, text: '这个无线耳机音质很好，续航也很长，强烈推荐！' },
  { id: 2, text: '衣服质量一般，洗了一次就掉色了，不推荐购买。' },
  { id: 3, text: '外卖配送很慢，到了已经凉了，味道一般。' },
  { id: 4, text: '客服态度很好，退换货处理很及时，满意。' },
  { id: 5, text: '这个充电宝很便宜，但是容量虚标，用了两次就没电了。' },
]

type ClassifiedReview = {
  id: number
  originalText: string
  category: string
  rating: number
  isPositive: boolean
  issues: string[]
  suggestedAction: string
}

export default function BatchClassifyPage() {
  const [results, setResults] = useState<ClassifiedReview[] | null>(null)
  const [loading, setLoading] = useState(false)

  const classify = async () => {
    setLoading(true)
    setResults(null)

    try {
      const res = await fetch('/api/batch-classify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: sampleReviews }),
      })
      const data = await res.json()
      setResults(data.data)
    } catch {
      alert('分类失败')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="max-w-3xl mx-auto p-4">
      <h1 className="text-2xl font-bold mb-2">📑 批量分类</h1>
      <p className="text-gray-500 mb-4">AI 自动对多条评价进行分类、评分和分析</p>

      <button
        onClick={classify}
        disabled={loading}
        className="bg-teal-500 text-white px-6 py-2 rounded hover:bg-teal-600 disabled:bg-gray-300 mb-4"
      >
        {loading ? '分析中...' : '开始批量分类'}
      </button>

      {results && (
        <div className="space-y-3">
          {results.map((r) => (
            <div key={r.id} className="border rounded-lg p-4">
              <div className="flex items-start justify-between mb-2">
                <p className="text-gray-700 flex-1 mr-4">{r.originalText}</p>
                <span className={`px-2 py-1 rounded text-sm whitespace-nowrap ${
                  r.isPositive ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                }`}>
                  {r.isPositive ? '✅ 正面' : '❌ 负面'}
                </span>
              </div>
              <div className="flex flex-wrap gap-2 text-sm text-gray-500">
                <span>📂 {r.category}</span>
                <span>⭐ {'★'.repeat(r.rating)}{'☆'.repeat(5 - r.rating)}</span>
                <span className={`font-medium ${
                  r.suggestedAction === '推荐' ? 'text-green-600' :
                  r.suggestedAction === '需跟进' ? 'text-orange-600' : 'text-gray-400'
                }`}>
                  {r.suggestedAction === '推荐' ? '🏆 推荐' :
                   r.suggestedAction === '需跟进' ? '📌 需跟进' : '⏭ 忽略'}
                </span>
              </div>
              {r.issues.length > 0 && (
                <div className="mt-2 text-sm text-red-600">
                  问题：{r.issues.join('、')}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
```

### 示例4：嵌套 Schema 输出

复杂的业务场景需要嵌套的数据结构。本示例展示如何用嵌套 Zod Schema 定义多层次输出。

`src/app/api/nested-schema/route.ts`：

```typescript
import { generateObject } from 'ai'
import { getModel } from '@/lib/ai'
import { z } from 'zod'

const analysisSchema = z.object({
  summary: z.object({
    totalProducts: z.number(),
    totalRevenue: z.number().describe('总收入（元）'),
    averageRating: z.number().min(0).max(5),
    topCategory: z.string(),
  }),
  categories: z.array(z.object({
    name: z.string(),
    productCount: z.number(),
    revenue: z.number(),
    products: z.array(z.object({
      name: z.string(),
      price: z.number(),
      sales: z.number(),
      rating: z.number().min(0).max(5),
      tags: z.array(z.string()),
      inStock: z.boolean(),
    })),
  })),
  recommendations: z.array(z.object({
    type: z.enum(['restock', 'promotion', 'discontinue']),
    productName: z.string(),
    priority: z.enum(['high', 'medium', 'low']),
    reason: z.string(),
  })),
})

const sampleData = [
  { name: 'iPhone 16 Pro', category: '手机', price: 8999, sales: 120, rating: 4.8, tags: ['旗舰', '5G'], inStock: true },
  { name: 'MacBook Air M4', category: '笔记本', price: 8999, sales: 85, rating: 4.9, tags: ['轻薄', '办公'], inStock: true },
  { name: 'AirPods 4', category: '配件', price: 1299, sales: 200, rating: 4.5, tags: ['无线', '降噪'], inStock: false },
  { name: 'iPad Air', category: '平板', price: 4799, sales: 60, rating: 4.6, tags: ['教育', '娱乐'], inStock: true },
  { name: '华为 Mate 70', category: '手机', price: 6999, sales: 95, rating: 4.7, tags: ['旗舰', '鸿蒙'], inStock: true },
]

export async function POST(req: Request) {
  try {
    const { object } = await generateObject({
      model: getModel(provider),
      schema: analysisSchema,
      prompt: `分析以下产品销售数据并提供建议：\n\n${JSON.stringify(sampleData, null, 2)}`,
      system: '你是一个销售数据分析师。基于产品销售数据生成分析报告和建议。',
    })

    return Response.json({ data: object })
  } catch (error) {
    return new Response(
      JSON.stringify({ error: '处理请求时发生错误，请稍后重试' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
}
```

`src/app/nested-schema/page.tsx`：

```tsx
'use client'

import { useState } from 'react'

type AnalysisResult = {
  summary: { totalProducts: number; totalRevenue: number; averageRating: number; topCategory: string }
  categories: {
    name: string
    productCount: number
    revenue: number
    products: { name: string; price: number; sales: number; rating: number; tags: string[]; inStock: boolean }[]
  }[]
  recommendations: { type: string; productName: string; priority: string; reason: string }[]
}

export default function NestedSchemaPage() {
  const [result, setResult] = useState<AnalysisResult | null>(null)
  const [loading, setLoading] = useState(false)

  const analyze = async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/nested-schema', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
      const data = await res.json()
      setResult(data.data)
    } catch {
      alert('分析失败')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="max-w-3xl mx-auto p-4">
      <h1 className="text-2xl font-bold mb-2">📊 嵌套数据分析</h1>
      <p className="text-gray-500 mb-4">AI 分析产品销售数据并生成结构化报告</p>

      <button
        onClick={analyze}
        disabled={loading}
        className="bg-rose-500 text-white px-6 py-2 rounded hover:bg-rose-600 disabled:bg-gray-300 mb-4"
      >
        {loading ? '分析中...' : '生成分析报告'}
      </button>

      {result && (
        <div className="space-y-4">
          <div className="grid grid-cols-4 gap-3">
            <div className="bg-blue-50 border border-blue-200 rounded p-3 text-center">
              <div className="text-2xl font-bold text-blue-600">{result.summary.totalProducts}</div>
              <div className="text-sm text-gray-500">产品总数</div>
            </div>
            <div className="bg-green-50 border border-green-200 rounded p-3 text-center">
              <div className="text-2xl font-bold text-green-600">¥{result.summary.totalRevenue.toLocaleString()}</div>
              <div className="text-sm text-gray-500">总收入</div>
            </div>
            <div className="bg-purple-50 border border-purple-200 rounded p-3 text-center">
              <div className="text-2xl font-bold text-purple-600">{result.summary.averageRating}</div>
              <div className="text-sm text-gray-500">平均评分</div>
            </div>
            <div className="bg-orange-50 border border-orange-200 rounded p-3 text-center">
              <div className="text-lg font-bold text-orange-600">{result.summary.topCategory}</div>
              <div className="text-sm text-gray-500">最热品类</div>
            </div>
          </div>

          {result.categories.map((cat, i) => (
            <div key={i} className="border rounded-lg p-4">
              <div className="flex justify-between items-center mb-3">
                <h3 className="font-bold text-lg">{cat.name}</h3>
                <span className="text-sm text-gray-500">{cat.productCount}个产品 · ¥{cat.revenue.toLocaleString()}</span>
              </div>
              <div className="space-y-2">
                {cat.products.map((p, j) => (
                  <div key={j} className="flex items-center justify-between bg-gray-50 rounded p-2">
                    <div>
                      <span className="font-medium">{p.name}</span>
                      <div className="flex gap-1 text-xs text-gray-400">
                        {p.tags.map((t, k) => <span key={k}>#{t}</span>)}
                      </div>
                    </div>
                    <div className="text-right">
                      <div>¥{p.price} · 销量{p.sales}</div>
                      <div className="text-xs">
                        <span className={p.inStock ? 'text-green-600' : 'text-red-600'}>
                          {p.inStock ? '有货' : '缺货'}
                        </span>
                        {' · '}⭐ {p.rating}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}

          <div className="border rounded-lg p-4">
            <h3 className="font-bold mb-3">📌 建议操作</h3>
            <div className="space-y-2">
              {result.recommendations.map((r, i) => (
                <div key={i} className={`border-l-4 p-3 rounded ${
                  r.priority === 'high' ? 'border-l-red-500 bg-red-50' :
                  r.priority === 'medium' ? 'border-l-orange-500 bg-orange-50' :
                  'border-l-gray-400 bg-gray-50'
                }`}>
                  <div className="flex items-center gap-2">
                    <span className={`text-xs px-2 py-0.5 rounded font-medium ${
                      r.type === 'restock' ? 'bg-blue-200 text-blue-800' :
                      r.type === 'promotion' ? 'bg-green-200 text-green-800' :
                      'bg-gray-200 text-gray-800'
                    }`}>
                      {r.type === 'restock' ? '补货' : r.type === 'promotion' ? '促销' : '下架'}
                    </span>
                    <span className="font-medium">{r.productName}</span>
                    <span className={`text-xs px-1.5 py-0.5 rounded ${
                      r.priority === 'high' ? 'bg-red-200 text-red-800' :
                      r.priority === 'medium' ? 'bg-orange-200 text-orange-800' :
                      'bg-gray-200 text-gray-800'
                    }`}>{r.priority === 'high' ? '高优先级' : r.priority === 'medium' ? '中优先级' : '低优先级'}</span>
                  </div>
                  <p className="text-sm text-gray-600 mt-1">{r.reason}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
```

## 6.5 运行验证

```bash
# 安装依赖
npm install ai @ai-sdk/openai zod

# 配置环境变量
echo "OPENAI_API_KEY=sk-your-key" > .env.local

# 启动开发服务器
npm run dev

# 测试情感分析
curl -X POST http://localhost:3000/api/sentiment \
  -H "Content-Type: application/json" \
  -d '{"text":"这个产品太棒了，我非常喜欢！"}'

# 测试信息提取
curl -X POST http://localhost:3000/api/extract \
  -H "Content-Type: application/json" \
  -d '{"text":"李四，28岁，腾讯后端工程师，熟悉Go和Python，2019年毕业于华中科技大学"}'

# 测试嵌套 Schema
curl -X POST http://localhost:3000/api/nested-schema \
  -H "Content-Type: application/json" \
  -d '{}'
```

浏览器访问对应路由：
- `http://localhost:3000/sentiment`
- `http://localhost:3000/extract`
- `http://localhost:3000/batch-classify`
- `http://localhost:3000/nested-schema`

## 6.6 常见问题

### Q: `generateObject` 支持流式输出吗？

支持。使用 `streamObject` API 可以逐步获取结构化的输出对象：

```typescript
import { streamObject } from 'ai'

const { partialObjectStream } = streamObject({
  model: getModel(provider),
  schema: mySchema,
  prompt: '...',
})

for await (const partialObject of partialObjectStream) {
  console.log(partialObject) // 逐步构建的完整对象
}
```

### Q: Schema 太复杂会导致模型出错吗？

复杂的嵌套 Schema 可能会降低模型生成的准确率。建议：
- 使用 `describe()` 给每个字段添加清晰说明
- 必要时拆分为多个 `generateObject` 调用
- 使用 `mode: 'json'` 提高结构化输出的稳定性

### Q: `generateObject` 如何处理可选字段？

Zod 的 `optional()` 和 `nullable()` 都可以使用。SDK 会告诉模型哪些字段可以省略。

```typescript
z.object({
  name: z.string(),
  email: z.string().email().optional(), // 可选字段
  phone: z.string().nullable(), // 可以为 null
})
```

### Q: `generateObject` 和 `generateText` 在 Token 消耗上有什么区别？

`generateObject` 通常消耗更多 Token，因为模型需要输出结构化的 JSON 而非自由文本。但对于需要后处理（JSON.parse + 校验 + 重试）的场景，`generateObject` 实际总消耗可能更低。

### Q: 如何确保输出包含完整数组？

如果模型生成的大数组被截断，可以：
1. 增加 `maxTokens` 限制
2. 使用多个 `generateObject` 分批处理
3. 使用 `streamObject` 并实时收集结果

### Q: 可以控制输出的随机性吗？

可以，`generateObject` 支持所有 `generateText` 的参数：

```typescript
const { object } = await generateObject({
  model: getModel(provider),
  schema: mySchema,
  prompt: '...',
  temperature: 0.1, // 低温度 = 更确定性的输出
  topP: 0.9,
})
```

## 6.7 本章小结

本章全面介绍了 `generateObject` 的结构化输出能力：

- **替代 `generateText` + `JSON.parse`**：自动解析、校验、重试，提供类型安全保障
- **Zod Schema 驱动**：从简单类型到复杂嵌套结构，Schema 就是你的类型定义
- **四个实战场景**：情感分析、信息提取、批量分类、嵌套数据分析
- **`streamObject` 扩展**：支持流式获取结构化输出

结构化输出是将 AI 能力集成到业务系统中的关键桥梁。在下一章中，我们将学习 Embedding 与语义搜索，了解如何让 AI "理解"文本之间的语义关系。
