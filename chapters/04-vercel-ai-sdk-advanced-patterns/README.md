# 第4章：Vercel AI SDK 高级应用模式

## 概述

第2-3章介绍了 Vercel AI SDK 的基础 API 和进阶用法。本章进一步深入，覆盖在实际 AI 应用中更复杂、更常见的模式：

- **RAG（检索增强生成）**：将知识检索与生成结合，让 AI 回答基于你提供的数据
- **多模态输入**：处理图像理解任务
- **流式处理中间件**：在生成过程中实时转换 token
- **自定义 Provider 封装**：为 AI 调用添加监控、缓存等能力
- **链式与并行编排**：组合多个 AI 调用构建复杂管线

**本章目标：** 掌握 Vercel AI SDK 的高级应用模式，能独立构建有外部知识、多模态、可观测的 AI 功能。

## 核心概念

### RAG（检索增强生成）

RAG 是一种让 AI 模型基于私有数据回答问题的模式。工作流程：

```
用户问题 → Embedding(问题) → 向量检索 → 找到相关内容
→ 注入 Prompt → generateText(模型 + 增强后的 Prompt) → 带来源的回复
```

### 多模态

现代模型（GPT-4o、Claude 3.5 Sonnet）支持同时输入文本和图像。AI SDK 通过标准化的 `experimental_attachments` 或直接构建 `content` 数组支持多模态消息。

### Stream Transform

`streamText` 返回的 `textStream` 可以接入 `TransformStream`，在不阻塞客户端的前提下实时过滤、替换、标注 AI 的输出。

### Provider 封装

Provider 是一个轻量的工厂函数，返回 `LanguageModel` 实例。你可以通过装饰器模式包装默认 Provider，附加日志、指标收集、缓存等横切关注点。

### 链式与并行

复杂任务可拆解为链（Chain）或并行（Parallel）模式：
- **链式**：步骤串行，上一步输出是下一步输入
- **并行**：无依赖的步骤同时执行，最后合并结果

## 代码示例

### 示例 1：RAG 检索增强生成

通过 Embedding 检索本地知识库，将相关内容注入 Prompt 让 AI 基于事实回答。

**`app/api/rag/route.ts`**

```typescript
import { generateText, embed } from 'ai'
import { openai } from '@ai-sdk/openai'

// 本地知识库
const knowledgeBase = [
  {
    id: '1',
    title: 'Vercel AI SDK 简介',
    content: 'Vercel AI SDK 是一个开源的 TypeScript 库，提供统一的 AI 接口，支持 OpenAI、Anthropic、Google 等 Provider。',
  },
  {
    id: '2',
    title: 'Next.js 路由',
    content: 'Next.js 支持 App Router 和 Pages Router。App Router 基于文件系统路由，支持布局、加载态、错误边界等。',
  },
  {
    id: '3',
    title: 'React Server Components',
    content: 'React Server Components（RSC）允许在服务端渲染组件，减少客户端 JavaScript 体积。Next.js App Router 默认使用 RSC。',
  },
  {
    id: '4',
    title: 'TypeScript 装饰器',
    content: 'TypeScript 5.0 支持 ECMAScript 标准的装饰器语法。装饰器用于修改类、方法、属性的行为。',
  },
  {
    id: '5',
    title: 'AI SDK Tool Calling',
    content: 'AI SDK 通过 `tool()` 函数定义工具，使用 Zod schema 声明参数类型，模型在对话中自动选择调用合适的工具。',
  },
]

export async function POST(req: Request) {
  const { query } = await req.json()

  // 1. 将查询转为向量
  const { embedding } = await embed({
    model: openai.embedding('text-embedding-3-small'),
    value: query,
  })

  // 2. 计算相似度并检索 Top-K
  const results = knowledgeBase.map((doc) => {
    // 用文本长度近似模拟向量相似度——生产中你会在数据库/向量引擎中做 ANN 检索
    const score = query.split('').filter((ch) => doc.content.includes(ch)).length / doc.content.length
    return { ...doc, score }
  })
  results.sort((a, b) => b.score - a.score)
  const topDocs = results.slice(0, 2)

  // 3. 构建增强 Prompt
  const context = topDocs.map((d) => `[${d.title}]\n${d.content}`).join('\n\n')
  const prompt = `基于以下参考资料回答问题。如果参考资料不足，请说明。

