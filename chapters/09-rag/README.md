# 第9章：RAG 检索增强生成

## 9.1 概述

RAG（Retrieval-Augmented Generation，检索增强生成）是当前 AI 应用中最核心、最实用的模式。它解决了大语言模型的一个根本局限：模型的知识截止于训练数据，无法知道训练之后的新信息，也无法访问你的私有数据。

RAG 的核心思想很简单：**在让 AI 生成回答之前，先从知识库中检索相关内容，然后将这些内容作为上下文注入 Prompt**。这样 AI 就能基于你提供的事实回答，而不是凭空猜测。

RAG 的三个步骤：

| 步骤 | 英文 | 说明 |
|------|------|------|
| **检索** | Retrieve | 根据用户问题从知识库中找到最相关的文档片段 |
| **增强** | Augment | 将检索到的文档片段注入 Prompt，作为回答依据 |
| **生成** | Generate | 大模型基于增强后的 Prompt 生成最终回答 |

**为什么 RAG 如此重要？**

- **解决幻觉问题**：让 AI 基于事实回答，大幅减少编造内容
- **知识实时更新**：只需更新知识库，无需重新训练模型
- **引用可追溯**：可以标注每个回答的来源，提升可信度
- **成本效率高**：比微调（Fine-tuning）成本低、灵活度高

**应用场景**：智能客服（基于产品文档回答）、企业内部知识库问答、法律文档分析、学术论文辅助阅读、代码库文档查询。

## 9.2 RAG 工作流程

一个完整的 RAG 系统由索引（Indexing）和查询（Query）两个阶段组成。

### 索引阶段（离线）

```
文档 → 分块(Chunking) → Embedding(向量化) → 存入向量数据库
```

1. **文档加载**：从 PDF、网页、数据库等源加载原始文档
2. **文档分块**：将长文档切分为适当大小的片段
3. **向量化**：使用 Embedding 模型将每个文本块转为向量
4. **存储**：将向量及其元数据存入向量数据库

### 查询阶段（在线）

```
用户问题 → Embedding(向量化) → 向量检索 → 找到 Top-K 相关文档
→ 注入 Prompt → LLM 生成 → 返回带来源的回答
```

1. **问题向量化**：使用相同的 Embedding 模型将用户问题转为向量
2. **向量检索**：在向量数据库中搜索与问题向量最相似的文档片段
3. **上下文增强**：将检索到的文档片段注入到 Prompt 中
4. **生成回答**：大模型基于增强后的 Prompt 生成最终回答
5. **返回来源**：可选地返回引用的文档来源

### 数据流图

```
                    ┌─────────────┐
                    │  用户问题    │
                    └──────┬──────┘
                           │
                           ▼
                    ┌─────────────┐
                    │  Embedding  │
                    └──────┬──────┘
                           │
              ┌────────────▼────────────┐
              │    向量相似度检索        │
              │  (余弦相似度 / 内积)     │
              └────────────┬────────────┘
                           │
              ┌────────────▼────────────┐
              │    Top-K 相关文档片段    │
              └────────────┬────────────┘
                           │
              ┌────────────▼────────────┐
              │  Prompt 增强 (注入上下文) │
              └────────────┬────────────┘
                           │
                    ┌──────▼──────┐
                    │  LLM 生成   │
                    └──────┬──────┘
                           │
                    ┌──────▼──────┐
                    │  带来源的回答 │
                    └─────────────┘
```

## 9.3 文档分块策略

分块（Chunking）是 RAG 系统的关键步骤。分块大小和质量直接影响检索效果。

### 分块策略对比

| 策略 | 说明 | 优点 | 缺点 |
|------|------|------|------|
| 固定大小分块 | 按固定字符/Token 数切割 | 简单、速度快 | 可能切断语义 |
| 语义分块 | 按段落、句子边界切割 | 保留语义完整 | 计算复杂 |
| 重叠分块 | 相邻块保留部分重叠 | 减少信息丢失 | 存储量增加 |

### 固定大小分块

