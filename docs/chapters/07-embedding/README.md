# 第7章 Embedding 与语义搜索

## 7.1 概述

Embedding（嵌入）是将文本转换为高维向量（一组浮点数）的技术。这些向量捕获了文本的语义含义——语义相近的文本在向量空间中距离更近。

**为什么需要 Embedding？**

大语言模型擅长对话，但有几个局限：
1. **无法直接搜索文档**：模型没有内置的"记忆数据库"
2. **上下文窗口有限**：无法"阅读"整个知识库
3. **时效性**：训练数据有截止日期

Embedding 解决了这些问题：将文档转化为向量，存入向量数据库，当用户提问时，把问题也转化为向量，通过相似度搜索找到最相关的文档——这就是检索增强生成（RAG）的基础。

**本章目标：** 掌握 `embed` 和 `embedMany` API 的用法，理解余弦相似度的计算原理，能够构建基础语义搜索应用。

## 7.2 `embed` vs `embedMany` API

### `embed` — 单条文本嵌入

将一条文本转化为向量。

```typescript
import { embed } from 'ai'
import { openai } from '@ai-sdk/openai'

const { embedding } = await embed({
  model: openai.embedding('text-embedding-3-small'),
  value: '需要向量化的文本',
})

console.log(embedding) // number[]，如 [0.012, -0.034, 0.078, ...]
console.log(embedding.length) // 维度，如 1536
```

### `embedMany` — 批量文本嵌入

同时将多条文本转化为向量。内部会合并请求以提高效率。

```typescript
import { embedMany } from 'ai'

const { embeddings, embeddings: docVectors } = await embedMany({
  model: openai.embedding('text-embedding-3-small'),
  values: [
    '第一条文档',
    '第二条文档',
    '第三条文档',
  ],
})

console.log(docVectors) // number[][]，每条文本对应一个向量
console.log(embeddings.length) // 3
```

### 返回值对比

| API | 返回值 | 适用场景 |
|-----|--------|----------|
| `embed` | `{ embedding: number[] }` | 搜索请求、单条查询 |
| `embedMany` | `{ embeddings: number[][] }` | 批量文档索引、数据初始化 |

### 模型选择

| 模型 | 维度 | 特点 |
|------|------|------|
| `text-embedding-3-small` | 1536 | 性价比最高，推荐 |
| `text-embedding-3-large` | 3072 | 精度最高，适合高精度场景 |
| `text-embedding-ada-002` | 1536 | 旧版，已不推荐 |

可以通过 `dimensions` 参数降低向量维度：

```typescript
const { embedding } = await embed({
  model: openai.embedding('text-embedding-3-small'),
  value: '文本',
  dimensions: 256, // 降低到 256 维，减少存储和计算
})
```

## 7.3 余弦相似度计算

向量相似度衡量两个向量的接近程度。最常用的是**余弦相似度**。

### 数学原理

```
cosine_similarity(A, B) = (A · B) / (||A|| × ||B||)
```

其中 `A · B` 是点积，`||A||` 是向量的模（长度）。

结果范围：-1 到 1
- **1**：方向完全相同（语义一致）
- **0**：不相关（正交）
- **-1**：方向完全相反（语义相反）

对于 OpenAI 的 Embedding 模型，所有向量都经过归一化，值都在 0 到 1 之间。

### TypeScript 实现

```typescript
function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error('向量维度不一致')
  }

  let dotProduct = 0
  let magnitudeA = 0
  let magnitudeB = 0

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i]
    magnitudeA += a[i] * a[i]
    magnitudeB += b[i] * b[i]
  }

  const magnitude = Math.sqrt(magnitudeA) * Math.sqrt(magnitudeB)
  return magnitude === 0 ? 0 : dotProduct / magnitude
}
```

### 归一化优化

对向量进行 L2 归一化后，余弦相似度等价于点积，计算更快：

```typescript
function normalize(vector: number[]): number[] {
  const magnitude = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0))
  return magnitude === 0 ? vector : vector.map((v) => v / magnitude)
}

// 归一化后，点积 = 余弦相似度
const normalizedA = normalize(embeddingA)
const normalizedB = normalize(embeddingB)
const similarity = normalizedA.reduce((sum, v, i) => sum + v * normalizedB[i], 0)
```

## 7.4 向量数据库选型对比

当文档数量增多，在内存中逐条计算相似度不再可行。向量数据库提供高效的近似最近邻（ANN）搜索。