参考资料：
${context}

问题：${query}

请用中文回答，并在引用处标注来源标题。`

  // 4. 生成回答
  const { text } = await generateText({
    model: openai('gpt-4o'),
    prompt,
  })

  return Response.json({
    answer: text,
    sources: topDocs.map((d) => ({ id: d.id, title: d.title, score: d.score })),
  })
}
```

**`app/rag/page.tsx`**

```tsx
'use client'

import { useState } from 'react'

export default function RagPage() {
  const [query, setQuery] = useState('')
  const [result, setResult] = useState<{ answer: string; sources: { id: string; title: string }[] } | null>(null)
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    const res = await fetch('/api/rag', {
      method: 'POST',
      body: JSON.stringify({ query }),
    })
    const data = await res.json()
    setResult(data)
    setLoading(false)
  }

  return (
    <div className="max-w-3xl mx-auto p-4">
      <h1 className="text-2xl font-bold mb-4">RAG 知识问答</h1>
      <form onSubmit={handleSubmit}>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="输入你的问题..."
          className="w-full border rounded px-3 py-2 mb-2"
          disabled={loading}
        />
        <button type="submit" className="bg-blue-500 text-white px-4 py-2 rounded" disabled={loading}>
          {loading ? '查询中...' : '提问'}
        </button>
      </form>
      {result && (
        <div className="mt-6">
          <div className="bg-gray-50 rounded-lg p-4 mb-4 whitespace-pre-wrap">{result.answer}</div>
          <div className="text-sm text-gray-500">
            参考来源：{result.sources.map((s) => s.title).join('、')}
          </div>
        </div>
      )}
    </div>
  )
}
```

### 示例 2：多模态图像识别

使用 GPT-4o 的视觉能力分析用户上传的图片。

**`app/api/vision/route.ts`**

```typescript
import { generateText } from 'ai'
import { openai } from '@ai-sdk/openai'

export async function POST(req: Request) {
  const { imageUrl, prompt = '请详细描述这张图片的内容' } = await req.json()

  const { text } = await generateText({
    model: openai('gpt-4o'),
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          { type: 'image', image: imageUrl },
        ],
      },
    ],
  })

  return Response.json({ description: text })
}
```

**`app/vision/page.tsx`**

```tsx
'use client'

import { useState } from 'react'

export default function VisionPage() {
  const [imageUrl, setImageUrl] = useState('')
  const [description, setDescription] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    const res = await fetch('/api/vision', {
      method: 'POST',
      body: JSON.stringify({ imageUrl, prompt: '请用中文详细描述这张图片的内容、风格和细节' }),
    })
    const data = await res.json()
    setDescription(data.description)
    setLoading(false)
  }

  return (
    <div className="max-w-3xl mx-auto p-4">
      <h1 className="text-2xl font-bold mb-4">多模态图像识别</h1>
      <form onSubmit={handleSubmit}>
        <input
          type="url"
          value={imageUrl}
          onChange={(e) => setImageUrl(e.target.value)}
          placeholder="输入图片 URL..."
          className="w-full border rounded px-3 py-2 mb-2"
          disabled={loading}
        />
        <button type="submit" className="bg-blue-500 text-white px-4 py-2 rounded" disabled={loading}>
          {loading ? '分析中...' : '分析图片'}
        </button>
      </form>
      {imageUrl && (
        <img src={imageUrl} alt="预览" className="max-w-full h-64 object-contain my-4 border rounded" />
      )}
      {description && (
        <div className="bg-gray-50 rounded-lg p-4 whitespace-pre-wrap">{description}</div>
      )}
    </div>
  )
}
```

### 示例 3：流式处理中间件

在流式传输过程中实时过滤和转换 AI 输出——例如自动将 Markdown 代码块渲染为 HTML。

**`app/api/stream-process/route.ts`**