```typescript
function fixedSizeChunk(text: string, chunkSize = 500, overlap = 50): string[] {
  const chunks: string[] = []
  let start = 0

  while (start < text.length) {
    const end = Math.min(start + chunkSize, text.length)
    chunks.push(text.slice(start, end))
    start += chunkSize - overlap
  }

  return chunks
}

// 使用
const doc = '很长很长的文档内容...'
const chunks = fixedSizeChunk(doc, 1000, 100)
```

### 语义分块

按换行、句号、段落等自然边界切割。

```typescript
function semanticChunk(text: string, maxSize = 1000): string[] {
  // 按双换行（段落）分割
  const paragraphs = text.split(/\n\s*\n/)
  const chunks: string[] = []
  let current = ''

  for (const p of paragraphs) {
    if ((current + p).length > maxSize && current.length > 0) {
      chunks.push(current.trim())
      current = p
    } else {
      current += (current ? '\n\n' : '') + p
    }
  }

  if (current.trim()) {
    chunks.push(current.trim())
  }

  return chunks
}
```

### 分块原则

- **太小**（< 50 tokens）：上下文不足，检索意义不大
- **太大**（> 1000 tokens）：可能包含无关信息，稀释相关性
- **推荐**：200-500 tokens 是比较通用的起始范围
- **根据内容类型调整**：代码文档可以稍大些（500-800 tokens），对话记录可以稍小些（100-200 tokens）

## 9.4 向量检索 vs 关键词搜索

### 关键词搜索（BM25）

传统搜索方法，基于词频和逆文档频率。

- **优点**：精确匹配专有名词、代码片段效果好
- **缺点**：无法理解语义；同义词、近义词无法匹配
- **适用**：代码搜索、精确术语匹配

### 向量检索（ANN）

基于语义相似度搜索。

- **优点**：理解语义；即使没有关键词匹配也能找到相关内容
- **缺点**：需要 Embedding 模型；冷启动需要预计算向量
- **适用**：自然语言问答、语义搜索

### 混合搜索（Hybrid Search）

结合两种方法的优点：

```typescript
async function hybridSearch(
  query: string,
  documents: { id: string; text: string }[],
  topK = 3
) {
  // 1. BM25 关键词得分
  const keywordScores = bm25Search(query, documents)

  // 2. 向量相似度得分
  const { embedding } = await embed({
    model: openai.embedding('text-embedding-3-small'),
    value: query,
  })
  const vectorScores = documents.map((doc) => ({
    id: doc.id,
    score: cosineSimilarity(embedding, docEmbeddings[doc.id]),
  }))

  // 3. 融合：加权合并
  const merged = documents.map((doc) => {
    const kw = keywordScores.find((k) => k.id === doc.id)?.score ?? 0
    const vec = vectorScores.find((v) => v.id === doc.id)?.score ?? 0
    return { id: doc.id, score: 0.3 * kw + 0.7 * vec }
  })

  merged.sort((a, b) => b.score - a.score)
  return merged.slice(0, topK)
}
```

**实践建议**：
- 大多数场景推荐混合搜索
- 代码搜索可提高关键词权重的比例
- 开放域问答可提高向量检索权重

## 9.5 代码示例

### 示例 1：内存向量 RAG（简单知识库）

使用 SDK 的 `embed` 和 `generateText` 构建最小 RAG 管线。

**`app/api/rag-basic/route.ts`**