| 方案 | 部署方式 | 特点 | 适合场景 |
|------|----------|------|----------|
| **内存计算** | 无依赖 | 简单直接，适合小规模 | 原型验证，<1万条数据 |
| **pgvector** | PostgreSQL 插件 | 与关系数据库结合 | 已有 PostgreSQL，需要事务 |
| **Pinecone** | 云服务 | 全托管，零运维 | 生产级，大规模 |
| **Chroma** | 嵌入式/客户端 | 轻量级，开发友好 | 本地开发，小项目 |
| **Weaviate** | 自托管/云 | 内置 AI 插件 | 需要全文搜索+向量混合 |
| **Qdrant** | 自托管/云 | Rust 实现，高性能 | 高吞吐场景 |
| **Milvus** | 自托管 | 分布式，超大规模 | 十亿级向量 |

### 选择建议

```
原型开发 → 内存计算（本章示例）
生产环境 ≤ 10万条 → pgvector（或 Pinecone）
生产环境 > 10万条 → Pinecone / Qdrant / Milvus
本地开发 → Chroma（嵌入式，无需服务器）
```

## 7.5 代码示例

### 示例1：基础 Embedding 生成

展示 Embedding 的基础用法和向量属性。

`app/api/embed-basics/route.ts`：

```typescript
import { embed, embedMany } from 'ai'
import { openai } from '@ai-sdk/openai'

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0
  let dot = 0, magA = 0, magB = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    magA += a[i] * a[i]
    magB += b[i] * b[i]
  }
  const mag = Math.sqrt(magA) * Math.sqrt(magB)
  return mag === 0 ? 0 : dot / mag
}

export async function POST(req: Request) {
  const { text } = await req.json()

  if (!text) {
    return Response.json({ error: '请提供文本' }, { status: 400 })
  }

  const { embedding } = await embed({
    model: openai.embedding('text-embedding-3-small'),
    value: text,
  })

  const compareTexts = [
    text,
    '完全无关的话题：做饭的食谱',
    text.slice(0, 10) + '...（略作修改）',
  ]

  const { embeddings } = await embedMany({
    model: openai.embedding('text-embedding-3-small'),
    values: compareTexts,
  })

  const similarities = embeddings.map((vec, i) => ({
    text: compareTexts[i],
    similarity: cosineSimilarity(embedding, vec),
  }))

  return Response.json({
    vectorDimensions: embedding.length,
    vectorPreview: embedding.slice(0, 5),
    selfSimilarity: similarities[0].similarity.toFixed(4),
    comparisons: similarities.slice(1).map((s) => ({
      text: s.text,
      similarity: s.similarity.toFixed(4),
    })),
  })
}
```

`app/embed-basics/page.tsx`：

```tsx
'use client'

import { useState } from 'react'

type EmbedResult = {
  vectorDimensions: number
  vectorPreview: number[]
  selfSimilarity: string
  comparisons: { text: string; similarity: string }[]
}

export default function EmbedBasicsPage() {
  const [text, setText] = useState('')
  const [result, setResult] = useState<EmbedResult | null>(null)
  const [loading, setLoading] = useState(false)

  const generate = async () => {
    if (!text.trim()) return
    setLoading(true)
    setResult(null)

    try {
      const res = await fetch('/api/embed-basics', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      })
      const data = await res.json()
      setResult(data)
    } catch {
      alert('生成失败')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="max-w-xl mx-auto p-4">
      <h1 className="text-2xl font-bold mb-2">🧬 Embedding 基础</h1>
      <p className="text-gray-500 mb-4">查看文本的向量表示和相似度对比</p>

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="输入一段文本..."
        className="w-full border rounded p-3 mb-3 h-24 resize-none"
      />

      <button
        onClick={generate}
        disabled={loading || !text.trim()}
        className="bg-blue-500 text-white px-6 py-2 rounded hover:bg-blue-600 disabled:bg-gray-300 mb-4"
      >
        {loading ? '生成中...' : '生成 Embedding'}
      </button>

      {result && (
        <div className="space-y-3">
          <div className="border rounded p-3">
            <p className="text-sm text-gray-500">向量维度</p>
            <p className="font-mono">{result.vectorDimensions}</p>
          </div>
          <div className="border rounded p-3">
            <p className="text-sm text-gray-500">向量前5个值</p>
            <p className="font-mono text-xs">[{result.vectorPreview.map((v) => v.toFixed(6)).join(', ')}...]</p>
          </div>
          <div className="border rounded p-3">
            <p className="text-sm text-gray-500">与自身相似度</p>
            <p className="font-mono text-green-600">{result.selfSimilarity}</p>
          </div>
          <div className="border rounded p-3">
            <p className="text-sm text-gray-500 mb-2">对比文本相似度</p>
            {result.comparisons.map((c, i) => (
              <div key={i} className="flex justify-between text-sm py-1 border-b last:border-b-0">
                <span className="truncate mr-4">{c.text}</span>
                <span className="font-mono">{c.similarity}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
```

