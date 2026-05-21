# 第2章：Vercel AI SDK 核心概念与基础用法

## 概述

Vercel AI SDK（`ai`）是一个开源的 TypeScript 库，为 AI 应用提供统一的接口层。它屏蔽了不同 AI 提供商（OpenAI、Anthropic、Google 等）的 API 差异，让你用同一套 API 操作不同的底层模型。

**本章目标：** 掌握 AI SDK 的核心抽象，能够实现基础的文本生成和流式对话功能。

## 核心概念

### Provider（提供商）

Provider 是 AI SDK 的插件层，每个 Provider 封装了一个 AI 服务商的 API。SDK 内置了 `@ai-sdk/openai` 和 `@ai-sdk/anthropic` 等官方 Provider。

```typescript
import { openai } from '@ai-sdk/openai'
import { anthropic } from '@ai-sdk/anthropic'

const model1 = openai('gpt-4o')
const model2 = anthropic('claude-3-5-sonnet-20241022')
```

### `generateText` — 一次性文本生成

调用模型并等待完整响应返回。适合总结、翻译、分类等不需要流式输出的场景。

```typescript
const { text } = await generateText({
  model: openai('gpt-4o'),
  prompt: '什么是 Vercel AI SDK？',
})
console.log(text)
```

### `streamText` — 流式文本生成

以流（Stream）形式逐块返回模型输出。适合聊天界面，实现打字机效果。

```typescript
const result = streamText({
  model: anthropic('claude-3-5-sonnet-20241022'),
  prompt: '用中文讲一个短故事',
})

for await (const chunk of result.textStream) {
  process.stdout.write(chunk)
}
```

### Messages（消息数组）

多轮对话使用 `messages` 数组，每一条消息包含 `role`（`system` / `user` / `assistant`）和 `content`。

```typescript
const messages = [
  { role: 'system', content: '你是一名 Python 导师。' },
  { role: 'user', content: '什么是装饰器？' },
  { role: 'assistant', content: '装饰器是一种修改函数行为的方式……' },
  { role: 'user', content: '举个例子？' },
]
```

## 项目搭建

### 安装依赖

```bash
npm install ai @ai-sdk/openai @ai-sdk/anthropic
```

### 环境变量

创建 `.env.local`：

```env
OPENAI_API_KEY=sk-your-openai-key
ANTHROPIC_API_KEY=sk-ant-your-anthropic-key
```

## 代码示例

### 示例1：基础文本生成（API Route）

`app/api/generate/route.ts`：

```typescript
import { generateText } from 'ai'
import { openai } from '@ai-sdk/openai'
import { anthropic } from '@ai-sdk/anthropic'

export async function POST(req: Request) {
  const { prompt, provider = 'openai' } = await req.json()

  const model = provider === 'openai'
    ? openai('gpt-4o')
    : anthropic('claude-3-5-sonnet-20241022')

  const { text } = await generateText({
    model,
    prompt,
  })

  return Response.json({ text })
}
```

### 示例2：流式聊天（API Route）

`app/api/chat/route.ts`：

```typescript
import { streamText } from 'ai'
import { openai } from '@ai-sdk/openai'
import { anthropic } from '@ai-sdk/anthropic'

export async function POST(req: Request) {
  const { messages, provider = 'openai' } = await req.json()

  const model = provider === 'openai'
    ? openai('gpt-4o')
    : anthropic('claude-3-5-sonnet-20241022')

  const result = streamText({
    model,
    messages,
  })

  return result.toDataStreamResponse()
}
```

### 示例3：前端聊天组件

`app/page.tsx`：

```tsx
'use client'

import { useChat } from 'ai/react'
import { useState } from 'react'

export default function ChatPage() {
  const { messages, input, handleInputChange, handleSubmit, isLoading } = useChat({
    api: '/api/chat',
  })
  const [provider, setProvider] = useState<'openai' | 'anthropic'>('openai')

  return (
    <div className="max-w-2xl mx-auto p-4">
      <h1 className="text-2xl font-bold mb-4">Vercel AI SDK 聊天演示</h1>

      <div className="mb-4">
        <label className="mr-2">Provider:</label>
        <select
          value={provider}
          onChange={(e) => setProvider(e.target.value as 'openai' | 'anthropic')}
          className="border rounded px-2 py-1"
        >
          <option value="openai">OpenAI GPT-4o</option>
          <option value="anthropic">Anthropic Claude 3.5 Sonnet</option>
        </select>
      </div>

      <div className="border rounded-lg p-4 mb-4 h-96 overflow-y-auto">
        {messages.map((m) => (
          <div key={m.id} className={`mb-3 ${m.role === 'user' ? 'text-right' : 'text-left'}`}>
            <div className={`inline-block px-4 py-2 rounded-lg ${
              m.role === 'user' ? 'bg-blue-500 text-white' : 'bg-gray-100'
            }`}>
              {m.content}
            </div>
          </div>
        ))}
      </div>

      <form onSubmit={(e) => {
        handleSubmit(e, { body: { provider } })
      }}>
        <input
          type="text"
          value={input}
          onChange={handleInputChange}
          placeholder="输入你的消息..."
          className="w-full border rounded px-3 py-2"
          disabled={isLoading}
        />
      </form>
    </div>
  )
}
```

### 示例4：使用 Anthropic 生成流式响应

`app/api/chat-anthropic/route.ts`：

```typescript
import { streamText } from 'ai'
import { anthropic } from '@ai-sdk/anthropic'

export async function POST(req: Request) {
  const { messages } = await req.json()

  const result = streamText({
    model: anthropic('claude-3-5-sonnet-20241022'),
    messages: [
      {
        role: 'system',
        content: '你是一位友好的 AI 助手，请用中文回答问题。',
      },
      ...messages,
    ],
  })

  return result.toDataStreamResponse()
}
```

## 运行验证

```bash
# 1. 安装依赖
npm install

# 2. 配置环境变量
cp .env.example .env.local
# 编辑 .env.local 填入你的 API Key

# 3. 启动开发服务器
npm run dev

# 4. 测试 API
curl -X POST http://localhost:3000/api/generate \
  -H "Content-Type: application/json" \
  -d '{"prompt": "用一句话介绍Vercel AI SDK"}'

# 5. 打开浏览器访问 http://localhost:3000
```

## 常见问题

### Q: Provider 和 Model 有什么区别？

Provider 是 AI 服务商（OpenAI、Anthropic），Model 是具体的模型实例（`gpt-4o`、`claude-3-5-sonnet`）。Provider 提供创建 Model 实例的方法。

### Q: `generateText` 和 `streamText` 应该用哪个？

- 需要完整响应后再处理 → `generateText`
- 需要逐字展示给用户 → `streamText`
- 聊天 UI 场景优先 `streamText`

### Q: 如何切换不同的 AI 提供商？

只需替换 `model` 参数即可。AI SDK 保证接口一致：

```typescript
// OpenAI
const model = openai('gpt-4o')

// Anthropic
const model = anthropic('claude-3-5-sonnet-20241022')
```

### Q: API Key 应该放在哪里？

放在 `.env.local` 文件中，通过 `process.env.OPENAI_API_KEY` 读取。Provider 会自动读取对应的环境变量。

### Q: 为什么 `useChat` 报错？

`useChat` 是客户端 Hook，必须在 `'use client'` 组件中使用。确保你的组件文件顶部有 `'use client'` 指令。