```typescript
import { generateText, embed } from 'ai'
import { openai } from '@ai-sdk/openai'

const documents = [
  { id: '1', title: 'Next.js App Router', content: 'Next.js App Router 是基', content: 'Next.js App Router 是基于文件系统的路由方案。layout.tsx 定义布局，page.tsx 定义页面，loading.tsx 定义加载状态，error.tsx 定义错误边界。' },
  { id: '2', title: 'React Server Components', content: 'RSC 让组件在服务端渲染，减少客户端 JavaScript。默认情况下 Next.js App Router 中的所有组件都是 Server Components。' },
  { id: '3', title: 'Vercel AI SDK', content: 'Vercel AI SDK 提供统一的 AI 接口，支持 streamText、generateText、tool calling、embedding 等功能。兼容 OpenAI、Anthropic、Google 等 Provider。' },
  { id: '4', title: '流式传输', content: 'streamText 返回 textStream，通过 TransformStream 可以实时处理每个 chunk。useChat 是客户端的流式聊天 Hook。' },
  { id: '5', title: 'Tool Calling', content: 'AI 模型可以调用外部工具。用 tool() 定义工具，zod 声明参数类型。模型自动决定何时调用哪些工具。' },
]

// 预计算文档向量（离线索引）
let indexedChunks: { id: string; title: string; content: string; embedding: number[] }[] = []

async function indexDocuments() {
  for (const doc of documents) {
    const { embedding } = await embed({
      model: openai.embedding('text-embedding-3-small'),
      value: doc.content,
    })
    indexedChunks.push({ ...doc, embedding })
  }
}

// 计算余弦相似度
function cosineSimilarity(a: number[], b: number[]): number {
  const dot = a.reduce((sum, val, i) => sum + val * b[i], 0)
  const normA = Math.sqrt(a.reduce((sum, val) => sum + val * val, 0))
  const normB = Math.sqrt(b.reduce((sum, val) => sum + val * val, 0))
  return dot / (normA * normB)
}

export async function POST(req: Request) {
  const { query } = await req.json()

  if (indexedChunks.length === 0) {
    await indexDocuments()
  }

  // 1. 查询向量化
  const { embedding: queryEmbedding } = await embed({
    model: openai.embedding('text-embedding-3-small'),
    value: query,
  })

  // 2. 向量相似度检索
  const results = indexedChunks
    .map((doc) => ({
      ...doc,
      score: cosineSimilarity(queryEmbedding, doc.embedding),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 2)

  // 3. 构建增强上下文
  const context = results.map((r) => `[${r.title}]\n${r.content}`).join('\n\n')
  const prompt = `你是一个知识问答助手。请基于以下参考资料回答问题。

参考资料：
${context}

问题：${query}

要求：
- 如果参考资料足够，请基于资料回答，并在引用处标注来源标题
- 如果参考资料不足，请明确说明无法回答
- 用中文回答`

  // 4. 生成回答
  const { text } = await generateText({
    model: openai('gpt-4o'),
    prompt,
  })

  return Response.json({
    answer: text,
    sources: results.map((r) => ({ title: r.title, score: r.score.toFixed(4) })),
  })
}
```

**`app/rag-basic/page.tsx`**

```tsx
'use client'

import { useState } from 'react'

export default function RagBasicPage() {
  const [query, setQuery] = useState('')
  const [result, setResult] = useState<{ answer: string; sources: { title: string; score: string }[] } | null>(null)
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    const res = await fetch('/api/rag-basic', {
      method: 'POST',
      body: JSON.stringify({ query }),
    })
    const data = await res.json()
    setResult(data)
    setLoading(false)
  }

  return (
    <div className="max-w-3xl mx-auto p-4">
      <h1 className="text-2xl font-bold mb-2">RAG 知识问答</h1>
      <p className="text-sm text-gray-500 mb-4">基于内置知识库检索增强生成</p>
      <form onSubmit={handleSubmit}>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="问一个关于 Next.js 或 AI SDK 的问题..."
          className="w-full border rounded px-3 py-2 mb-2"
          disabled={loading}
        />
        <button
          type="submit"
          className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
          disabled={loading}
        >
          {loading ? '查询中...' : '提问'}
        </button>
      </form>
      {result && (
        <div className="mt-6">
          <div className="bg-gray-50 rounded-lg p-4 mb-3 whitespace-pre-wrap leading-relaxed">
            {result.answer}
          </div>
          <div className="text-sm text-gray-400">
            来源：{result.sources.map((s) => `${s.title}(相似度: ${s.score})`).join('、')}
          </div>
        </div>
      )}
    </div>
  )
}
```

### 示例 2：完整 RAG API Route + 前端页面

更完整的实现，支持多轮对话和动态文档管理。

**`app/api/rag-chat/route.ts`**

