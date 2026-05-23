# 第12章：自定义 Provider 与可观测性

## 12.1 概述

Vercel AI SDK 的设计哲学之一是"Provider 是插件"。`openai()`、`anthropic()` 等工厂函数返回标准的 `LanguageModelV1` 实例，它们可以互换使用——这也意味着你可以**包装**它们。

为什么需要包装 Provider？

| 需求 | 说明 | 实现方式 |
|------|------|---------|
| **监控** | 记录每次调用的延迟、Token 消耗、成功率 | 包装 doGenerate / doStream |
| **缓存** | 相同请求直接返回缓存结果，减少 API 调用 | 包装 doGenerate |
| **限流** | 控制 API 调用频率，避免超出配额 | 包装 doGenerate / doStream |
| **日志** | 记录所有 AI 请求和响应 | 包装所有方法 |
| **重试** | 失败时自动重试 | 包装 doGenerate / doStream |

### 装饰器模式

本章的核心设计模式是**装饰器模式（Decorator Pattern）**：在不修改原始对象的情况下，通过包装为其添加新功能。

```
原始 Provider → [装饰器 1 (监控)] → [装饰器 2 (缓存)] → [装饰器 3 (限流)] → 使用
```

每个装饰器只关注一个横切关注点，可以自由组合。

## 12.2 LanguageModelV1 接口

`LanguageModelV1` 是 AI SDK 中所有语言模型必须实现的接口。自定义 Provider 的本质是：实现或包装这个接口。

### 核心接口

```typescript
interface LanguageModelV1 {
  readonly specificationVersion: string
  readonly provider: string
  readonly modelId: string
  readonly defaultObjectGenerationMode: 'json' | 'tool' | 'grammar'

  doGenerate(options: LanguageModelV1CallOptions): Promise<LanguageModelV1Output>
  doStream(options: LanguageModelV1CallOptions): Promise<StreamResult>

  readonly supportsUrl?: (url: URL) => boolean
}
```

### doGenerate 参数

```typescript
interface LanguageModelV1CallOptions {
  mode: 'regular' | 'object-json' | 'object-tool' | 'object-grammar'
  prompt: LanguageModelV1Prompt
  maxTokens?: number
  temperature?: number
  topP?: number
  topK?: number
  presencePenalty?: number
  frequencyPenalty?: number
  stopSequences?: string[]
  seed?: number
  maxRetries?: number
  abortSignal?: AbortSignal
  headers?: Record<string, string>
}
```

### doGenerate 返回值

```typescript
interface LanguageModelV1Output {
  text: string | null
  toolCalls: ToolCall[] | null
  finishReason: 'stop' | 'length' | 'content-filter' | 'tool-calls' | 'error' | 'other'
  usage: { promptTokens: number; completionTokens: number; totalTokens: number }
  rawCall?: { rawPrompt: unknown; rawSettings: unknown }
  warnings?: Warning[]
}
```

### doStream 返回值

```typescript
interface StreamResult {
  stream: ReadableStream<StreamPart>
  rawCall?: { rawPrompt: unknown; rawSettings: unknown }
  warnings?: Warning[]
}
```

## 12.3 装饰器模式包装 Provider

### 包装模板

```typescript
import { LanguageModelV1, LanguageModelV1CallOptions } from 'ai'

function wrapModel(model: LanguageModelV1): LanguageModelV1 {
  const originalDoGenerate = model.doGenerate.bind(model)
  const originalDoStream = model.doStream.bind(model)

  model.doGenerate = async (options: LanguageModelV1CallOptions) => {
    // 前置处理
    const result = await originalDoGenerate(options)
    // 后置处理
    return result
  }

  model.doStream = async (options: LanguageModelV1CallOptions) => {
    const result = await originalDoStream(options)
    return result
  }

  return model
}
```

### 组合多个装饰器

```typescript
const model = withRateLimiter(
  withCache(
    withMonitoring(openai('gpt-4o')),
    { ttlMs: 60000 }
  ),
  { maxRpm: 10 }
)
```

## 12.4 代码示例

### 示例 1：带监控的 Provider 包装器

记录每次调用的延迟、Token 消耗和成功率。

**`app/api/monitoring/route.ts`**

