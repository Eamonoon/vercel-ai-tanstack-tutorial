# 第11章：链式编排与并行调用

## 11.1 概述

在实际 AI 应用中，很少有任务能通过一次 AI 调用完成。复杂的任务需要拆解为多个步骤，有些需要按顺序执行（链式），有些可以同时执行（并行）。Vercel AI SDK 提供了灵活的方式组合多个 AI 调用。

**为什么需要编排？**

| 场景 | 单次调用的问题 | 编排方案 |
|------|---------------|---------|
| 内容创作 | 一次生成质量低 | 提取→扩展→润色链式处理 |
| 多模型对比 | 需要手动切换 | Promise.all 并行调用 |
| 复杂分析 | Prompt 太长超出上下文 | 分解为多个子任务 |
| 混合工作流 | 部分流式、部分非流式 | 灵活组合不同 API |

**本章涵盖三种模式：**

1. **链式（Chain）**：串行管线，上一步的输出是下一步的输入
2. **并行（Parallel）**：同时执行独立任务，合并结果
3. **混合（Hybrid）**：链式中的某些步骤内部并行

## 11.2 链式模式

链式模式适合有明确依赖关系的任务管线。

### 工作原理

```
输入 → [步骤1] → 中间结果1 → [步骤2] → 中间结果2 → [步骤3] → 最终输出
```

每个步骤用上一个步骤的输出作为输入，形成处理管线。

### 适用场景

- **内容处理管线**：提取 → 分析 → 格式化
- **翻译工作流**：翻译 → 校对 → 润色
- **代码生成**：设计 → 实现 → 审查 → 优化
- **数据分析**：提取 → 汇总 → 分析 → 报告

### 链式结构模板

```typescript
async function pipeline(input: string): Promise<string> {
  const step1 = await stepOne(input)
  const step2 = await stepTwo(step1)
  const step3 = await stepThree(step2)
  return step3
}

// 每个步骤是独立的 AI 调用
async function stepOne(input: string): Promise<string> {
  const { text } = await generateText({
    model: openai('gpt-4o-mini'),
    prompt: `处理：${input}`,
  })
  return text
}
```

## 11.3 并行模式

并行模式适合无依赖关系的独立任务。

### 工作原理

```
         ┌→ [任务A] ─┐
输入 ────┤→ [任务B] ├───→ 合并结果
         └→ [任务C] ─┘
```

使用 `Promise.all` 同时执行多个 AI 调用。

### 适用场景

- **多模型对比**：同时询问多个模型
- **多语言翻译**：同时翻译成多种语言
- **多方面分析**：同时分析不同维度（情感、摘要、关键词）
- **A/B 测试**：同一输入用不同 Prompt 测试

### 并行结构模板

```typescript
async function parallel(tasks: (() => Promise<any>)[]) {
  const results = await Promise.all(tasks.map((t) => t()))
  return results
}

// 使用
const [r1, r2, r3] = await Promise.all([
  taskA(input),
  taskB(input),
  taskC(input),
])
```

### 超时控制

并行调用需要特别注意超时：

```typescript
async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error(`Timeout after ${ms}ms`)), ms)
  )
  return Promise.race([promise, timeout])
}
```

## 11.4 错误传递与超时控制

### 错误处理策略

| 策略 | 说明 | 适用场景 |
|------|------|---------|
| 快速失败 | 任何步骤失败立即终止 | 事务性操作 |
| 优雅降级 | 失败步骤跳过，返回部分结果 | 非关键任务 |
| 重试 | 失败后自动重试 | 临时性故障 |