```typescript
import { streamText, embed } from 'ai'
import { openai } from '@ai-sdk/openai'

const KNOWLEDGE_BASE = [
  { id: 'k1', title: 'Vercel AI SDK 安装', content: '使用 npm install ai @ai-sdk/openai 安装。需设置 OPENAI_API_KEY 环境变量。' },
  { id: 'k2', title: 'streamText API', content: 'streamText 用于流式生成文本。接受 model、messages、prompt、tools、maxTokens 等参数，返回 textStream、finishReason、usage 等。' },
  { id: 'k3', title: 'generateText API', content: 'generateText 用于非流式生成文本。返回完整的 text、finishReason、usage、sources 等。适用于不需要实时输出的场景。' },
  { id: 'k4', title: 'Embedding 模型', content: 'AI SDK 支持多种 Embedding 模型：text-embedding-3-small（性价比高）、text-embedding-3-large（精度高）。使用 embed() 和 embedMany()。' },
  { id: 'k5', title: 'Tool Calling 工具调用', content: '通过 tool() 定义工具，zod 定义参数 schema。模型在生成过程中按需调用工具，支持多工具并行调用。' },
  { id: 'k6', title: 'Anthropic Provider', content: '使用 @ai-sdk/anthropic 包。设置 ANTHROPIC_API_KEY。支持 Claude 3.5 Sonnet、Claude 3 Haiku 等模型。' },
  { id: 'k7', title: '速率限制', content: '生产环境应实现速率限制。可使用 token bucket 算法，配合自定义 Provider 包装器实现。' },
  { id: 'k8', title: '流式 Chat', content: 'useChat() 是客户端 Hook，自动管理消息状态、处理流式响应。服务端用 streamText + toDataStreamResponse() 返回。' },
]

async function retrieve(query: string, topK = 3) {
  const { embedding } = await embed({
    model: openai.embedding('text-embedding-3-small'),
    value: query,
  })

  const results = KNOWLEDGE_BASE.map((doc) => {
    // 用 Embedding 后应该在向量数据库中检索
    // 这里简化：用文本重叠比例代替
    const overlap = query.toLowerCase().split(' ').filter(
      (w) => doc.content.toLowerCase().includes(w) || doc.title.toLowerCase().includes(w)
    ).length
    return { ...doc, score: overlap / Math.max(query.split(' ').length, 1) }
  })

  return results.sort((a, b) => b.score - a.score).slice(0, topK)
}

export async function POST(req: Request) {
  const { messages } = await req.json()
  const lastMessage = messages[messages.length - 1]

  // 检索相关文档
  const relevantDocs = await retrieve(lastMessage.content)

  // 构建系统 Prompt
  const context = relevantDocs.map((d) => `[${d.title}] ${d.content}`).join('\n')
  const systemPrompt = `你是一个 AI 知识库助手。回答问题时请严格基于以下参考资料。

参考资料：
${context}

回答要求：
- 引用来源时标注 [来源: 标题]
- 资料不足时说"当前知识库中没有相关信息"
- 用中文回答，简洁准确`

  const result = streamText({
    model: openai('gpt-4o-mini'),
    messages: [
      { role: 'system', content: systemPrompt },
      ...messages.slice(0, -1),
      { role: 'user', content: `${lastMessage.content}\n\n(参考来源: ${relevantDocs.map(d => d.title).join(', ')})` },
    ],
  })

  return result.toDataStreamResponse()
}
```

**`app/rag-chat/page.tsx`**

```tsx
'use client'

import { useChat } from 'ai/react'

export default function RagChatPage() {
  const { messages, input, handleInputChange, handleSubmit, isLoading, error } = useChat({
    api: '/api/rag-chat',
  })

  return (
    <div className="max-w-3xl mx-auto p-4">
      <h1 className="text-2xl font-bold mb-2">RAG 智能对话</h1>
      <p className="text-sm text-gray-500 mb-4">基于知识库检索增强的 AI 对话</p>

      <div className="border rounded-lg h-[500px] overflow-y-auto p-4 mb-4 bg-white">
        {messages.length === 0 && (
          <p className="text-gray-400 text-center mt-32">
            问一个关于 Vercel AI SDK 的问题
          </p>
        )}
        {messages.map((m) => (
          <div key={m.id} className={`mb-4 ${m.role === 'user' ? 'text-right' : 'text-left'}`}>
            <div className={`inline-block px-4 py-2 rounded-lg max-w-[80%] text-left ${
              m.role === 'user' ? 'bg-blue-500 text-white' : 'bg-gray-100 text-gray-800'
            }`}>
              <p className="text-xs opacity-60 mb-1">
                {m.role === 'user' ? '你' : 'AI 助手'}
              </p>
              <div className="whitespace-pre-wrap text-sm">{m.content}</div>
            </div>
          </div>
        ))}
        {isLoading && (
          <div className="text-center text-gray-400 text-sm">AI 正在思考...</div>
        )}
        {error && (
          <div className="text-center text-red-500 text-sm">请求出错：{error.message}</div>
        )}
      </div>

      <form onSubmit={handleSubmit}>
        <div className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={handleInputChange}
            placeholder="输入你的问题..."
            className="flex-1 border rounded px-3 py-2"
            disabled={isLoading}
          />
          <button
            type="submit"
            className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
            disabled={isLoading || !input.trim()}
          >
            发送
          </button>
        </div>
      </form>
    </div>
  )
}
```