```typescript
import { generateText, LanguageModelV1, LanguageModelV1CallOptions } from 'ai'
import { openai } from '@ai-sdk/openai'

interface MonitoringRecord {
  timestamp: string
  modelId: string
  type: 'generate' | 'stream'
  latency: number
  promptTokens: number
  completionTokens: number
  totalTokens: number
  finishReason: string | null
  success: boolean
}

const monitoringStore: MonitoringRecord[] = []

function getMonitoringStats() {
  const total = monitoringStore.length
  if (total === 0) return { total: 0, avgLatency: 0, avgTokens: 0, successRate: '100%' }
  const avgLatency = monitoringStore.reduce((s, r) => s + r.latency, 0) / total
  const avgTokens = monitoringStore.reduce((s, r) => s + r.totalTokens, 0) / total
  const successCount = monitoringStore.filter((r) => r.success).length
  return {
    total,
    avgLatency: Math.round(avgLatency),
    avgTokens: Math.round(avgTokens),
    successRate: ((successCount / total) * 100).toFixed(1) + '%',
  }
}

function withMonitoring(model: LanguageModelV1): LanguageModelV1 {
  const originalDoGenerate = model.doGenerate.bind(model)
  const originalDoStream = model.doStream.bind(model)

  model.doGenerate = async (options: LanguageModelV1CallOptions) => {
    const start = Date.now()
    try {
      const result = await originalDoGenerate(options)
      const latency = Date.now() - start
      monitoringStore.push({
        timestamp: new Date().toISOString(),
        modelId: model.modelId,
        type: 'generate',
        latency,
        promptTokens: result.usage?.promptTokens ?? 0,
        completionTokens: result.usage?.completionTokens ?? 0,
        totalTokens: result.usage?.totalTokens ?? 0,
        finishReason: result.finishReason,
        success: true,
      })
      console.log(`[监控] ${model.modelId} | generate | ${latency}ms | ${result.usage?.totalTokens ?? 0}tokens`)
      return result
    } catch (error) {
      monitoringStore.push({
        timestamp: new Date().toISOString(),
        modelId: model.modelId,
        type: 'generate',
        latency: Date.now() - start,
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        finishReason: 'error',
        success: false,
      })
      throw error
    }
  }

  model.doStream = async (options: LanguageModelV1CallOptions) => {
    console.log(`[监控] ${model.modelId} | stream | start`)
    return originalDoStream(options)
  }

  return model
}

const monitoredModel = withMonitoring(openai('gpt-4o-mini'))

export async function POST(req: Request) {
  const { prompt } = await req.json()
  const { text } = await generateText({ model: monitoredModel, prompt })
  return Response.json({ text, monitoring: getMonitoringStats() })
}
```

**`app/monitoring/page.tsx`**

```tsx
'use client'

import { useState } from 'react'

export default function MonitoringPage() {
  const [prompt, setPrompt] = useState('')
  const [data, setData] = useState<{
    text: string
    monitoring: { total: number; avgLatency: number; avgTokens: number; successRate: string }
  } | null>(null)
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    const res = await fetch('/api/monitoring', {
      method: 'POST',
      body: JSON.stringify({ prompt }),
    })
    const json = await res.json()
    setData(json)
    setLoading(false)
  }

  return (
    <div className="max-w-3xl mx-auto p-4">
      <h1 className="text-2xl font-bold mb-2">AI 调用监控</h1>
      <p className="text-gray-500 mb-4">每次调用自动记录延迟、Token 消耗和成功率</p>
      <form onSubmit={handleSubmit} className="mb-6">
        <input
          type="text"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="输入问题..."
          className="w-full border rounded px-3 py-2 mb-2"
          disabled={loading}
        />
        <button
          type="submit"
          className="bg-gray-800 text-white px-4 py-2 rounded hover:bg-gray-900"
          disabled={loading || !prompt.trim()}
        >
          {loading ? '调用中...' : '发送请求'}
        </button>
      </form>
      {data && (
        <div className="space-y-4">
          <div className="bg-gray-50 rounded-lg p-4 whitespace-pre-wrap">{data.text}</div>
          <div className="border rounded-lg overflow-hidden">
            <div className="bg-gray-100 px-4 py-2 font-semibold text-sm">监控统计（当前会话）</div>
            <div className="grid grid-cols-4 gap-4 p-4">
              <div className="text-center">
                <div className="text-2xl font-bold text-blue-600">{data.monitoring.total}</div>
                <div className="text-xs text-gray-500">总调用次数</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-green-600">{data.monitoring.avgLatency}ms</div>
                <div className="text-xs text-gray-500">平均延迟</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-purple-600">{data.monitoring.avgTokens}</div>
                <div className="text-xs text-gray-500">平均 Tokens</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-emerald-600">{data.monitoring.successRate}</div>
                <div className="text-xs text-gray-500">成功率</div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
```

