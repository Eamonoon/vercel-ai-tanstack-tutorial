# 第15章 生产级错误处理与高可用

## 15.1 概述

在生产环境中，AI 服务必然遇到故障。不是"如果"会失败，而是"什么时候"会失败：

| 故障类型 | 典型场景 | 频率 |
|----------|---------|------|
| 网络超时 | API 请求超过 30 秒未响应 | 偶尔 |
| 限流错误 | API 调用超出速率限制（429） | 根据使用量 |
| Provider 中断 | OpenAI/Anthropic 服务不可用 | 罕见但影响大 |
| Token 耗尽 | API Key 配额用尽 | 月底常见 |
| 模型错误 | 模型生成异常内容 | 偶发 |

**本章目标：** 掌握生产级错误处理的四种核心策略——重试、降级、熔断、优雅降级，构建高可用的 AI 应用。

### 错误处理策略全景

```
请求 → [重试策略] → 失败 → [Provider 降级] → 失败 → [熔断器]
                                                      ↓
                                                  [优雅降级]
                                                      ↓
                                                 返回合理响应
```

---

## 15.2 重试策略（指数退避）

### 指数退避原理

重试不是简单的"失败了就再试一次"。不加控制的重试会导致"重试风暴"——大量请求同时重试，压垮已经脆弱的服务。

**指数退避算法：**

```
第 1 次失败 → 等待 1s 后重试
第 2 次失败 → 等待 2s 后重试
第 3 次失败 → 等待 4s 后重试
第 n 次失败 → 等待 baseDelay × 2^(n-1) 后重试
```

### 加入抖动

为了防止多个请求同时重试，在延迟中加入随机抖动（Jitter）：

```typescript
const delay = baseDelay * Math.pow(2, attempt - 1) + Math.random() * 1000
```

### 重试阈值

| 参数 | 建议值 | 说明 |
|------|--------|------|
| 最大重试次数 | 3 | 超过 3 次说明问题不是临时的 |
| 基础延迟 | 1000ms | 首次重试等待 1 秒 |
| 超时时间 | 30000ms | 单次调用最长时间 |
| 可重试错误码 | 429, 500, 502, 503, 504 | 其他错误不重试 |

---

## 15.3 Provider 降级

### 降级策略

当主 Provider（如 OpenAI）不可用时，自动切换到备用 Provider（如 Anthropic）。

```
主 Provider (OpenAI)
  → 失败 → 重试 3 次
    → 仍失败 → 降级到备用 Provider (Anthropic)
      → 失败 → 重试 3 次
        → 仍失败 → 返回友好错误
```

### Provider 选择因素

| 因素 | 主 Provider | 备用 Provider |
|------|------------|---------------|
| 模型 | gpt-4o | claude-3-5-sonnet |
| 质量 | 首选 | 可接受 |
| 成本 | 标准 | 可能更高 |
| 延迟 | 正常 | 可能更高 |

---

## 15.4 熔断器模式（Circuit Breaker）

### 熔断器有三种状态

```
CLOSED（正常）
  → 连续失败达到阈值 → OPEN
    → 等待冷却时间 → HALF-OPEN
      → 成功 → CLOSED（恢复正常）
      → 失败 → OPEN（继续熔断）
```

| 状态 | 行为 |
|------|------|
| **CLOSED** | 正常调用，计数失败次数 |
| **OPEN** | 直接拒绝调用（快速失败），不发起实际请求 |
| **HALF-OPEN** | 允许一个试探请求，判断服务是否恢复 |

### 关键参数

| 参数 | 建议值 | 说明 |
|------|--------|------|
| 失败阈值 | 5 次 | 连续失败多少次触发熔断 |
| 冷却时间 | 30 秒 | 熔断后等待多久进入半开 |
| 超时阈值 | 10 秒 | 单次请求超时时间 |

---

## 15.5 优雅降级

当所有策略都失效时，用户不应该看到技术错误信息：

### 降级响应策略

| 层级 | 策略 | 示例响应 |
|------|------|---------|
| L1 | 缓存结果 | "根据上次数据回复..." |
| L2 | 预设回复 | "服务暂时不可用，请稍后再试" |
| L3 | 降级模型 | 用 gpt-4o-mini 替代 gpt-4o |
| L4 | 静默降级 | 返回当前页面已有数据 |