### 示例 3：带来源引用的 RAG

在回答中明确标注引用的文档来源。

**`app/api/rag-with-sources/route.ts`**

```typescript
import { generateText, embed } from 'ai'
import { openai } from '@ai-sdk/openai'
import { z } from 'zod'

interface Document {
  id: string
  title: string
  content: string
  category: string
}

const knowledgeBase: Document[] = [
  { id: 'd1', title: '安装指南', category: '入门', content: '安装 Vercel AI SDK 需要 Node.js 18+。运行 npm install ai @ai-sdk/openai。配置 OPENAI_API_KEY 环境变量即可开始使用。' },
  { id: 'd2', title: '流式文本生成', category: '核心 API', content: 'streamText() 是最常用的 API。支持 model、system prompt、messages 等参数。返回 textStream 用于实时展示，usage 统计 token 消耗。' },
  { id: 'd3', title: '非流式文本生成', category: '核心 API', content: 'generateText() 返回完整结果。适合无需实时展示的场景。返回 text、finishReason（stop/length/tool-calls/error）、usage。' },
  { id: 'd4', title: '工具调用详解', category: '高级', content: '使用 tool() 定义工具。每个工具需指定 description 和 parameters（zod schema）。模型自动判断调用时机。支持 execute 函数。' },
  { id: 'd5', title: '消息历史管理', category: '最佳实践', content: 'AI SDK 使用 messages 数组传递对话历史。每条消息有 id、role、content。支持 system/user/assistant/tool 四种角色。' },
]

function cosineSimilarity(a: number[], b: number[]): number {
  const dot = a.reduce((sum, val, i) => sum + val * b[i], 0)
  const magA = Math.sqrt(a.reduce((sum, val) => sum + val * val, 0))
  const magB = Math.sqrt(b.reduce((sum, val) => sum + val * val, 0))
  return dot / (magA * magB)
}

export async function POST(req: Request) {
  const { query } = await req.json()

  // 1. 查询向量化
  const { embedding: queryEmb } = await embed({
    model: openai.embedding('text-embedding-3-small'),
    value: query,
  })

  // 2. 向量检索 Top-K
  const scored = await Promise.all(
    knowledgeBase.map(async (doc) => {
      const { embedding } = await embed({
        model: openai.embedding('text-embedding-3-small'),
        value: doc.content,
      })
      return { ...doc, score: cosineSimilarity(queryEmb, embedding) }
    })
  )

  const topDocs = scored.sort((a, b) => b.score - a.score).slice(0, 2)

  // 3. 构建带标记的上下文
  const taggedContext = topDocs
    .map((d) => `<source id="${d.id}" title="${d.title}" category="${d.category}">\n${d.content}\n</source>`)
    .join('\n\n')

  const prompt = `你是一个知识问答系统。回答时请基于以下参考资料。

参考资料：
${taggedContext}

问题：${query}

【重要】请按以下格式回答：
[回答内容]

引用来源：
- [来源: 标题] (分类: 类别)

如果无法从资料中找到答案，请说"当前资料库中未找到相关信息"。`

  const { text } = await generateText({
    model: openai('gpt-4o'),
    prompt,
  })

  return Response.json({
    answer: text,
    sources: topDocs.map((d) => ({
      id: d.id,
      title: d.title,
      category: d.category,
      relevance: d.score.toFixed(4),
    })),
  })
}
```

**`app/rag-with-sources/page.tsx`**