```typescript
// 快速失败：默认行为，抛出异常
async function strictPipeline(input: string) {
  const r1 = await step1(input)
  const r2 = await step2(r1)  // 如果失败，整体失败
  return await step3(r2)
}

// 优雅降级：捕获每个步骤的错误
async function gracefulPipeline(input: string) {
  const results: string[] = []
  try { results.push(await step1(input)) } catch { results.push('[步骤1失败]') }
  try { results.push(await step2(results[0] || input)) } catch { results.push('[步骤2失败]') }
  try { results.push(await step3(results[1] || results[0] || input)) } catch { results.push('[步骤3失败]' ) }
  return results.join('\n')
}

// 重试：失败后重试
async function withRetry<T>(fn: () => Promise<T>, retries = 3): Promise<T> {
  for (let i = 0; i < retries; i++) {
    try { return await fn() } catch (e) {
      if (i === retries - 1) throw e
      await new Promise((r) => setTimeout(r, 1000 * (i + 1)))
    }
  }
  throw new Error('Unreachable')
}
```

### 超时控制

```typescript
async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Timeout: ${ms}ms exceeded`)), ms)
  })
  return Promise.race([
    promise.finally(() => clearTimeout(timer!)),
    timeoutPromise,
  ])
}

// 使用
const result = await withTimeout(
  generateText({ model: openai('gpt-4o'), prompt: '...' }),
  30000 // 30秒超时
)
```

## 11.5 代码示例

### 示例 1：链式处理管线（提取→扩展→润色）

一个 3-step 内容处理管线，展示链式模式的核心用法。

**`app/api/chain/route.ts`**

```typescript
import { generateText } from 'ai'
import { openai } from '@ai-sdk/openai'

// 步骤 1：从输入中提取关键信息
async function extractKeyPoints(text: string): Promise<string> {
  const { text: result } = await generateText({
    model: openai('gpt-4o-mini'),
    prompt: `从以下内容中提取核心要点，用 Markdown 列表返回（3-5 点）：

${text}

格式：
- 要点1：说明
- 要点2：说明`,
  })
  return result
}

// 步骤 2：将要点扩展为完整段落
async function expandToParagraphs(points: string): Promise<string> {
  const { text: result } = await generateText({
    model: openai('gpt-4o'),
    prompt: `将以下要点扩写为 2-3 段结构完整的短文，保持专业性：

${points}`,
  })
  return result
}

// 步骤 3：润色最终输出
async function finalPolish(article: string, style: string): Promise<string> {
  const { text: result } = await generateText({
    model: openai('gpt-4o'),
    prompt: `润色以下文章，风格要求：${style}。保持所有关键信息，改进表达和流畅度。

原文：
${article}

润色后：`,
  })
  return result
}

// 完整链式管线
async function contentPipeline(input: string, style = '专业简洁'): Promise<{
  keyPoints: string
  draft: string
  final: string
}> {
  const keyPoints = await extractKeyPoints(input)
  const draft = await expandToParagraphs(keyPoints)
  const final = await finalPolish(draft, style)
  return { keyPoints, draft, final }
}

export async function POST(req: Request) {
  const { text, style } = await req.json()

  if (!text) {
    return Response.json({ error: '请提供文本内容' }, { status: 400 })
  }

  const result = await contentPipeline(text, style)
  return Response.json(result)
}
```

**`app/chain/page.tsx`**

```tsx
'use client'

import { useState } from 'react'