### 示例 2：带缓存的 Provider 包装器

相同请求在 TTL 内直接返回缓存结果。

**`app/api/cached/route.ts`**

```typescript
import { generateText, LanguageModelV1, LanguageModelV1CallOptions } from 'ai'
import { openai } from '@ai-sdk/openai'

function withCache(model: LanguageModelV1, ttlMs = 60000): LanguageModelV1 {
  const cache = new Map<string, { result: any; timestamp: number }>()
  const originalDoGenerate = model.doGenerate.bind(model)

  model.doGenerate = async (options: LanguageModelV1CallOptions) => {
    const cacheKey = JSON.stringify({
      prompt: options.prompt,
      mode: options.mode,
      maxTokens: options.maxTokens,
      temperature: options.temperature,
    })

    const cached = cache.get(cacheKey)
    if (cached && Date.now() - cached.timestamp < ttlMs) {
      console.log('[缓存] HIT')
      return cached.result
    }

    const result = await originalDoGenerate(options)
    cache.set(cacheKey, { result, timestamp: Date.now() })
    console.log('[缓存] MISS — 已缓存')
    return result
  }

  return model
}

const cachedModel = withCache(openai('gpt-4o-mini'), 30000)

export async function POST(req: Request) {
  const { prompt } = await req.json()
  const { text } = await generateText({ model: cachedModel, prompt })
  return Response.json({ text })
}
```

**`app/cached/page.tsx`**

```tsx
'use client'

import { useState } from 'react'

export default function CachedPage() {
  const [prompt, setPrompt] = useState('')
  const [responses, setResponses] = useState<{ text: string; latency: number }[]>([])
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    const start = Date.now()
    const res = await fetch('/api/cached', {
      method: 'POST',
      body: JSON.stringify({ prompt }),
    })
    const json = await res.json()
    setResponses((prev) => [{ text: json.text, latency: Date.now() - start }, ...prev].slice(0, 10))
    setLoading(false)
  }

  return (
    <div className="max-w-3xl mx-auto p-4">
      <h1 className="text-2xl font-bold mb-2">带缓存的 Provider</h1>
      <p className="text-gray-500 mb-4">相同 Prompt 在 30 秒内重复请求走缓存</p>
      <form onSubmit={handleSubmit} className="mb-6">
        <input
          type="text"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="输入问题..."
          className="w-full border rounded px-3 py-2 mb-2"
          disabled={loading}
        />
        <button
          type="submit"
          className="bg-teal-600 text-white px-4 py-2 rounded hover:bg-teal-700"
          disabled={loading || !prompt.trim()}
        >
          {loading ? '请求中...' : '发送'}
        </button>
      </form>
      {responses.length > 0 && (
        <div className="space-y-2">
          {responses.map((r, i) => (
            <div key={i} className="flex items-start gap-3 bg-white border rounded p-3">
              <div className="flex-shrink-0 w-16 text-center">
                <div className={`text-lg font-bold ${i > 0 && r.latency < 100 ? 'text-green-600' : 'text-gray-600'}`}>
                  {r.latency}ms
                </div>
              </div>
              <div className="text-sm whitespace-pre-wrap text-gray-700 flex-1">{r.text}</div>
            </div>
          ))}
          {responses.length >= 2 && (
            <p className="text-green-600 text-sm text-center">
              缓存命中时延迟从 {responses[1].latency}ms 降至 {responses[0].latency}ms
            </p>
          )}
        </div>
      )}
    </div>
  )
}
```

### 示例 3：限流 Provider（Token Bucket）

使用令牌桶算法控制 API 调用频率。

**`app/api/rate-limited/route.ts`**