```tsx
'use client'

import { useState } from 'react'

export default function RagWithSourcesPage() {
  const [query, setQuery] = useState('')
  const [data, setData] = useState<{
    answer: string
    sources: { id: string; title: string; category: string; relevance: string }[]
  } | null>(null)
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    const res = await fetch('/api/rag-with-sources', {
      method: 'POST',
      body: JSON.stringify({ query }),
    })
    const json = await res.json()
    setData(json)
    setLoading(false)
  }

  return (
    <div className="max-w-3xl mx-auto p-4">
      <h1 className="text-2xl font-bold mb-4">带来源引用的 RAG</h1>
      <form onSubmit={handleSubmit}>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="输入问题..."
          className="w-full border rounded px-3 py-2 mb-2"
          disabled={loading}
        />
        <button type="submit" className="bg-blue-600 text-white px-4 py-2 rounded" disabled={loading}>
          {loading ? '查询中...' : '提问'}
        </button>
      </form>
      {data && (
        <div className="mt-6 space-y-4">
          <div className="bg-gray-50 rounded-lg p-4 whitespace-pre-wrap leading-relaxed">
            {data.answer}
          </div>
          <div>
            <h3 className="font-semibold text-sm text-gray-600 mb-2">引用来源</h3>
            <div className="space-y-2">
              {data.sources.map((s) => (
                <div key={s.id} className="flex items-center justify-between bg-blue-50 rounded px-3 py-2 text-sm">
                  <span className="font-medium">{s.title}</span>
                  <span className="text-gray-400">
                    <span className="bg-blue-100 text-blue-700 rounded px-2 py-0.5 text-xs mr-2">{s.category}</span>
                    相关度: {s.relevance}
                  </span>
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

### 示例 4：RAG with Streaming Response

流式返回 RAG 结果，用户在 AI 生成过程中就能看到内容逐字出现。

**`app/api/rag-stream/route.ts`**

```typescript
import { streamText, embed } from 'ai'
import { openai } from '@ai-sdk/openai'

const DOCS = [
  { id: 's1', title: 'Next.js 缓存', content: 'Next.js 提供多种缓存机制：Full Route Cache、Data Cache、Router Cache。使用 unstable_cache 缓存数据，revalidateTag 按需刷新。' },
  { id: 's2', title: 'Next.js 中间件', content: '中间件在请求完成前执行。用于重定向、重写、请求头修改、认证检查。在 middleware.ts 中定义。' },
  { id: 's3', title: 'Next.js 静态生成', content: '静态生成在构建时生成 HTML。使用 generateStaticParams 指定动态路由参数。ISR 实现增量静态再生。' },
  { id: 's4', title: 'App Router 数据获取', content: '支持在 Server Component 中直接 async/await。fetch 默认开启缓存。useEffect 用于 Client Component 的数据获取。' },
  { id: 's5', title: 'Server Actions', content: 'Server Actions 是服务端函数，可在客户端直接调用。使用 "use server" 指令。支持渐进式增强、表单验证。' },
]

async function searchRelevant(query: string) {
  const { embedding } = await embed({
    model: openai.embedding('text-embedding-3-small'),
    value: query,
  })

  const scored = DOCS.map((doc) => {
    const overlap = query.toLowerCase().split(' ').filter(w => doc.content.toLowerCase().includes(w)).length
    return { ...doc, score: overlap / query.split(' ').length }
  })

  return scored.sort((a, b) => b.score - a.score).slice(0, 3)
}

export async function POST(req: Request) {
  const { messages } = await req.json()
  const lastMsg = messages[messages.length - 1]?.content || ''

  const relevant = await searchRelevant(lastMsg)

  const context = relevant.map((d) => `[${d.title}] ${d.content}`).join('\n')

  const result = streamText({
    model: openai('gpt-4o-mini'),
    system: `你是一个 Next.js 专家助手。严格基于以下资料回答。

资料：
${context}

回答时在引用处标注 [来源: 标题]。资料不足时如实说明。用中文。`,
    messages,
  })

  return result.toDataStreamResponse()
}
```

**`app/rag-stream/page.tsx`**

```tsx
'use client'

import { useChat } from 'ai/react'