export default function ChainPage() {
  const [input, setInput] = useState('')
  const [style, setStyle] = useState('专业简洁')
  const [result, setResult] = useState<{
    keyPoints: string
    draft: string
    final: string
  } | null>(null)
  const [loading, setLoading] = useState(false)
  const [activeTab, setActiveTab] = useState<'keyPoints' | 'draft' | 'final'>('final')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    try {
      const res = await fetch('/api/chain', {
        method: 'POST',
        body: JSON.stringify({ text: input, style }),
      })
      const data = await res.json()
      setResult(data)
      setActiveTab('final')
    } catch (err) {
      console.error(err)
    }
    setLoading(false)
  }

  const tabs = [
    { key: 'keyPoints' as const, label: '提取要点', desc: '步骤 1' },
    { key: 'draft' as const, label: '扩写草稿', desc: '步骤 2' },
    { key: 'final' as const, label: '最终润色', desc: '步骤 3' },
  ]

  return (
    <div className="max-w-4xl mx-auto p-4">
      <h1 className="text-2xl font-bold mb-2">链式内容处理管线</h1>
      <p className="text-gray-500 mb-4">
        提取要点 → 扩写草稿 → 润色输出（三步链式 AI 调用）
      </p>

      <form onSubmit={handleSubmit} className="mb-6">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="输入原始内容..."
          className="w-full border rounded px-3 py-2 mb-3 min-h-[120px]"
          disabled={loading}
        />
        <div className="flex gap-2">
          <select
            value={style}
            onChange={(e) => setStyle(e.target.value)}
            className="border rounded px-3 py-2"
            disabled={loading}
          >
            <option>专业简洁</option>
            <option>通俗易懂</option>
            <option>正式公文</option>
            <option>轻松活泼</option>
          </select>
          <button
            type="submit"
            className="bg-blue-600 text-white px-6 py-2 rounded hover:bg-blue-700"
            disabled={loading || !input.trim()}
          >
            {loading ? '管线处理中...' : '开始处理'}
          </button>
        </div>
      </form>

      {loading && (
        <div className="text-center text-gray-400 py-8">
          <p className="animate-pulse">正在执行链式管线...</p>
          <div className="flex justify-center gap-1 mt-2">
            <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" />
            <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }} />
            <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }} />
          </div>
        </div>
      )}

      {result && !loading && (
        <div>
          <div className="flex gap-1 mb-4">
            {tabs.map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`px-4 py-2 rounded-t text-sm ${
                  activeTab === tab.key
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {tab.label}
                <span className="ml-1 text-xs opacity-60">({tab.desc})</span>
              </button>
            ))}
          </div>
          <div className="bg-gray-50 rounded-b-lg rounded-tr-lg p-4 whitespace-pre-wrap leading-relaxed min-h-[200px]">
            {activeTab === 'keyPoints' && result.keyPoints}
            {activeTab === 'draft' && result.draft}
            {activeTab === 'final' && result.final}
          </div>
          <div className="mt-2 text-xs text-gray-400">
            管线流程：提取要点 → 扩写草稿 → 最终润色 | 风格：{style}
          </div>
        </div>
      )}
    </div>
  )
}
```

### 示例 2：并行多模型对比

同时调用 OpenAI GPT-4o 和 Anthropic Claude 3.5 Sonnet 对比输出。

**`app/api/parallel-models/route.ts`**

```typescript
import { generateText } from 'ai'
import { openai } from '@ai-sdk/openai'
import { anthropic } from '@ai-sdk/anthropic'

interface ModelResult {
  model: string
  text: string
  finishReason: string | null
  latency: number
  tokens: number
}

export async function POST(req: Request) {
  const { prompt } = await req.json()

  const startTime = Date.now()

  // 并行调用两个模型
  const [openaiResult, anthropicResult] = await Promise.all([
    generateText({
      model: openai('gpt-4o'),
      prompt: `回答以下问题，控制在 200 字以内：${prompt}`,
      maxTokens: 500,
    }),
    generateText({
      model: anthropic('claude-3-5-sonnet-20241022'),
      prompt: `回答以下问题，控制在 200 字以内：${prompt}`,
      maxTokens: 500,
    }),
  ])

  const totalLatency = Date.now() - startTime

  const results: ModelResult[] = [
    {
      model: 'OpenAI GPT-4o',
      text: openaiResult.text,
      finishReason: openaiResult.finishReason,
      latency: totalLatency,
      tokens: openaiResult.usage?.totalTokens ?? 0,
    },
    {
      model: 'Anthropic Claude 3.5 Sonnet',
      text: anthropicResult.text,
      finishReason: anthropicResult.finishReason,
      latency: totalLatency,
      tokens: anthropicResult.usage?.totalTokens ?? 0,
    },
  ]

  return Response.json({
    prompt,
    results,
    totalLatency,
    comparison: `两个模型描述的差异对比：\n\n` +
      `[OpenAI GPT-4o] ${openaiResult.text.slice(0, 100)}...\n\n` +
      `[Anthropic Claude] ${anthropicResult.text.slice(0, 100)}...`,
  })
}
```

**`app/parallel-models/page.tsx`**

```tsx
'use client'

import { useState } from 'react'

export default function ParallelModelsPage() {
  const [prompt, setPrompt] = useState('')
  const [data, setData] = useState<{
    results: { model: string; text: string; finishReason: string | null; latency: number; tokens: number }[]
    totalLatency: number
    comparison: string
  } | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!prompt.trim()) return
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/parallel-models', {
        method: 'POST',
        body: JSON.stringify({ prompt }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = await res.json()
      setData(json)
    } catch (err: any) {
      setError(err.message)
    }
    setLoading(false)
  }

  return (
    <div className="max-w-4xl mx-auto p-4">
      <h1 className="text-2xl font-bold mb-2">多模型并行对比</h1>
      <p className="text-gray-500 mb-4">同时调用 OpenAI 和 Anthropic，实时对比输出</p>

      <form onSubmit={handleSubmit} className="mb-6">
        <input
          type="text"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="输入一个问题或主题..."
          className="w-full border rounded px-3 py-2 mb-2"
          disabled={loading}
        />
        <button
          type="submit"
          className="bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700"
          disabled={loading || !prompt.trim()}
        >
          {loading ? '并行查询中...' : '同时对比'}
        </button>
      </form>

      {loading && (
        <div className="grid grid-cols-2 gap-4 animate-pulse">
          {[1, 2].map((i) => (
            <div key={i} className="border rounded-lg p-4">
              <div className="h-4 bg-gray-200 rounded w-1/3 mb-3" />
              <div className="h-3 bg-gray-100 rounded mb-2" />
              <div className="h-3 bg-gray-100 rounded w-5/6" />
            </div>
          ))}
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 rounded p-3 text-red-700 text-sm">
          {error} — 请确保已配置两个 API Key
        </div>
      )}

      {data && !loading && (
        <div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            {data.results.map((r) => (
              <div key={r.model} className="border rounded-lg p-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-semibold text-lg">{r.model}</h3>
                  <span className="text-xs text-gray-400">
                    {r.tokens} tokens | {r.finishReason}
                  </span>
                </div>
                <div className="text-sm whitespace-pre-wrap leading-relaxed">
                  {r.text}
                </div>
              </div>
            ))}
          </div>
          <div className="text-xs text-gray-400 text-center">
            总耗时：{data.totalLatency}ms（两个模型并行执行）
          </div>
        </div>
      )}
    </div>
  )
}
```

### 示例 3：链式 + 并行混合模式

链式管线中，某些步骤内部使用并行处理。

**`app/api/hybrid/route.ts`**

```typescript
import { generateText } from 'ai'
import { openai } from '@ai-sdk/openai'

// 步骤 1：并行提取多维度分析
async function multiAspectAnalysis(topic: string) {
  const [summary, keywords, sentiment] = await Promise.all([
    generateText({
      model: openai('gpt-4o-mini'),
      prompt: `用 1-2 句话概括以下主题的核心内容：\n${topic}`,
    }),
    generateText({
      model: openai('gpt-4o-mini'),
      prompt: `从以下内容提取 5 个关键词（逗号分隔）：\n${topic}`,
    }),
    generateText({
      model: openai('gpt-4o-mini'),
      prompt: `分析以下内容的情感倾向（正面/负面/中性），用一个词回答：\n${topic}`,
    }),
  ])

  return {
    summary: summary.text,
    keywords: keywords.text,
    sentiment: sentiment.text.trim(),
  }
}

// 步骤 2：基于分析生成报告（串行，依赖于步骤 1）
async function generateReport(analysis: {
  summary: string
  keywords: string
  sentiment: string
}): Promise<string> {
  const { text } = await generateText({
    model: openai('gpt-4o'),
    prompt: `基于以下分析生成一份简洁的报告：

摘要：${analysis.summary}
关键词：${analysis.keywords}
情感倾向：${analysis.sentiment}

报告格式：
# 分析报告
## 概述
...（基于摘要扩展）
## 关键主题
...（详解关键词）
## 情感分析
...（分析情感倾向和原因）`,
  })
  return text
}

export async function POST(req: Request) {
  const { topic } = await req.json()

  if (!topic) {
    return Response.json({ error: '请提供主题' }, { status: 400 })
  }

  // 链式：步骤 1（内部并行） → 步骤 2（串行）
  const analysis = await multiAspectAnalysis(topic)
  const report = await generateReport(analysis)

  return Response.json({
    analysis,
    report,
    pipeline: {
      step1: '并行分析（摘要 + 关键词 + 情感）',
      step2: '串行报告生成',
    },
  })
}
```

**`app/hybrid/page.tsx`**

```tsx
'use client'

import { useState } from 'react'

export default function HybridPage() {
  const [topic, setTopic] = useState('')
  const [data, setData] = useState<{
    analysis: { summary: string; keywords: string; sentiment: string }
    report: string
    pipeline: { step1: string; step2: string }
  } | null>(null)
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    const res = await fetch('/api/hybrid', {
      method: 'POST',
      body: JSON.stringify({ topic }),
    })
    const json = await res.json()
    setData(json)
    setLoading(false)
  }

  return (
    <div className="max-w-4xl mx-auto p-4">
      <h1 className="text-2xl font-bold mb-2">混合模式：链式 + 并行</h1>
      <p className="text-gray-500 mb-4">
        第一步并行分析（摘要 + 关键词 + 情感），第二步串行生成报告
      </p>

      <form onSubmit={handleSubmit} className="mb-6">
        <textarea
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          placeholder="输入一个主题或一段文本..."
          className="w-full border rounded px-3 py-2 mb-2 min-h-[80px]"
          disabled={loading}
        />
        <button
          type="submit"
          className="bg-purple-600 text-white px-4 py-2 rounded hover:bg-purple-700"
          disabled={loading || !topic.trim()}
        >
          {loading ? '混合处理中...' : '开始分析'}
        </button>
      </form>

      {data && !loading && (
        <div className="space-y-4">
          <div className="bg-purple-50 border border-purple-200 rounded p-3 text-sm text-purple-700">
            <p><strong>管线流程：</strong>{data.pipeline.step1} → {data.pipeline.step2}</p>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="bg-gray-50 rounded p-3">
              <h3 className="font-semibold text-sm mb-1">摘要</h3>
              <p className="text-sm text-gray-600">{data.analysis.summary}</p>
            </div>
            <div className="bg-gray-50 rounded p-3">
              <h3 className="font-semibold text-sm mb-1">关键词</h3>
              <p className="text-sm text-gray-600">{data.analysis.keywords}</p>
            </div>
            <div className="bg-gray-50 rounded p-3">
              <h3 className="font-semibold text-sm mb-1">情感</h3>
              <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${
                data.analysis.sentiment === '正面' ? 'bg-green-100 text-green-700' :
                data.analysis.sentiment === '负面' ? 'bg-red-100 text-red-700' :
                'bg-gray-200 text-gray-600'
              }`}>{data.analysis.sentiment}</span>
            </div>
          </div>

          <div className="bg-gray-50 rounded-lg p-4 whitespace-pre-wrap leading-relaxed">
            {data.report}
          </div>
        </div>
      )}
    </div>
  )
}
```

### 示例 4：带超时控制的调用

为每个 AI 调用设置超时，避免长时间等待。

**`app/api/timeout/route.ts`**

```typescript
import { generateText, streamText } from 'ai'
import { openai } from '@ai-sdk/openai'