### 降级与熔断的区别

| 策略 | 目的 | 触发条件 |
|------|------|---------|
| 重试 | 临时故障时自动修复 | 网络超时、限流 |
| 降级 | 切换可用 Provider | 主 Provider 不可用 |
| 熔断 | 防止雪崩 | 连续失败达到阈值 |
| 优雅降级 | 用户看到合理信息 | 以上全部失效 |

---

## 15.6 代码示例

### 示例 1：带重试的 API 调用

**`app/api/with-retry/route.ts`**

```typescript
import { generateText } from 'ai'
import { openai } from '@ai-sdk/openai'

async function callWithRetry(
  prompt: string,
  maxRetries = 3
): Promise<string> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const { text } = await generateText({
        model: openai('gpt-4o'),
        prompt,
      })
      return text
    } catch (error: any) {
      const status = error.statusCode || error.status
      const retryable = !status || status >= 500 || status === 429

      if (!retryable || attempt === maxRetries) {
        throw error
      }

      const delay = 1000 * Math.pow(2, attempt - 1) + Math.random() * 500
      console.warn(`[Retry] 第 ${attempt} 次失败 (${status}), ${delay}ms 后重试`)
      await new Promise((r) => setTimeout(r, delay))
    }
  }

  throw new Error('所有重试均失败')
}

export async function POST(req: Request) {
  const { messages } = await req.json()
  const lastMsg = messages[messages.length - 1]?.content || ''

  try {
    const text = await callWithRetry(lastMsg)
    return Response.json({ text })
  } catch (error: any) {
    return Response.json(
      { error: `重试失败：${error.message}` },
      { status: 502 }
    )
  }
}
```

**`app/with-retry/page.tsx`**

```tsx
'use client'

import { useState } from 'react'

export default function WithRetryPage() {
  const [messages, setMessages] = useState<{ role: string; content: string }[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const userMsg = { role: 'user', content: input }
    setMessages((prev) => [...prev, userMsg])
    setInput('')
    setLoading(true)

    try {
      const res = await fetch('/api/with-retry', {
        method: 'POST',
        body: JSON.stringify({ messages: [...messages, userMsg] }),
      })
      const data = await res.json()
      if (data.error) {
        setMessages((prev) => [...prev, { role: 'assistant', content: `⚠️ ${data.error}` }])
      } else {
        setMessages((prev) => [...prev, { role: 'assistant', content: data.text }])
      }
    } catch {
      setMessages((prev) => [...prev, { role: 'assistant', content: '⚠️ 网络错误' }])
    }

    setLoading(false)
  }

  return (
    <div className="max-w-3xl mx-auto p-4">
      <h1 className="text-2xl font-bold mb-2">自动重试</h1>
      <p className="text-sm text-gray-500 mb-4">
        指数退避重试机制。临时故障自动重试最多 3 次。
      </p>
      <div className="border rounded-lg p-4 mb-4 h-96 overflow-y-auto">
        {messages.map((m, i) => (
          <div key={i} className={`mb-3 ${m.role === 'user' ? 'text-right' : 'text-left'}`}>
            <div className={`inline-block px-4 py-2 rounded-lg max-w-[80%] ${
              m.role === 'user' ? 'bg-blue-500 text-white' : 'bg-gray-100'
            }`}>
              {m.content}
            </div>
          </div>
        ))}
        {loading && (
          <div className="text-left">
            <div className="inline-block bg-gray-100 px-4 py-2 rounded-lg">请求中（自动重试）...</div>
          </div>
        )}
      </div>
      <form onSubmit={handleSubmit}>
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="输入消息..."
          className="w-full border rounded px-3 py-2"
          disabled={loading}
        />
      </form>
    </div>
  )
}
```

---

### 示例 2：Provider 自动降级

主 Provider 失败时自动切换到备用 Provider。

**`app/api/provider-fallback/route.ts`**