export default function RagStreamPage() {
  const { messages, input, handleInputChange, handleSubmit, isLoading, data } = useChat({
    api: '/api/rag-stream',
  })

  return (
    <div className="max-w-3xl mx-auto p-4">
      <h1 className="text-2xl font-bold mb-2">流式 RAG 问答</h1>
      <p className="text-sm text-gray-500 mb-4">边生成边展示，体验实时效果</p>

      <div className="border rounded-lg h-[450px] overflow-y-auto p-4 mb-4 bg-white">
        {messages.map((m) => (
          <div key={m.id} className={`mb-4 ${m.role === 'user' ? 'text-right' : 'text-left'}`}>
            <div className={`inline-block px-4 py-2 rounded-lg max-w-[80%] text-left ${
              m.role === 'user' ? 'bg-blue-500 text-white' : 'bg-gray-100'
            }`}>
              <p className="text-xs opacity-60 mb-1">{m.role === 'user' ? '你' : 'AI'}</p>
              <div className="whitespace-pre-wrap text-sm">{m.content}</div>
              {m.role === 'assistant' && m.parts?.some(p => p.type === 'source') && (
                <div className="mt-2 pt-2 border-t border-gray-300 text-xs text-gray-400">
                  引用：{m.parts.filter(p => p.type === 'source').map((s: any) => s.source.title).join('、')}
                </div>
              )}
            </div>
          </div>
        ))}
        {isLoading && (
          <div className="flex items-center gap-1 text-gray-400 text-sm ml-2">
            <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" />
            <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }} />
            <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }} />
          </div>
        )}
      </div>

      <form onSubmit={handleSubmit}>
        <input
          type="text"
          value={input}
          onChange={handleInputChange}
          placeholder="问一个关于 Next.js 的问题..."
          className="w-full border rounded px-3 py-2"
          disabled={isLoading}
        />
      </form>
    </div>
  )
}
```

## 9.6 生产优化

### Chunk Size 调优

```
文档类型     推荐 Chunk Size
─────────────────────────────
代码文档     500-800 tokens
技术文章     300-500 tokens
对话记录     100-200 tokens
法律文档     400-600 tokens
```

**经验法则**：
- 越小越精确，但可能丢失上下文
- 越大上下文越完整，但可能引入噪声
- 从 300 tokens 起步，根据检索效果调整

### Prompt 设计优化

```
✗ 不加上下文：
  "AI SDK 支持流式吗？" → 模型凭记忆回答

✓ RAG 增强：
  "基于以下资料回答问题：
   资料：streamText 用于流式生成...
   问题：AI SDK 支持流式吗？"
  → 基于知识库准确回答
```

要点：
- 总是说明"基于以下资料回答"
- 指导模型在信息不足时承认不知道
- 明确要求标注来源

### Re-ranking

检索到 Top-K 后，用更精确的模型对结果重新排序，提升质量。

```typescript
async function reRank(query: string, documents: Document[], topK = 2) {
  const { text } = await generateText({
    model: openai('gpt-4o-mini'),
    prompt: `给定查询和文档列表，选择最相关的 ${topK} 个文档。

查询：${query}

文档：
${documents.map((d, i) => `[${i}] ${d.title}: ${d.content}`).join('\n')}

请返回最相关文档的序号（以逗号分隔）：`,
  })

  const indices = text.split(',').map((s) => parseInt(s.trim()))
  return indices.filter((i) => !isNaN(i) && i < documents.length).map((i) => documents[i])
}
```

### 其他优化

- **缓存 Embedding**：文档 Embedding 只需计算一次，缓存起来
- **异步索引**：新文档异步建立索引，不阻塞用户请求
- **混合检索**：BM25 + 向量检索加权合并
- **上下文窗口管理**：不要超过模型的上下文限制，必要时截断

## 9.7 运行验证

### 前提条件

```bash
# 安装依赖
npm install ai @ai-sdk/openai @ai-sdk/anthropic

# 配置环境变量
echo "OPENAI_API_KEY=sk-your-key" >> .env.local