### 示例2：文档语义搜索

这是最核心的 Embedding 应用场景：构建一个完整的中文文档语义搜索引擎。

`app/api/semantic-search/route.ts`：

```typescript
import { embed, embedMany } from 'ai'
import { openai } from '@ai-sdk/openai'

const documentStore = [
  { id: 1, title: 'Vercel AI SDK 介绍', content: 'Vercel AI SDK 是一个开源的 TypeScript 库，提供统一的 AI 接口层，支持 OpenAI、Anthropic、Google 等多种模型提供商。开发者可以用同一套 API 操作不同的底层模型。' },
  { id: 2, title: '工具调用（Tool Calling）', content: 'Tool Calling 让大语言模型能够调用外部函数获取数据或执行操作。模型返回工具调用请求，开发者执行后把结果传回模型继续生成，实现 Agent 循环。' },
  { id: 3, title: 'Next.js 全栈框架', content: 'Next.js 是一个基于 React 的全栈框架，支持服务端渲染（SSR）、静态生成（SSG）、API 路由和中间件。它是 Vercel 团队维护的开源项目。' },
  { id: 4, title: 'TypeScript 类型系统', content: 'TypeScript 是 JavaScript 的超集，提供静态类型检查。它支持泛型、接口、联合类型、条件类型等高级特性，是大型项目的首选语言。' },
  { id: 5, title: '结构化输出 generateObject', content: 'generateObject 是 AI SDK 的 API，强制模型输出符合 Zod Schema 的结构化 JSON 数据，替代传统的 generateText + JSON.parse 模式，提供类型安全和自动校验。' },
  { id: 6, title: 'Embedding 与向量搜索', content: 'Embedding 将文本转换为高维向量，语义相近的文本向量距离更近。通过余弦相似度可以实现语义搜索，找到最相关的内容。' },
  { id: 7, title: 'AI Agent 模式', content: 'Agent 模式让模型在循环中自主决策：思考 → 选择工具 → 执行 → 观察结果 → 继续思考。AI SDK 通过 maxSteps 控制 Agent 循环的轮次。' },
  { id: 8, title: '前端 UI 组件', content: 'ai/react 提供了 useChat、useCompletion、useAssistant 等 React Hooks，让开发者可以在前端快速集成 AI 聊天界面，支持流式文本渲染。' },
]

interface SearchResult {
  id: number
  title: string
  content: string
  similarity: number
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, magA = 0, magB = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    magA += a[i] * a[i]
    magB += b[i] * b[i]
  }
  const mag = Math.sqrt(magA) * Math.sqrt(magB)
  return mag === 0 ? 0 : dot / mag
}

const model = openai.embedding('text-embedding-3-small')

let indexedEmbeddings: number[][] | null = null

async function getIndexedEmbeddings(): Promise<number[][]> {
  if (indexedEmbeddings) return indexedEmbeddings

  const { embeddings } = await embedMany({
    model,
    values: documentStore.map((d) => d.content),
  })

  indexedEmbeddings = embeddings
  return embeddings
}

export async function POST(req: Request) {
  const { query, topK = 3, threshold = 0.3 } = await req.json()

  if (!query) {
    return Response.json({ error: '请输入搜索关键词' }, { status: 400 })
  }

  const { embedding: queryEmbedding } = await embed({
    model,
    value: query,
  })

  const docEmbeddings = await getIndexedEmbeddings()

  const results: SearchResult[] = docEmbeddings
    .map((docEmb, i) => ({
      id: documentStore[i].id,
      title: documentStore[i].title,
      content: documentStore[i].content,
      similarity: cosineSimilarity(queryEmbedding, docEmb),
    }))
    .filter((r) => r.similarity >= threshold)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, topK)

  return Response.json({
    query,
    totalDocuments: documentStore.length,
    results,
  })
}
```