```typescript
import { generateText, LanguageModelV1, LanguageModelV1CallOptions } from 'ai'
import { openai } from '@ai-sdk/openai'

class TokenBucket {
  private tokens: number
  private lastRefill: number

  constructor(
    private maxTokens: number,
    private refillRate: number,
    private refillIntervalMs = 1000
  ) {
    this.tokens = maxTokens
    this.lastRefill = Date.now()
  }

  tryConsume(count = 1): boolean {
    this.refill()
    if (this.tokens >= count) {
      this.tokens -= count
      return true
    }
    return false
  }

  private refill() {
    const now = Date.now()
    const elapsed = now - this.lastRefill
    const refillTokens = Math.floor((elapsed / this.refillIntervalMs) * this.refillRate)
    if (refillTokens > 0) {
      this.tokens = Math.min(this.maxTokens, this.tokens + refillTokens)
      this.lastRefill = now
    }
  }
}

function withRateLimiter(model: LanguageModelV1, maxRpm = 60): LanguageModelV1 {
  const bucket = new TokenBucket(maxRpm, maxRpm / 60)
  const originalDoGenerate = model.doGenerate.bind(model)
  const originalDoStream = model.doStream.bind(model)

  model.doGenerate = async (options: LanguageModelV1CallOptions) => {
    if (!bucket.tryConsume(1)) {
      throw new Error(`限流：每分钟最多 ${maxRpm} 次`)
    }
    return originalDoGenerate(options)
  }

  model.doStream = async (options: LanguageModelV1CallOptions) => {
    if (!bucket.tryConsume(1)) {
      throw new Error(`限流：每分钟最多 ${maxRpm} 次`)
    }
    return originalDoStream(options)
  }

  return model
}

const rateLimitedModel = withRateLimiter(openai('gpt-4o-mini'), 10)

export async function POST(req: Request) {
  const { prompt } = await req.json()
  try {
    const { text } = await generateText({ model: rateLimitedModel, prompt })
    return Response.json({ success: true, text })
  } catch (error: any) {
    return Response.json({ success: false, error: error.message }, { status: 429 })
  }
}
```

**`app/rate-limited/page.tsx`**