```typescript
import { generateText } from 'ai'
import { openai } from '@ai-sdk/openai'
import { anthropic } from '@ai-sdk/anthropic'

interface ProviderResult {
  text: string
  provider: string
  fallback: boolean
}

async function callProvider(
  provider: 'openai' | 'anthropic',
  messages: any[]
): Promise<string> {
  const model = provider === 'openai'
    ? openai('gpt-4o')
    : anthropic('claude-3-5-sonnet-20241022')

  const { text } = await generateText({ model, messages })
  return text
}

async function callWithFallback(messages: any[]): Promise<ProviderResult> {
  // 尝试主 Provider
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const text = await callProvider('openai', messages)
      return { text, provider: 'openai', fallback: false }
    } catch (error: any) {
      if (attempt === 1) {
        console.warn('[Fallback] OpenAI 失败，尝试 Anthropic')
      }
    }
  }

  // 降级到备用 Provider
  try {
    const text = await callProvider('anthropic', messages)
    return { text, provider: 'anthropic', fallback: true }
  } catch (error: any) {
    throw new Error(`所有 Provider 均不可用：${error.message}`)
  }
}

export async function POST(req: Request) {
  const { messages } = await req.json()

  try {
    const result = await callWithFallback(messages)
    return Response.json(result)
  } catch (error: any) {
    return Response.json(
      { error: error.message, fallback: true },
      { status: 503 }
    )
  }
}
```

**`app/provider-fallback/page.tsx`**

```tsx
'use client'

import { useState } from 'react'

export default function ProviderFallbackPage() {
  const [messages, setMessages] = useState<{ role: string; content: string }[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const userMsg = { role: 'user', content: input }
    setMessages((prev) => [...prev, userMsg])
    setInput('')
    setLoading(true)

    try {
      const res = await fetch('/api/provider-fallback', {
        method: 'POST',
        body: JSON.stringify({ messages: [...messages, userMsg] }),
      })
      const data = await res.json()

      if (data.error) {
        setMessages((prev) => [...prev, { role: 'assistant', content: `⚠️ ${data.error}` }])
      } else {
        const prefix = data.fallback ? '⚠️ [备用 Provider] ' : ''
        setMessages((prev) => [...prev, { role: 'assistant', content: `${prefix}${data.text}` }])
      }
    } catch {
      setMessages((prev) => [...prev, { role: 'assistant', content: '⚠️ 网络错误' }])
    }

    setLoading(false)
  }

  return (
    <div className="max-w-3xl mx-auto p-4">
      <h1 className="text-2xl font-bold mb-2">Provider 自动降级</h1>
      <p className="text-sm text-gray-500 mb-4">
        OpenAI 不可用时自动切换到 Anthropic。可将 API Key 改为错误值测试降级。
      </p>
      <div className="border rounded-lg p-4 mb-4 h-96 overflow-y-auto">
        {messages.map((m, i) => (
          <div key={i} className={`mb-3 ${m.role === 'user' ? 'text-right' : 'text-left'}`}>
            <div className={`inline-block px-4 py-2 rounded-lg max-w-[80%] ${
              m.role === 'user' ? 'bg-blue-500 text-white' : 'bg-gray-100'
            }`}>
              {m.content}
            </div>
          </div>
        ))}
        {loading && <div className="text-left"><div className="inline-block bg-gray-100 px-4 py-2 rounded-lg">请求中...</div></div>}
      </div>
      <form onSubmit={handleSubmit}>
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="输入消息..."
          className="w-full border rounded px-3 py-2"
          disabled={loading}
        />
      </form>
    </div>
  )
}
```

---

### 示例 3：熔断器实现

连续失败时触发熔断，避免无意义的重复请求。

**`app/api/circuit-breaker/route.ts`**