`app/semantic-search/page.tsx`：

```tsx
'use client'

import { useState } from 'react'

type SearchResult = {
  id: number
  title: string
  content: string
  similarity: number
}

type SearchResponse = {
  query: string
  totalDocuments: number
  results: SearchResult[]
}

export default function SemanticSearchPage() {
  const [query, setQuery] = useState('')
  const [response, setResponse] = useState<SearchResponse | null>(null)
  const [loading, setLoading] = useState(false)

  const search = async () => {
    if (!query.trim()) return
    setLoading(true)
    setResponse(null)

    try {
      const res = await fetch('/api/semantic-search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query }),
      })
      const data = await res.json()
      setResponse(data)
    } catch {
      alert('搜索失败')
    } finally {
      setLoading(false)
    }
  }

  const similarityColor = (s: number) => {
    if (s >= 0.7) return 'bg-green-500'
    if (s >= 0.5) return 'bg-yellow-500'
    return 'bg-orange-500'
  }

  return (
    <div className="max-w-2xl mx-auto p-4">
      <h1 className="text-2xl font-bold mb-2">🔍 语义搜索</h1>
      <p className="text-gray-500 mb-4">
        基于 Embedding 的中文文档语义搜索引擎。搜索"AI 模型"或"前端组件"试试。
      </p>

      <div className="flex gap-2 mb-4">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && search()}
          placeholder="输入搜索关键词..."
          className="flex-1 border rounded px-3 py-2"
        />
        <button
          onClick={search}
          disabled={loading || !query.trim()}
          className="bg-blue-500 text-white px-6 py-2 rounded hover:bg-blue-600 disabled:bg-gray-300"
        >
          {loading ? '搜索中...' : '搜索'}
        </button>
      </div>

      {response && (
        <div>
          <p className="text-sm text-gray-500 mb-3">
            共搜索 {response.totalDocuments} 篇文档，找到 {response.results.length} 条结果
          </p>

          <div className="space-y-3">
            {response.results.map((r) => (
              <div key={r.id} className="border rounded-lg p-4">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="font-bold">{r.title}</h3>
                  <div className="flex items-center gap-2">
                    <div className={`${similarityColor(r.similarity)} h-2 rounded`}
                      style={{ width: `${Math.min(r.similarity * 100, 100)}px` }} />
                    <span className="text-xs font-mono text-gray-500">
                      {(r.similarity * 100).toFixed(1)}%
                    </span>
                  </div>
                </div>
                <p className="text-sm text-gray-600">{r.content}</p>
              </div>
            ))}
          </div>

          {response.results.length === 0 && (
            <div className="text-center text-gray-400 py-8">
              未找到匹配结果，请尝试其他关键词
            </div>
          )}
        </div>
      )}

      <div className="mt-6 p-3 bg-gray-50 rounded text-sm text-gray-500">
        <p className="font-medium mb-1">💡 试试这些搜索词：</p>
        <div className="flex flex-wrap gap-2">
          {['AI 模型', '前端', '向量', '工具', 'Agent', 'TypeScript'].map((tag) => (
            <button
              key={tag}
              onClick={() => { setQuery(tag); setTimeout(search, 100) }}
              className="text-blue-500 hover:underline"
            >
              {tag}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
```

### 示例3：Embedding 缓存

重复 Embedding 相同的文本既浪费 Token 也浪费时间。本示例展示一个内存缓存方案。

`app/api/embed-with-cache/route.ts`：