# 启动
npm run dev
```

### 验证步骤

**步骤 1：测试基础 RAG**

访问 `/rag-basic`，输入问题如"什么是 Vercel AI SDK？"。

预期：AI 基于知识库中的 `Vercel AI SDK` 文档片段回答，并显示相似度分数。

**步骤 2：测试多轮对话 RAG**

访问 `/rag-chat`，连续提问：
- "AI SDK 有哪些 API？"
- "streamText 和 generateText 有什么区别？"

预期：每次回答都基于检索到的文档，引用来源标题。

**步骤 3：测试带来源引用的 RAG**

访问 `/rag-with-sources`，输入"如何安装 AI SDK？"。

预期：答案中标注了 `[来源: 安装指南]`，底部显示引用卡片。

**步骤 4：测试流式 RAG**

访问 `/rag-stream`，输入"Next.js 的缓存机制是什么？"。

预期：回答逐字流式出现，最终标注引用来源。

### 相似度阈值

```typescript
// 在检索结果中添加阈值过滤
const filtered = results.filter((r) => r.score > 0.3) // 低于 0.3 的忽略
if (filtered.length === 0) {
  return "知识库中未找到相关信息。"
}
```

## 9.8 常见问题

### Q1: 为什么我的 RAG 检索结果不相关？

可能原因：
- **Chunk Size 不合适**：太大包含噪声，太小丢失上下文。尝试 300-500 tokens
- **Embedding 模型选择不当**：`text-embedding-3-small` 通用性好，但领域专有名词可能需要微调
- **文档质量问题**：源文档本身不清晰或术语不一致
- **查询太短**：2-3 个词的问题难以做语义匹配，建议用户提供更详细的描述

### Q2: 内存向量检索和生产环境有什么区别？

本示例用内存数组模拟向量数据库。生产环境应该：

| 功能 | 示例实现 | 生产方案 |
|------|---------|---------|
| 向量存储 | `const docs = [...]` | pgvector / Pinecone / Chroma |
| 相似度检索 | `cosineSimilarity` + sort | ANN 索引（HNSW / IVF） |
| 文档管理 | 硬编码 | 异步更新 + 版本控制 |
| 扩展性 | 单进程 | 分布式 + 多租户 |

### Q3: RAG 和微调（Fine-tuning）有什么区别？

| 维度 | RAG | 微调 |
|------|-----|------|
| 知识更新 | 即时更新知识库 | 需重新训练 |
| 幻觉控制 | 强（基于检索） | 弱（凭记忆） |
| 成本 | 低（按量付费） | 高（训练 + 托管） |
| 适用场景 | 知识问答、客服 | 风格适配、指令遵循 |
| 引用追溯 | 可以 | 不能 |

**建议**：绝大多数场景优先 RAG。只有需要模型改变行为/风格时才考虑微调。

### Q4: Embedding 模型应该用哪个？

- `text-embedding-3-small`：**首选**，性价比最高（1536 维，$0.02/1M tokens）
- `text-embedding-3-large`：精度更高，成本更高（3072 维）
- `text-embedding-ada-002`：旧版，不推荐新项目使用

### Q5: 如何处理超长文档？

1. 分块后分别 Embedding，每个块独立检索
2. 检索时取 Top-K 个块的合并内容
3. 注意总 Token 数不要超过模型上下文限制
4. 可以使用滑动窗口做重叠分块

```typescript
// 重叠分块示例
function overlappingChunks(text: string, chunkSize = 500, overlap = 100): string[] {
  const chunks: string[] = []
  let start = 0
  while (start < text.length) {
    const end = Math.min(start + chunkSize, text.length)
    chunks.push(text.slice(start, end))
    start += chunkSize - overlap
  }
  return chunks
}
```

## 9.9 本章小结

本章系统介绍了 RAG 检索增强生成模式：

- **RAG 核心流程**：检索（Retrieve）→ 增强（Augment）→ 生成（Generate）三步
- **文档分块**：固定大小分块、语义分块、重叠分块三种策略及其取舍
- **检索方法**：向量检索（语义）vs 关键词搜索（精确）vs 混合搜索（推荐）
- **代码实践**：从基础内存向量 RAG 到完整的多轮对话、带来源引用、流式响应的实现
- **生产优化**：Chunk Size 调优、Prompt 设计、Re-ranking、混合检索等

RAG 是构建可靠 AI 应用的基础。掌握 RAG 后，你可以构建出真正有用的、基于私有数据的 AI 功能。下一章我们将介绍多模态输入和流式处理中间件。