```typescript
import { generateText } from 'ai'
import { openai } from '@ai-sdk/openai'

class CircuitBreaker {
  private failures = 0
  private lastFailureTime = 0
  private state: 'closed' | 'open' | 'half-open' = 'closed'

  constructor(
    private threshold = 5,
    private cooldownMs = 30000
  ) {}

  async call<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === 'open') {
      if (Date.now() - this.lastFailureTime > this.cooldownMs) {
        console.log('[CircuitBreaker] HALF-OPEN — 允许试探请求')
        this.state = 'half-open'
      } else {
        throw new Error('CIRCUIT_OPEN')
      }
    }

    try {
      const result = await fn()
      if (this.state === 'half-open') {
        console.log('[CircuitBreaker] CLOSED — 服务恢复')
        this.state = 'closed'
        this.failures = 0
      }
      return result
    } catch (error) {
      this.failures++
      this.lastFailureTime = Date.now()

      if (this.failures >= this.threshold) {
        this.state = 'open'
        console.error(`[CircuitBreaker] OPEN — ${this.failures} 次连续失败`)
      }

      throw error
    }
  }

  getState() {
    return { state: this.state, failures: this.failures }
  }
}

const breaker = new CircuitBreaker(3, 15000)

export async function POST(req: Request) {
  const { messages } = await req.json()
  const lastMsg = messages[messages.length - 1]?.content || ''

  try {
    const text = await breaker.call(async () => {
      const { text } = await generateText({
        model: openai('gpt-4o'),
        prompt: lastMsg,
      })
      return text
    })

    return Response.json({ text, ...breaker.getState() })
  } catch (error: any) {
    if (error.message === 'CIRCUIT_OPEN') {
      return Response.json({
        error: '服务熔断中（OPenAI 连续失败），请 30 秒后重试',
        ...breaker.getState(),
      })
    }

    return Response.json(
      { error: error.message, ...breaker.getState() },
      { status: 502 }
    )
  }
}
```

**`app/circuit-breaker/page.tsx`**

```tsx
'use client'

import { useState } from 'react'

export default function CircuitBreakerPage() {
  const [messages, setMessages] = useState<{ role: string; content: string }[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const userMsg = { role: 'user', content: input }
    setMessages((prev) => [...prev, userMsg])
    setInput('')
    setLoading(true)

    try {
      const res = await fetch('/api/circuit-breaker', {
        method: 'POST',
        body: JSON.stringify({ messages: [...messages, userMsg] }),
      })
      const data = await res.json()

      if (data.error) {
        setMessages((prev) => [...prev, { role: 'assistant', content: `🔴 ${data.error}` }])
      } else {
        setMessages((prev) => [...prev, { role: 'assistant', content: data.text }])
      }
    } catch {
      setMessages((prev) => [...prev, { role: 'assistant', content: '⚠️ 网络错误' }])
    }

    setLoading(false)
  }

  return (
    <div className="max-w-3xl mx-auto p-4">
      <h1 className="text-2xl font-bold mb-2">熔断器保护</h1>
      <p className="text-sm text-gray-500 mb-4">
        连续 3 次失败后触发熔断（OPEN），15 秒后自动尝试恢复（HALF-OPEN）。
      </p>
      <div className="border rounded-lg p-4 mb-4 h-96 overflow-y-auto">
        {messages.map((m, i) => (
          <div key={i} className={`mb-3 ${m.role === 'user' ? 'text-right' : 'text-left'}`}>
            <div className={`inline-block px-4 py-2 rounded-lg max-w-[80%] ${
              m.role === 'user' ? 'bg-blue-500 text-white' : 'bg-gray-100'
            }`}>
              {m.content}
            </div>
          </div>
        ))}
        {loading && <div className="text-left"><div className="inline-block bg-gray-100 px-4 py-2 rounded-lg">请求中...</div></div>}
      </div>
      <form onSubmit={handleSubmit}>
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="输入消息..."
          className="w-full border rounded px-3 py-2"
          disabled={loading}
        />
      </form>
    </div>
  )
}
```

---

### 示例 4：完整生产级管线

重试 + 降级 + 熔断 + 优雅降级——四合一完整方案。

**`app/api/production-pipeline/route.ts`**