```typescript
import { embed } from 'ai'
import { openai } from '@ai-sdk/openai'
import { createHash } from 'crypto'

interface CacheEntry {
  text: string
  embedding: number[]
  createdAt: number
}

class EmbeddingCache {
  private cache = new Map<string, CacheEntry>()
  private maxSize: number
  private ttlMs: number

  constructor(maxSize = 1000, ttlMs = 1000 * 60 * 60) {
    this.maxSize = maxSize
    this.ttlMs = ttlMs
  }

  private hash(text: string): string {
    return createHash('sha256').update(text).digest('hex')
  }

  get(text: string): number[] | null {
    const key = this.hash(text)
    const entry = this.cache.get(key)

    if (!entry) return null
    if (Date.now() - entry.createdAt > this.ttlMs) {
      this.cache.delete(key)
      return null
    }

    return entry.embedding
  }

  set(text: string, embedding: number[]): void {
    if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value
      if (firstKey) this.cache.delete(firstKey)
    }

    const key = this.hash(text)
    this.cache.set(key, { text, embedding, createdAt: Date.now() })
  }

  get stats() {
    return {
      size: this.cache.size,
      maxSize: this.maxSize,
      ttlMs: this.ttlMs,
    }
  }
}

const cache = new EmbeddingCache()
const model = openai.embedding('text-embedding-3-small')

export async function POST(req: Request) {
  const { text } = await req.json()

  if (!text) {
    return Response.json({ error: '请提供文本' }, { status: 400 })
  }

  const cached = cache.get(text)
  if (cached) {
    return Response.json({
      source: 'cache',
      embedding: cached,
      vectorDimensions: cached.length,
      cacheStats: cache.stats,
    })
  }

  const { embedding } = await embed({
    model,
    value: text,
  })

  cache.set(text, embedding)

  return Response.json({
    source: 'api',
    embedding,
    vectorDimensions: embedding.length,
    cacheStats: cache.stats,
  })
}
```

`app/embed-with-cache/page.tsx`：

```tsx
'use client'

import { useState } from 'react'

type EmbedResponse = {
  source: 'cache' | 'api'
  embedding: number[]
  vectorDimensions: number
  cacheStats: { size: number; maxSize: number }
}

export default function EmbedWithCachePage() {
  const [text, setText] = useState('')
  const [result, setResult] = useState<EmbedResponse | null>(null)
  const [loading, setLoading] = useState(false)

  const generate = async () => {
    if (!text.trim()) return
    setLoading(true)
    setResult(null)

    try {
      const res = await fetch('/api/embed-with-cache', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      })
      const data = await res.json()
      setResult(data)
    } catch {
      alert('失败')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="max-w-xl mx-auto p-4">
      <h1 className="text-2xl font-bold mb-2">💾 Embedding 缓存</h1>
      <p className="text-gray-500 mb-4">重复文本自动命中缓存，节省 Token 和响应时间</p>

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="输入文本..."
        className="w-full border rounded p-3 mb-3 h-24 resize-none"
      />

      <button
        onClick={generate}
        disabled={loading || !text.trim()}
        className="bg-blue-500 text-white px-6 py-2 rounded hover:bg-blue-600 disabled:bg-gray-300 mb-4"
      >
        {loading ? '处理中...' : '生成 Embedding'}
      </button>

      {result && (
        <div className="space-y-3">
          <div className={`border rounded p-3 ${result.source === 'cache' ? 'bg-green-50 border-green-200' : 'bg-blue-50 border-blue-200'}`}>
            <p className="text-sm text-gray-500">来源</p>
            <p className={`font-bold ${result.source === 'cache' ? 'text-green-600' : 'text-blue-600'}`}>
              {result.source === 'cache' ? '📦 缓存命中' : '🌐 API 调用'}
            </p>
          </div>
          <div className="border rounded p-3">
            <p className="text-sm text-gray-500">向量维度</p>
            <p className="font-mono">{result.vectorDimensions}</p>
          </div>
          <div className="border rounded p-3">
            <p className="text-sm text-gray-500">向量预览（前3个值）</p>
            <p className="font-mono text-xs">[{result.embedding.slice(0, 3).map((v: number) => v.toFixed(6)).join(', ')}...]</p>
          </div>
          <div className="border rounded p-3 text-sm text-gray-500">
            <p>缓存状态：{result.cacheStats.size} / {result.cacheStats.maxSize} 条</p>
          </div>
        </div>
      )}
    </div>
  )
}
```

### 示例4：相似度阈值过滤

在实际应用中，不是所有搜索结果都需要展示。通过设定阈值过滤低质量匹配，提升用户体验。

`app/api/threshold-search/route.ts`：