```tsx
'use client'

import { useState } from 'react'

export default function RateLimitedPage() {
  const [prompt, setPrompt] = useState('')
  const [logs, setLogs] = useState<{ text: string; success: boolean }[]>([])
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    const res = await fetch('/api/rate-limited', {
      method: 'POST',
      body: JSON.stringify({ prompt }),
    })
    const json = await res.json()
    setLogs((prev) => [{ text: json.success ? json.text : `被限流：${json.error}`, success: json.success }, ...prev].slice(0, 20))
    setLoading(false)
  }

  const rapidFire = async () => {
    for (let i = 0; i < 15; i++) {
      const res = await fetch('/api/rate-limited', {
        method: 'POST',
        body: JSON.stringify({ prompt: `快速测试 #${i + 1}` }),
      })
      const json = await res.json()
      setLogs((prev) => [{ text: `[#${i + 1}] ${json.success ? '成功' : json.error}`, success: json.success }, ...prev].slice(0, 20))
    }
  }

  return (
    <div className="max-w-3xl mx-auto p-4">
      <h1 className="text-2xl font-bold mb-2">限流 Provider</h1>
      <p className="text-gray-500 mb-4">Token Bucket 算法控制请求频率（10 RPM）</p>
      <form onSubmit={handleSubmit} className="mb-4">
        <div className="flex gap-2">
          <input
            type="text"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="输入 prompt..."
            className="flex-1 border rounded px-3 py-2"
            disabled={loading}
          />
          <button type="submit" className="bg-red-600 text-white px-4 py-2 rounded" disabled={loading || !prompt.trim()}>
            发送
          </button>
          <button type="button" onClick={rapidFire} className="bg-orange-500 text-white px-4 py-2 rounded" disabled={loading}>
            快速连发
          </button>
        </div>
      </form>
      <div className="border rounded-lg max-h-80 overflow-y-auto bg-gray-50">
        {logs.map((log, i) => (
          <div key={i} className={`flex items-center gap-2 px-3 py-2 text-sm border-b border-gray-100 ${log.success ? 'text-gray-700' : 'text-red-600'}`}>
            <span className={`w-2 h-2 rounded-full flex-shrink-0 ${log.success ? 'bg-green-500' : 'bg-red-500'}`} />
            <span className="truncate">{log.text}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
```

### 示例 4：组合多个包装器

监控 + 缓存 + 限流 三个装饰器组合使用。

**`app/api/composite/route.ts`**

```typescript
import { generateText, streamText, LanguageModelV1, LanguageModelV1CallOptions } from 'ai'
import { openai } from '@ai-sdk/openai'

function withMonitoringV2(model: LanguageModelV1, prefix = '[App]'): LanguageModelV1 {
  const origGen = model.doGenerate.bind(model)
  const origStream = model.doStream.bind(model)

  model.doGenerate = async (options: LanguageModelV1CallOptions) => {
    const start = Date.now()
    const result = await origGen(options)
    console.log(`${prefix} [监控] ${model.modelId} | ${Date.now() - start}ms | ${result.usage?.totalTokens ?? 0}tokens`)
    return result
  }

  model.doStream = async (options: LanguageModelV1CallOptions) => {
    console.log(`${prefix} [监控] ${model.modelId} | stream start`)
    return origStream(options)
  }

  return model
}

function withCacheV2(model: LanguageModelV1, ttlMs = 60000): LanguageModelV1 {
  const cache = new Map<string, any>()
  const origGen = model.doGenerate.bind(model)

  model.doGenerate = async (options: LanguageModelV1CallOptions) => {
    const key = JSON.stringify({ p: options.prompt, m: options.mode })
    const cached = cache.get(key)
    if (cached && Date.now() - cached.ts < ttlMs) {
      console.log('[组合] 缓存 HIT')
      return cached.data
    }
    const result = await origGen(options)
    cache.set(key, { data: result, ts: Date.now() })
    return result
  }

  return model
}

function withRateLimiterV2(model: LanguageModelV1, maxRpm = 60): LanguageModelV1 {
  const window: number[] = []
  const origGen = model.doGenerate.bind(model)
  const origStream = model.doStream.bind(model)

  const check = () => {
    const now = Date.now()
    while (window.length > 0 && window[0] < now - 60000) window.shift()
    if (window.length >= maxRpm) throw new Error(`限流：${maxRpm} RPM 已超限`)
    window.push(now)
  }

  model.doGenerate = async (options: LanguageModelV1CallOptions) => { check(); return origGen(options) }
  model.doStream = async (options: LanguageModelV1CallOptions) => { check(); return origStream(options) }

  return model
}

const compositeModel = withRateLimiterV2(
  withCacheV2(withMonitoringV2(openai('gpt-4o-mini'), '[组合]'), 30000),
  20
)

export async function POST(req: Request) {
  const { prompt } = await req.json()
  const { text } = await generateText({ model: compositeModel, prompt })
  return Response.json({ text })
}

export async function PUT(req: Request) {
  const { messages } = await req.json()
  const result = streamText({ model: compositeModel, messages })
  return result.toDataStreamResponse()
}
```

**`app/composite/page.tsx`**

```tsx
'use client'

import { useState } from 'react'

export default function CompositePage() {
  const [prompt, setPrompt] = useState('')
  const [result, setResult] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    try {
      const res = await fetch('/api/composite', { method: 'POST', body: JSON.stringify({ prompt }) })
      const json = await res.json()
      setResult(json.text)
    } catch (err: any) {
      setResult(err.message)
    }
    setLoading(false)
  }

  return (
    <div className="max-w-3xl mx-auto p-4">
      <h1 className="text-2xl font-bold mb-2">组合 Provider 包装器</h1>
      <p className="text-gray-500 mb-4">监控 + 缓存 + 限流 三层装饰器组合</p>
      <div className="grid grid-cols-3 gap-2 mb-4">
        <div className="bg-blue-50 rounded p-2 text-center text-sm"><span className="text-blue-700 font-semibold">监控</span><span className="text-blue-500 block text-xs">记录延迟</span></div>
        <div className="bg-teal-50 rounded p-2 text-center text-sm"><span className="text-teal-700 font-semibold">缓存</span><span className="text-teal-500 block text-xs">30 秒 TTL</span></div>
        <div className="bg-red-50 rounded p-2 text-center text-sm"><span className="text-red-700 font-semibold">限流</span><span className="text-red-500 block text-xs">20 RPM</span></div>
      </div>
      <form onSubmit={handleSubmit} className="mb-4">
        <div className="flex gap-2">
          <input type="text" value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="输入 prompt..." className="flex-1 border rounded px-3 py-2" disabled={loading} />
          <button type="submit" className="bg-indigo-600 text-white px-4 py-2 rounded" disabled={loading || !prompt.trim()}>
            {loading ? '发送中...' : '测试'}
          </button>
        </div>
      </form>
      {result && <div className="bg-gray-50 rounded-lg p-4 whitespace-pre-wrap">{result}</div>}
    </div>
  )
}
```

## 12.5 运行验证

### 前提条件

```bash
npm install ai @ai-sdk/openai
echo "OPENAI_API_KEY=sk-your-key" >> .env.local
npm run dev
```

### 验证步骤

**步骤 1：监控** — 访问 `/monitoring`，发送几次请求，观察底部监控统计面板。终端查看 `[监控]` 日志。

**步骤 2：缓存** — 访问 `/cached`，发送相同 prompt 两次。第二次延迟应显著降低。

**步骤 3：限流** — 访问 `/rate-limited`，点击"快速连发"。前 10 次成功，后续显示"被限流"。

**步骤 4：组合包装器** — 访问 `/composite`，发送请求并重复相同请求。三个装饰器同时生效。终端查看 `[组合]` 日志。

## 12.6 常见问题

### Q1: 为什么包装器没有生效？

常见原因：
1. **方法绑定**：必须用 `.bind(model)` 确保 `this` 指向正确
2. **直接修改原对象**：确保直接修改传入的 `model`，而不是创建新对象
3. **包装顺序**：外层包装器先执行。缓存在外层时，缓存命中不会触发内层的监控

### Q2: 缓存键应该包含哪些字段？

```typescript
const key = JSON.stringify({
  modelId: model.modelId,
  prompt: options.prompt,
  mode: options.mode,
  temperature: options.temperature,
  maxTokens: options.maxTokens,
})
```

只包含影响输出的关键参数。不要包含 `abortSignal`、`headers` 等不影响结果的字段。

### Q3: Token Bucket 和滑动窗口有什么区别？

| 算法 | 优点 | 缺点 |
|------|------|------|
| Token Bucket | 允许短时间突发，平滑 | 实现稍复杂 |
| 滑动窗口 | 实现简单 | 限制更严格 |

Token Bucket 更适合 AI API 调用场景——允许短暂突发，但长期平均受限。

### Q4: 监控数据应该存哪里？

示例中使用内存数组。生产环境推荐：
- **时序数据库**：Prometheus + Grafana（适合指标）
- **日志服务**：ELK / Datadog（适合日志）
- **APM**：Sentry / New Relic（适合一体化）

### Q5: 装饰器会影响流式响应吗？

会。如果你包装了 `doStream`，每次流式响应都会经过包装逻辑。注意：
- 不要对流数据本身做同步阻塞操作
- 记录延迟时，`doStream` 的调用延迟和流传输延迟是两回事
- 需要监控流式响应的逐 Token 延迟，应在 TransformStream 中处理

```typescript
model.doStream = async (options) => {
  const result = await originalDoStream(options)
  // 流开始前的日志
  return result
}
```

## 12.7 本章小结

本章深入介绍了自定义 Provider 的实现：

- **LanguageModelV1 接口**：理解 `doGenerate` 和 `doStream` 两个核心方法
- **装饰器模式**：通过包装现有 Provider 添加横切关注点
- **监控**：记录延迟、Token 消耗、成功率等指标
- **缓存**：基于 TTL 的请求缓存，减少重复 API 调用
- **限流**：Token Bucket 和滑动窗口算法控制请求频率
- **组合**：多个装饰器分层嵌套，各司其职

自定义 Provider 是构建可观测、可控的 AI 生产系统的基础。掌握了 Provider 包装，你就有了在 AI 调用链的任意环节插入监控、缓存、限流、日志等能力的手段。

至此，本教程涵盖了从环境搭建到 Provider 定制的完整知识体系。后面的章节将进一步探讨安全合规、多智能体协作、错误处理和实际企业案例。