```typescript
import { generateText } from 'ai'
import { openai } from '@ai-sdk/openai'
import { anthropic } from '@ai-sdk/anthropic'

class ProductionCircuitBreaker {
  private failures = 0
  private lastFailureTime = 0
  private state: 'closed' | 'open' | 'half-open' = 'closed'

  constructor(
    private threshold = 5,
    private cooldownMs = 30000
  ) {}

  async call<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === 'open') {
      if (Date.now() - this.lastFailureTime > this.cooldownMs) {
        this.state = 'half-open'
      } else {
        throw new Error('CIRCUIT_OPEN')
      }
    }

    try {
      const result = await fn()
      if (this.state === 'half-open') {
        this.state = 'closed'
        this.failures = 0
      }
      return result
    } catch (error) {
      this.failures++
      this.lastFailureTime = Date.now()
      if (this.failures >= this.threshold) {
        this.state = 'open'
      }
      throw error
    }
  }
}

const breaker = new ProductionCircuitBreaker(3, 15000)

async function callWithRetry(
  provider: 'openai' | 'anthropic',
  messages: any[],
  maxRetries = 3
): Promise<string> {
  const model = provider === 'openai'
    ? openai('gpt-4o')
    : anthropic('claude-3-5-sonnet-20241022')

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const { text } = await generateText({ model, messages })
      return text
    } catch (error: any) {
      if (attempt === maxRetries) throw error
      const delay = 1000 * Math.pow(2, attempt - 1) + Math.random() * 500
      await new Promise((r) => setTimeout(r, delay))
    }
  }

  throw new Error('所有重试均失败')
}

export async function POST(req: Request) {
  const { messages } = await req.json()

  try {
    const text = await breaker.call(
      () => callWithRetry('openai', messages)
    )
    return Response.json({ text, provider: 'openai' })
  } catch (openaiError: any) {
    if (openaiError.message === 'CIRCUIT_OPEN') {
      console.log('[Pipeline] 熔断中，直接降级到 Anthropic')
    } else {
      console.warn('[Pipeline] OpenAI 重试失败，降级')
    }

    try {
      const text = await callWithRetry('anthropic', messages)
      return Response.json({ text, provider: 'anthropic (fallback)', fallback: true })
    } catch (anthropicError: any) {
      return Response.json(
        {
          error: '系统暂时不可用，请稍后再试。我们已记录此问题。',
          provider: 'none',
          fallback: true,
        },
        { status: 503 }
      )
    }
  }
}
```

**`app/production-pipeline/page.tsx`**

```tsx
'use client'

import { useState } from 'react'

export default function ProductionPipelinePage() {
  const [messages, setMessages] = useState<{ role: string; content: string }[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const userMsg = { role: 'user', content: input }
    setMessages((prev) => [...prev, userMsg])
    setInput('')
    setLoading(true)
    setStatus('请求中（重试+熔断保护）...')

    try {
      const res = await fetch('/api/production-pipeline', {
        method: 'POST',
        body: JSON.stringify({ messages: [...messages, userMsg] }),
      })
      const data = await res.json()

      if (data.error) {
        setMessages((prev) => [...prev, { role: 'assistant', content: `🛡️ ${data.error}` }])
        setStatus(`Provider: ${data.provider}`)
      } else {
        const prefix = data.fallback ? '🔄 [降级] ' : ''
        setMessages((prev) => [...prev, { role: 'assistant', content: `${prefix}${data.text}` }])
        setStatus(`Provider: ${data.provider}`)
      }
    } catch {
      setMessages((prev) => [...prev, { role: 'assistant', content: '🛡️ 网络错误，请检查连接后重试' }])
      setStatus('网络不可用')
    }

    setLoading(false)
  }

  return (
    <div className="max-w-3xl mx-auto p-4">
      <h1 className="text-2xl font-bold mb-2">生产级 AI 管线</h1>
      <p className="text-sm text-gray-500 mb-4">
        重试 + Provider 降级 + 熔断器 + 优雅降级。支持四层保护。
      </p>
      <div className="mb-2 text-xs text-gray-400">{status}</div>
      <div className="border rounded-lg p-4 mb-4 h-80 overflow-y-auto">
        {messages.map((m, i) => (
          <div key={i} className={`mb-3 ${m.role === 'user' ? 'text-right' : 'text-left'}`}>
            <div className={`inline-block px-4 py-2 rounded-lg max-w-[80%] ${
              m.role === 'user' ? 'bg-blue-500 text-white' : 'bg-gray-100'
            }`}>
              {m.content}
            </div>
          </div>
        ))}
        {loading && (
          <div className="text-left">
            <div className="inline-block bg-gray-100 px-4 py-2 rounded-lg">处理中...</div>
          </div>
        )}
      </div>
      <form onSubmit={handleSubmit}>
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="输入消息..."
          className="w-full border rounded px-3 py-2"
          disabled={loading}
        />
      </form>
    </div>
  )
}
```