```typescript
import { embed, embedMany } from 'ai'
import { openai } from '@ai-sdk/openai'

const products = [
  { id: 'P001', name: 'MacBook Pro 14英寸', category: '笔记本', price: 14999, description: 'Apple M4 Pro 芯片，24GB 内存，512GB 存储，Liquid Retina XDR 显示屏。适合专业视频剪辑、编程和设计工作。' },
  { id: 'P002', name: 'iPhone 16 Pro', category: '手机', price: 8999, description: 'A18 Pro 芯片，4800万像素主摄，5倍光学变焦，钛金属边框。支持 AI 拍照和通话摘要功能。' },
  { id: 'P003', name: 'AirPods 4', category: '配件', price: 1299, description: '主动降噪，自适应音频，USB-C 充电盒，最长6小时续航。支持空间音频。' },
  { id: 'P004', name: 'iPad Air M4', category: '平板', price: 4799, description: 'M4 芯片，11英寸 Liquid Retina 显示屏，支持 Apple Pencil Pro。适合学习和办公。' },
  { id: 'P005', name: 'Apple Watch Ultra 3', category: '手表', price: 5999, description: '49毫米钛金属表壳，双频 GPS，100米防水，内置警笛。适合户外探险和运动。' },
  { id: 'P006', name: '戴尔 XPS 16', category: '笔记本', price: 12999, description: 'Intel Core Ultra 9 处理器，32GB 内存，1TB SSD，4K OLED 触控屏。Windows 平台旗舰笔记本。' },
]

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, magA = 0, magB = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    magA += a[i] * a[i]
    magB += b[i] * b[i]
  }
  const mag = Math.sqrt(magA) * Math.sqrt(magB)
  return mag === 0 ? 0 : dot / mag
}

const model = openai.embedding('text-embedding-3-small')

export async function POST(req: Request) {
  const { query, threshold = 0.4, topK = 5 } = await req.json()

  if (!query) {
    return Response.json({ error: '请输入搜索关键词' }, { status: 400 })
  }

  const { embedding: queryEmb } = await embed({ model, value: query })

  const { embeddings } = await embedMany({
    model,
    values: products.map((p) => `${p.name} ${p.category} ${p.description}`),
  })

  const results = products
    .map((p, i) => ({
      ...p,
      similarity: cosineSimilarity(queryEmb, embeddings[i]),
    }))
    .filter((r) => r.similarity >= threshold)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, topK)

  return Response.json({
    query,
    threshold,
    totalProducts: products.length,
    matchedCount: results.length,
    results: results.map((r) => ({
      name: r.name,
      category: r.category,
      price: r.price,
      description: r.description,
      matchScore: Number((r.similarity * 100).toFixed(1)),
    })),
  })
}
```

`app/threshold-search/page.tsx`：

```tsx
'use client'

import { useState } from 'react'

type ProductResult = {
  name: string
  category: string
  price: number
  description: string
  matchScore: number
}

type SearchResponse = {
  query: string
  threshold: number
  totalProducts: number
  matchedCount: number
  results: ProductResult[]
}

export default function ThresholdSearchPage() {
  const [query, setQuery] = useState('')
  const [threshold, setThreshold] = useState(0.4)
  const [response, setResponse] = useState<SearchResponse | null>(null)
  const [loading, setLoading] = useState(false)

  const search = async () => {
    if (!query.trim()) return
    setLoading(true)
    setResponse(null)

    try {
      const res = await fetch('/api/threshold-search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, threshold }),
      })
      const data = await res.json()
      setResponse(data)
    } catch {
      alert('搜索失败')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="max-w-2xl mx-auto p-4">
      <h1 className="text-2xl font-bold mb-2">🎯 阈值过滤搜索</h1>
      <p className="text-gray-500 mb-4">通过调整相似度阈值控制搜索结果的质量</p>

      <div className="flex gap-2 mb-2">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && search()}
          placeholder="例如：编程笔记本、运动手表..."
          className="flex-1 border rounded px-3 py-2"
        />
        <button
          onClick={search}
          disabled={loading || !query.trim()}
          className="bg-blue-500 text-white px-6 py-2 rounded hover:bg-blue-600 disabled:bg-gray-300"
        >
          {loading ? '搜索中...' : '搜索'}
        </button>
      </div>

      <div className="mb-4">
        <label className="text-sm text-gray-500">
          相似度阈值：<span className="font-bold">{threshold.toFixed(1)}</span>
        </label>
        <input
          type="range"
          min="0"
          max="0.9"
          step="0.1"
          value={threshold}
          onChange={(e) => setThreshold(parseFloat(e.target.value))}
          className="w-full"
        />
        <div className="flex justify-between text-xs text-gray-400">
          <span>宽松 (0.0)</span>
          <span>严格 (0.9)</span>
        </div>
      </div>

      {response && (
        <div>
          <p className="text-sm text-gray-500 mb-3">
            {response.totalProducts} 个商品中匹配 {response.matchedCount} 个（阈值 {response.threshold}）
          </p>

          <div className="space-y-3">
            {response.results.map((r, i) => (
              <div key={i} className="border rounded-lg p-4">
                <div className="flex items-center justify-between mb-1">
                  <div>
                    <span className="font-bold">{r.name}</span>
                    <span className="text-sm text-gray-400 ml-2">¥{r.price.toLocaleString()}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="bg-blue-100 text-blue-700 text-xs px-2 py-0.5 rounded">
                      {r.category}
                    </div>
                    <span className={`text-sm font-mono ${
                      r.matchScore >= 70 ? 'text-green-600' : r.matchScore >= 50 ? 'text-yellow-600' : 'text-gray-400'
                    }`}>
                      {r.matchScore}%
                    </span>
                  </div>
                </div>
                <p className="text-sm text-gray-500">{r.description}</p>
              </div>
            ))}
          </div>

          {response.results.length === 0 && (
            <div className="text-center text-gray-400 py-8">
              阈值 {response.threshold} 下无匹配结果，请降低阈值或换一组关键词
            </div>
          )}
        </div>
      )}
    </div>
  )
}
```