// 通用超时包装器
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`请求超时（${ms}ms）`)), ms)
    ),
  ])
}

// 可配置的 AI 调用函数
async function callWithTimeout(
  prompt: string,
  options: { model?: string; maxTokens?: number; timeoutMs?: number } = {}
) {
  const { model = 'gpt-4o-mini', maxTokens = 500, timeoutMs = 10000 } = options

  const result = await withTimeout(
    generateText({
      model: openai(model),
      prompt,
      maxTokens,
    }),
    timeoutMs
  )

  return result.text
}

export async function POST(req: Request) {
  const { prompt, timeoutMs } = await req.json()

  try {
    const text = await callWithTimeout(prompt, {
      timeoutMs: timeoutMs || 8000,
    })

    return Response.json({ success: true, text })
  } catch (error: any) {
    return Response.json(
      {
        success: false,
        error: error.message,
        hint: '请简化问题，或稍后重试',
      },
      { status: 408 }
    )
  }
}
```

**`app/timeout/page.tsx`**

```tsx
'use client'

import { useState } from 'react'

export default function TimeoutPage() {
  const [prompt, setPrompt] = useState('')
  const [timeoutMs, setTimeoutMs] = useState(5000)
  const [result, setResult] = useState<{ success: boolean; text?: string; error?: string; hint?: string } | null>(null)
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setResult(null)
    const startTime = Date.now()
    try {
      const res = await fetch('/api/timeout', {
        method: 'POST',
        body: JSON.stringify({ prompt, timeoutMs }),
      })
      const json = await res.json()
      const elapsed = Date.now() - startTime
      setResult({ ...json, elapsed })
    } catch (err: any) {
      setResult({ success: false, error: err.message })
    }
    setLoading(false)
  }

  return (
    <div className="max-w-3xl mx-auto p-4">
      <h1 className="text-2xl font-bold mb-2">超时控制演示</h1>
      <p className="text-gray-500 mb-4">通过 Promise.race 实现 AI 调用的超时管理</p>

      <form onSubmit={handleSubmit} className="mb-6">
        <input
          type="text"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="输入 prompt..."
          className="w-full border rounded px-3 py-2 mb-3"
          disabled={loading}
        />
        <div className="flex items-center gap-3 mb-3">
          <label className="text-sm text-gray-600">超时时间：</label>
          <input
            type="range"
            min={1000}
            max={30000}
            step={1000}
            value={timeoutMs}
            onChange={(e) => setTimeoutMs(Number(e.target.value))}
            className="flex-1"
            disabled={loading}
          />
          <span className="text-sm font-mono w-16 text-right">
            {timeoutMs < 1000 ? timeoutMs : `${(timeoutMs / 1000).toFixed(0)}s`}
          </span>
        </div>
        <button
          type="submit"
          className="bg-orange-600 text-white px-4 py-2 rounded hover:bg-orange-700"
          disabled={loading || !prompt.trim()}
        >
          {loading ? '请求中...' : '发送请求'}
        </button>
      </form>

      {result && (
        <div className={`rounded-lg p-4 ${result.success ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'}`}>
          <div className="flex items-center gap-2 mb-2">
            <span className={`inline-block w-2 h-2 rounded-full ${result.success ? 'bg-green-500' : 'bg-red-500'}`} />
            <span className="font-medium">{result.success ? '请求成功' : '请求失败'}</span>
            {(result as any).elapsed && (
              <span className="text-xs text-gray-400">耗时：{(result as any).elapsed}ms</span>
            )}
          </div>
          {result.success ? (
            <div className="text-sm whitespace-pre-wrap">{result.text}</div>
          ) : (
            <div>
              <p className="text-sm text-red-700">{result.error}</p>
              {result.hint && <p className="text-xs text-red-500 mt-1">{result.hint}</p>}
            </div>
          )}
        </div>
      )}

      <div className="mt-6 bg-gray-50 rounded p-4 text-sm">
        <p className="font-semibold mb-2">测试建议</p>
        <ul className="list-disc list-inside text-gray-600 space-y-1">
          <li>设置短超时（2-3 秒）测试超时处理</li>
          <li>设置长超时（20-30 秒）测试正常调用</li>
          <li>尝试让 AI 生成超长内容触发超时</li>
        </ul>
      </div>
    </div>
  )
}
```

## 11.6 运行验证

### 前提条件

```bash
npm install ai @ai-sdk/openai @ai-sdk/anthropic
echo "OPENAI_API_KEY=sk-your-key" >> .env.local
echo "ANTHROPIC_API_KEY=sk-ant-your-key" >> .env.local
npm run dev
```

### 验证步骤

**步骤 1：链式管线**

访问 `/chain`，输入一段文本（如"React Server Components 让服务端渲染组件，减少客户端 JS 体积"），选择风格后点击"开始处理"。

预期：看到三个选项卡（提取要点、扩写草稿、最终润色），每一步都展示 AI 的处理结果。

**步骤 2：多模型并行对比**

访问 `/parallel-models`，输入一个主题（如"什么是 AI SDK？"）。

预期：两个模型的结果并排显示，总耗时约等于最慢的单个模型（而不是两者之和）。

**步骤 3：混合模式**

访问 `/hybrid`，输入一段文本。

预期：看到"并行分析"的三个维度结果（摘要、关键词、情感），以及最终生成的报告。

**步骤 4：超时控制**

访问 `/timeout`，输入 prompt，将超时设为 3 秒，观察超时错误。

预期：如果 AI 响应超过 3 秒，显示超时错误信息和提示。

## 11.7 常见问题

### Q1: Promise.all 比顺序执行快多少？

如果两个任务各需 2 秒：
- 顺序执行：2 + 2 = 4 秒
- 并行执行：max(2, 2) = 2 秒

理论上并行能减少到最慢任务的时间。但注意系统资源限制（API 速率限制、网络带宽）。

```typescript
// 大量并行时建议分批
async function batchParallel<T>(
  items: T[],
  fn: (item: T) => Promise<any>,
  batchSize = 5
) {
  const results = []
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize)
    const batchResults = await Promise.all(batch.map(fn))
    results.push(...batchResults)
  }
  return results
}
```

### Q2: 链式管线中某个步骤失败了怎么办？

选择合适的错误处理策略：

- **内容创作**（非关键）：优雅降级，跳过失败步骤
- **交易处理**（关键）：快速失败，回滚事务
- **批量处理**：记录错误日志，继续处理剩余步骤

```typescript
async function safeStep(fn: () => Promise<string>, fallback: string) {
  try { return await fn() } catch { return fallback }
}
```

### Q3: 超时时间应该设多少？

| 操作 | 建议超时 | 说明 |
|------|---------|------|
| GPT-4o 短文本 | 10-15 秒 | 正常响应 2-5 秒 |
| GPT-4o 长文本 | 30-60 秒 | 取决于 maxTokens |
| GPT-4o-mini | 5-10 秒 | 更快 |
| Embedding | 5 秒 | 通常很快 |
| 流式响应 | 不设超时 | 用客户端超时替代 |

### Q4: 如何监控链式管线的性能？

```typescript
async function timedStep<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const start = Date.now()
  try {
    const result = await fn()
    console.log(`[${name}] 成功，耗时 ${Date.now() - start}ms`)
    return result
  } catch (err) {
    console.error(`[${name}] 失败，耗时 ${Date.now() - start}ms`)
    throw err
  }
}
```

### Q5: 链式和并行可以嵌套吗？

可以。链式的每个步骤内部可以并行，并行的每个任务内部也可以有链式。这就是混合模式。

```typescript
// 链式中的并行
const r1 = await chainStep1(input)
const [r2a, r2b] = await Promise.all([parallelA(r1), parallelB(r1)])
const r3 = await chainStep3({ a: r2a, b: r2b })
```

## 11.8 本章小结

本章深入介绍了 AI 调用编排的三种模式：

**链式模式**：
- 串行管线，步骤间有依赖关系
- 典型应用：提取 → 扩展 → 润色
- 适合有明确处理流程的任务

**并行模式**：
- Promise.all 同时执行独立任务
- 典型应用：多模型对比、多维度分析
- 显著减少总等待时间

**混合模式**：
- 链式中的步骤内部并行执行
- 充分发挥两种模式的优点
- 适合复杂任务的高效编排

**超时控制**：
- 使用 Promise.race 实现超时
- 避免无限等待
- 合理设置超时时间

编排多个 AI 调用是构建复杂 AI 应用的必备技能。在下一章中，我们将学习自定义 Provider 的包装，添加监控、缓存和限流能力。