---

## 15.7 运行验证

### 安装依赖

```bash
npm install ai @ai-sdk/openai @ai-sdk/anthropic zod
```

### 验证步骤

1. **带重试 API**：访问 `/with-retry`，正常对话验证重试不影响正常使用
2. **Provider 降级**：访问 `/provider-fallback`，临时将 `OPENAI_API_KEY` 改为错误值，观察降级到 Anthropic
3. **熔断器**：访问 `/circuit-breaker`，用错误 API Key 连续发送请求，观察 OPEN 状态
4. **生产级管线**：访问 `/production-pipeline`，测试完整保护链

### 测试说明

熔断器和降级的验证需要模拟失败场景：

```bash
# 临时将 API Key 改错再启动
OPENAI_API_KEY="invalid-key" npm run dev

# 访问 /circuit-breaker，连续发送 3~4 次请求
# 第 4 次应看到 "服务熔断中" 提示
# 恢复正确的 key 后等待 15 秒再试，应自动恢复
```

### 验证预期

| 测试场景 | 预期结果 |
|----------|---------|
| 正常请求 | 正常返回 AI 回复 |
| 重试（网络抖动） | 自动重试，最终成功 |
| Provider 降级 | 显示"备用 Provider"标记 |
| 熔断器触发 | 显示熔断提示，快速失败 |
| 全部 Provider 不可用 | 显示友好降级提示 |

---

## 15.8 常见问题

### Q1: 重试和熔断不会增加用户等待时间吗？

会，但这是有意的权衡。重试增加 1-7 秒延迟，但避免了用户看到错误。熔断器 OPEN 后直接快速失败（<5ms），反而比正常请求还快。

### Q2: 熔断器阈值怎么设置合适？

建议初始值：5 次失败 / 30 秒冷却。根据生产数据调整：
- 如果 Provider 偶发故障多：提高阈值到 8-10
- 如果故障恢复快：缩短冷却到 15 秒
- 建议结合 P50/P99 延迟监控动态调整

### Q3: 多个 Provider 都失败的概率大吗？

极小但存在（如网络分区）。这也是为什么需要优雅降级——给用户合理的提示，而不是技术堆栈跟踪。

### Q4: 降级响应中是否应该区分"降级模式"？

取决于业务场景：
- 内部工具：可以明确标记"使用备用模型"
- 面向用户：建议不展示技术细节，只给友好提示
- 调试环境：使用 `console.log` 记录降级信息

### Q5: 为什么需要区分可重试和不可重试错误？

| 错误码 | 可重试 | 原因 |
|--------|--------|------|
| 400 Bad Request | 否 | 客户端错误，重试无意义 |
| 401 Unauthorized | 否 | API Key 问题，重试无用 |
| 429 Rate Limited | 是 | 限流，等待后可恢复 |
| 500+ Server Error | 是 | 服务端临时故障 |

### Q6: 如何将这些模式组合在一起？

典型的生产级管线：
```
请求 → [输入审核] → [语义缓存]
  → 未命中 → [熔断器检查]
    → CLOSED → [重试 × 3 → Provider A]
      → 失败 → [降级 → 重试 × 3 → Provider B]
        → 失败 → [优雅降级 → 缓存/默认回复]
  → [输出审核] → 用户
```

---

## 15.9 本章小结

生产级错误处理不是"加个 try-catch"，而是一套完整的防御体系：

| 策略 | 作用 | 防御层次 |
|------|------|---------|
| **重试 + 指数退避** | 处理临时故障 | 第一道防线 |
| **Provider 降级** | 跨 Provider 容灾 | 第二道防线 |
| **熔断器** | 防止雪崩效应 | 保护性防御 |
| **优雅降级** | 保障用户体验 | 最后屏障 |

**关键要点：**
- 重试使用指数退避 + 抖动，避免重试风暴
- 降级需要准备至少两个 Provider
- 熔断器防止雪崩，是系统自我保护机制
- 优雅降级让用户在故障时也能获得合理体验
- 四种策略组合使用，形成完整的防御链
- 将可重试错误（5xx、429）与不可重试错误（4xx 其他）分开处理