## 7.6 运行验证

```bash
# 安装依赖
npm install ai @ai-sdk/openai

# 配置环境变量
echo "OPENAI_API_KEY=sk-your-key" > .env.local

# 启动开发服务器
npm run dev

# 测试基础 Embedding
curl -X POST http://localhost:3000/api/embed-basics \
  -H "Content-Type: application/json" \
  -d '{"text":"Vercel AI SDK 支持多种 AI 模型"}'

# 测试语义搜索
curl -X POST http://localhost:3000/api/semantic-search \
  -H "Content-Type: application/json" \
  -d '{"query":"前端组件","topK":3}'

# 测试阈值过滤
curl -X POST http://localhost:3000/api/threshold-search \
  -H "Content-Type: application/json" \
  -d '{"query":"编程开发","threshold":0.5}'
```

浏览器访问：
- `http://localhost:3000/embed-basics`
- `http://localhost:3000/semantic-search`
- `http://localhost:3000/embed-with-cache`
- `http://localhost:3000/threshold-search`

## 7.7 常见问题

### Q: Embedding 的向量维度越大越好吗？

不完全是。高维度能捕获更多语义信息，但也意味着更大的存储空间和更慢的计算速度。`text-embedding-3-small` 的 1536 维在大多数场景下已经足够。可以通过 `dimensions` 参数降低到 256-512 维来优化性能。

### Q: Embedding 需要多少 Token？

每条文本消耗的 Token 数取决于文本长度。OpenAI Embedding 模型以 Token 数计费。使用 `embedMany` 批量处理比逐条调用更经济。

### Q: 如何处理超长文本？

OpenAI 的 `text-embedding-3-small` 最大输入为 8192 Token。超长文本可以：
1. 截断前 N 个 Token
2. 分块 Embedding 后取平均向量
3. 提取关键段落后再 Embedding

### Q: 每次重启服务都需要重新 Embedding 吗？

在示例中我们是内存索引，重启后确实需要重建。生产环境应使用持久化向量数据库（如 pgvector），或缓存到 Redis / 本地文件。

### Q: 余弦相似度阈值如何选择？

没有固定值，但可以参考：
- ≥ 0.8：语义高度相关（几乎同义）
- 0.6 - 0.8：语义相关
- 0.4 - 0.6：弱相关
- < 0.4：基本不相关

建议根据你的数据和业务场景调整阈值。

### Q: OpenAI 的 Embedding API 有限流吗？

有。Free 用户 3 RPM（每分钟请求数），付费用户根据 Tier 不同。使用 `embedMany` 批量处理和本地缓存可以减少 API 调用次数。

## 7.8 本章小结

本章深入介绍了 Embedding 与语义搜索：

- **`embed` 和 `embedMany` API**：单条和批量文本向量化
- **余弦相似度**：衡量文本语义距离的核心指标
- **向量数据库选型**：从内存计算到 pgvector/Pinecone 的演进路径
- **四个实战场景**：基础 Embedding、语义搜索、缓存优化、阈值过滤

Embedding 是构建 RAG、知识库问答、推荐系统的地基。从本章示例出发，结合一个持久化向量数据库，就能构建出生产级的语义搜索系统。在下一章中，我们将学习 Agent 模式与多步推理，探索如何让 AI 自主完成复杂任务。