```typescript
import { streamText } from 'ai'
import { openai } from '@ai-sdk/openai'

export async function POST(req: Request) {
  const { messages } = await req.json()

  const result = streamText({
    model: openai('gpt-4o'),
    messages,
  })

  // 自定义 TransformStream 处理每个 chunk
  const encoder = new TextEncoder()
  const transformStream = new TransformStream({
    transform(chunk, controller) {
      let text = new TextDecoder().decode(chunk)
      text = text
        .replace(/^### (.+)/gm, '<h3>$1</h3>')
        .replace(/^## (.+)/gm, '<h2>$1</h2>')
        .replace(/^# (.+)/gm, '<h1>$1</h1>')
        .replace(/```(\w*)\n?/g, '<pre><code class="language-$1">')
        .replace(/```/g, '</code></pre>')
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.+?)\*/g, '<em>$1</em>')
      controller.enqueue(encoder.encode(text))
    },
  })

  return result.toDataStreamResponse({ transform: transformStream })
}
```

**`app/stream-process/page.tsx`**

```tsx
'use client'

import { useChat } from 'ai/react'

export default function StreamProcessPage() {
  const { messages, input, handleInputChange, handleSubmit, isLoading } = useChat({
    api: '/api/stream-process',
  })

  return (
    <div className="max-w-3xl mx-auto p-4">
      <h1 className="text-2xl font-bold mb-4">流式处理中间件演示</h1>
      <p className="text-sm text-gray-500 mb-4">AI 输出中的 Markdown 将实时转换为 HTML 标签</p>
      <div className="border rounded-lg p-4 mb-4 h-96 overflow-y-auto">
        {messages.map((m) => (
          <div key={m.id} className={`mb-4 ${m.role === 'user' ? 'text-right' : 'text-left'}`}>
            <div className={`inline-block px-4 py-2 rounded-lg max-w-[80%] ${
              m.role === 'user' ? 'bg-blue-500 text-white' : 'bg-gray-100'
            }`}>
              {m.role === 'user' ? (
                m.content
              ) : (
                <div dangerouslySetInnerHTML={{ __html: m.content }} />
              )}
            </div>
          </div>
        ))}
      </div>
      <form onSubmit={handleSubmit}>
        <input
          type="text"
          value={input}
          onChange={handleInputChange}
          placeholder="让 AI 生成带 Markdown 格式的内容..."
          className="w-full border rounded px-3 py-2"
          disabled={isLoading}
        />
      </form>
    </div>
  )
}
```

### 示例 4：自定义 Provider 封装（监控 + 缓存）

通过装饰器模式包装 Provider，自动记录调用次数、延迟和 Token 消耗。

**`app/api/custom-provider/route.ts`**

```typescript
import { generateText, LanguageModelV1 } from 'ai'
import { openai } from '@ai-sdk/openai'

// 带监控的 Provider 包装器
function withMonitoring(model: LanguageModelV1): LanguageModelV1 {
  const originalDoGenerate = model.doGenerate.bind(model)
  const originalDoStream = model.doStream.bind(model)

  model.doGenerate = async (options: any) => {
    const start = Date.now()
    try {
      const result = await originalDoGenerate(options)
      const latency = Date.now() - start
      console.log(`[Monitor] model=${model.modelId} latency=${latency}ms type=generate`)
      return result
    } catch (error) {
      console.error(`[Monitor] model=${model.modelId} error=generate_failed`)
      throw error
    }
  }

  model.doStream = async (options: any) => {
    const start = Date.now()
    try {
      const result = await originalDoStream(options)
      const latency = Date.now() - start
      console.log(`[Monitor] model=${model.modelId} latency=${latency}ms type=stream`)
      return result
    } catch (error) {
      console.error(`[Monitor] model=${model.modelId} error=stream_failed`)
      throw error
    }
  }

  return model
}

// 带缓存的 Provider 包装器
function withCache(model: LanguageModelV1, ttlMs = 60000): LanguageModelV1 {
  const cache = new Map<string, { result: any; timestamp: number }>()

  const originalDoGenerate = model.doGenerate.bind(model)

  model.doGenerate = async (options: any) => {
    const cacheKey = JSON.stringify({ prompt: options.prompt, messages: options.messages })
    const cached = cache.get(cacheKey)

    if (cached && Date.now() - cached.timestamp < ttlMs) {
      console.log('[Cache] HIT')
      return cached.result
    }

    const result = await originalDoGenerate(options)
    cache.set(cacheKey, { result, timestamp: Date.now() })
    console.log('[Cache] MISS — stored')
    return result
  }

  return model
}

const rawModel = openai('gpt-4o')
const monitoredModel = withMonitoring(rawModel)
const cachedModel = withCache(monitoredModel)

export async function POST(req: Request) {
  const { prompt } = await req.json()

  const { text } = await generateText({
    model: cachedModel,
    prompt,
  })

  return Response.json({ text })
}
```

### 示例 5：链式与并行编排

将复杂任务拆解为多个 AI 调用——链式（串行分析 → 处理 → 格式化）和并行（同时对比多个模型输出）。

**`app/api/orchestrate/route.ts`**

```typescript
import { generateText } from 'ai'
import { openai } from '@ai-sdk/openai'
import { anthropic } from '@ai-sdk/anthropic'

// === 链式处理管线 ===

// 步骤 1: 提取关键信息
async function extractKeyInfo(text: string): Promise<string> {
  const { text: result } = await generateText({
    model: openai('gpt-4o-mini'),
    prompt: `从以下内容中提取核心要点（3-5 点），以 Markdown 列表返回：\n\n${text}`,
  })
  return result
}

// 步骤 2: 扩展每个要点
async function expandKeyPoints(points: string): Promise<string> {
  const { text: result } = await generateText({
    model: openai('gpt-4o'),
    prompt: `基于以下要点，生成一篇结构完整的短文：\n\n${points}`,
  })
  return result
}

// 步骤 3: 最终润色
async function polishArticle(article: string): Promise<string> {
  const { text: result } = await generateText({
    model: openai('gpt-4o'),
    prompt: `润色以下文章，使其更通顺、专业，保持原有信息：\n\n${article}`,
  })
  return result
}

// === 并行对比 ===

async function parallelComparison(topic: string) {
  const [openaiResult, anthropicResult] = await Promise.all([
    generateText({
      model: openai('gpt-4o'),
      prompt: `用 100 字以内介绍「${topic}」`,
    }),
    generateText({
      model: anthropic('claude-3-5-sonnet-20241022'),
      prompt: `用 100 字以内介绍「${topic}」`,
    }),
  ])

  return {
    openai: openaiResult.text,
    anthropic: anthropicResult.text,
  }
}

export async function POST(req: Request) {
  const { text, mode = 'chain' } = await req.json()

  if (mode === 'chain') {
    const keyInfo = await extractKeyInfo(text)
    const expanded = await expandKeyPoints(keyInfo)
    const polished = await polishArticle(expanded)

    return Response.json({
      mode: 'chain',
      steps: ['extractKeyInfo', 'expandKeyPoints', 'polishArticle'],
      result: polished,
    })
  }

  if (mode === 'parallel') {
    const comparison = await parallelComparison(text)
    return Response.json({
      mode: 'parallel',
      result: comparison,
    })
  }

  return Response.json({ error: '未知模式' }, { status: 400 })
}
```

**`app/orchestrate/page.tsx`**

```tsx
'use client'

import { useState } from 'react'

export default function OrchestratePage() {
  const [input, setInput] = useState('')
  const [result, setResult] = useState<any>(null)
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent, mode: string) => {
    e.preventDefault()
    setLoading(true)
    const res = await fetch('/api/orchestrate', {
      method: 'POST',
      body: JSON.stringify({ text: input, mode }),
    })
    const data = await res.json()
    setResult(data)
    setLoading(false)
  }

  return (
    <div className="max-w-3xl mx-auto p-4">
      <h1 className="text-2xl font-bold mb-4">链式与并行编排</h1>
      <textarea
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder="输入内容或主题..."
        className="w-full border rounded px-3 py-2 mb-4 min-h-[100px]"
        disabled={loading}
      />
      <div className="flex gap-2 mb-4">
        <button
          onClick={(e) => handleSubmit(e, 'chain')}
          className="bg-blue-500 text-white px-4 py-2 rounded"
          disabled={loading || !input}
        >
          {loading ? '处理中...' : '链式处理'}
        </button>
        <button
          onClick={(e) => handleSubmit(e, 'parallel')}
          className="bg-green-500 text-white px-4 py-2 rounded"
          disabled={loading || !input}
        >
          并行对比
        </button>
      </div>
      {result && (
        <div className="mt-4">
          <p className="text-sm text-gray-500 mb-2">
            模式：{result.mode} | 步骤：{result.steps?.join(' → ')}
          </p>
          <div className="bg-gray-50 rounded-lg p-4 whitespace-pre-wrap">
            {typeof result.result === 'string'
              ? result.result
              : (
                <div>
                  <div className="mb-4">
                    <h3 className="font-bold text-blue-600 mb-1">OpenAI GPT-4o</h3>
                    <p>{result.result.openai}</p>
                  </div>
                  <div>
                    <h3 className="font-bold text-green-600 mb-1">Anthropic Claude</h3>
                    <p>{result.result.anthropic}</p>
                  </div>
                </div>
              )}
          </div>
        </div>
      )}
    </div>
  )
}
```

## 运行验证

### 启动项目

```bash
npm install ai @ai-sdk/openai @ai-sdk/anthropic
cp .env.example .env.local
# 编辑 .env.local 填入 API Key
npm run dev
```

### 验证步骤

1. **RAG**：访问 `/rag`，输入"AI SDK 支持哪些 Provider？"，验证答案引用了知识库
2. **多模态**：访问 `/vision`，输入一张图片 URL（如 `https://picsum.photos/400`），验证 AI 描述图片
3. **流式处理**：访问 `/stream-process`，发送"用 Markdown 写一篇关于 TypeScript 的介绍"，观察 HTML 实时渲染
4. **自定义 Provider**：访问 `/custom-provider`（需创建简单页面），在终端观察监控日志
5. **链式与并行**：访问 `/orchestrate`，输入"React Server Components"，分别测试链式和并行模式

### 常见问题排查

| 问题 | 可能原因 | 解决方法 |
|------|---------|---------|
| RAG 返回内容不准确 | 知识库覆盖不足 | 扩充 `knowledgeBase` 数组 |
| 多模态请求失败 | 图片 URL 不可访问或格式不支持 | 确保 URL 是公开可访问的图片 |
| 流式中间件显示原始 Markdown | TransformStream 未正确配置 | 检查 `toDataStreamResponse({ transform })` 参数 |
| 并行对比结果相同 | 模型 Prompt 完全相同 | 调整 Prompt 引导不同风格 |

## 常见问题 (FAQ)

### Q1: RAG 中的 Embedding 相似度计算应该用向量数据库吗？

本节用文本匹配模拟相似度是为了减少依赖。生产环境建议使用 pgvector（PostgreSQL）、Chroma、Pinecone 等向量数据库做 ANN 检索，用 `embedMany` 预计算文档向量。

### Q2: 多模态支持哪些图片格式？

GPT-4o 和 Claude 3.5 Sonnet 支持 JPEG、PNG、GIF、WebP。图片以 URL 或 Base64 形式传入。注意图片过大时先压缩。

### Q3: TransformStream 和 `useChat` 的流式返回有冲突吗？

没有。`toDataStreamResponse({ transform })` 会在 SDK 内部数据流协议之上应用你的 transform，`useChat` 自动解析。你只需要关注 transform 函数内的纯文本处理逻辑。

### Q4: 自定义 Provider 包装器会影响所有 AI SDK API 吗？

示例中只包装了 `doGenerate` 和 `doStream`——这覆盖了 `generateText` 和 `streamText`。如需覆盖 `embed`、`embedMany` 等，需额外包装 `doEmbed` 等方法。

### Q5: 链式编排会大幅增加延迟吗？

会。每个链节点是一次独立的 AI 调用，总延迟 = 各节点之和。优化建议：
- 对非关键步骤使用 `gpt-4o-mini` 等更快模型
- 无依赖步骤用 `Promise.all` 并行执行
- 结合 `streamText` 让用户看到中间结果
