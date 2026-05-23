# 第10章：多模态与流式中间件

## 10.1 概述

本章涵盖两个紧密相关的主题：多模态（Multimodal）和流式处理中间件（Stream Middleware）。两者都围绕"AI 不只是处理文本"和"让输出更可控"这两个目标展开。

### 多模态

多模态 AI 指模型能同时理解文本、图像、音频等多种输入形式。GPT-4o、Claude 3.5 Sonnet 等前沿模型都支持多模态输入。

**实际应用**：
- 图像分析：产品图片识别、截图解读、图表分析
- 文档理解：扫描件、PDF 解读
- 视觉问答：基于图片内容回答用户问题
- 代码截图 → 代码提取

### 流式中间件

流式中间件是指在 AI 输出流式传输到客户端之前，在服务端对数据流进行实时处理的机制。核心是 `TransformStream`。

**实际应用**：
- 敏感词过滤：实时屏蔽不合规内容
- 格式转换：Markdown 到 HTML 实时转换
- 内容标注：自动添加高亮、注释
- 数据脱敏：实时替换电话号码、邮箱等敏感信息

### 为什么放在一起？

多模态和流式中间件虽然面向不同问题，但都体现了 AI SDK 的核心能力：
- 多模态体现了消息格式的灵活性（`content` 数组）
- 流式中间件体现了数据流的可编程性（`TransformStream`）

两者结合，你可以构建"用户上传图片 → AI 分析 → 实时过滤后展示"的完整管线。

## 10.2 多模态消息格式

### Content Array

AI SDK 使用 `content` 数组表示多模态消息。每条消息的 `content` 是一个数组，每个元素可以是文本或图片。

```typescript
const message = {
  role: 'user',
  content: [
    { type: 'text', text: '请描述这张图片' },
    { type: 'image', image: 'https://example.com/photo.jpg' },
  ],
}
```

### Image 类型

`image` 字段支持多种格式：

| 格式 | 说明 | 示例 |
|------|------|------|
| URL | 公开可访问的图片地址 | `{ type: 'image', image: 'https://...' }` |
| Base64 | 内嵌图片数据 | `{ type: 'image', image: 'data:image/jpeg;base64,...' }` |
| Buffer | Node.js Buffer | 需转为 Base64 后传递 |

### 多图输入

可以一次传入多张图片：

```typescript
const message = {
  role: 'user',
  content: [
    { type: 'text', text: '对比这两张图片的差异' },
    { type: 'image', image: 'https://example.com/photo1.jpg' },
    { type: 'image', image: 'https://example.com/photo2.jpg' },
  ],
}
```

### 支持的图片格式

- JPEG / JPG
- PNG
- GIF（仅第一帧）
- WebP
- 建议大小：每张图片不超过 20MB

## 10.3 TransformStream 原理

### 什么是 TransformStream

`TransformStream` 是 Web Streams API 的一部分，允许你在数据流通过时对其进行转换。

```
输入流 → [TransformStream] → 输出流
                ↓
         可编程转换逻辑
```

### AI SDK 中的 TransformStream

在 AI SDK 中，`streamText()` 返回的 `textStream` 可以被 `TransformStream` 截获和修改：

```typescript
const result = streamText({ model, prompt })

const transformStream = new TransformStream({
  transform(chunk, controller) {
    // 每个 chunk 是一个文本片段
    const modified = chunk.toUpperCase() // 转换逻辑
    controller.enqueue(modified)         // 放回流中
  },
})

return result.toDataStreamResponse({ transform: transformStream })
```

### 生命周期

| 事件 | 回调 | 说明 |
|------|------|------|
| 每个数据块到达 | `transform(chunk, controller)` | 处理每个流片段 |
| 流开始 | `start(controller)` | 初始化 |
| 流结束 | `flush(controller)` | 收尾工作 |

### 重要概念

- **Chunk 是文本片段**：每个 chunk 是模型生成的一小段文本，不是完整的 Token
- **编码/解码**：SDK 内部使用 `Uint8Array`，需要 TextEncoder/TextDecoder
- **顺序保证**：transform 按 chunk 到达顺序调用，不要依赖异步操作改变顺序

```typescript
const encoder = new TextEncoder()
const decoder = new TextDecoder()

const transform = new TransformStream({
  transform(chunk: Uint8Array, controller) {
    const text = decoder.decode(chunk, { stream: true })
    const modified = text.replace(/不良/g, '***')
    controller.enqueue(encoder.encode(modified))
  },
  flush(controller) {
    // 流结束时执行
    controller.enqueue(encoder.encode('\n\n[处理完成]'))
  },
})
```

## 10.4 代码示例

### 示例 1：图像识别 API Route

使用 GPT-4o 分析图片内容。

**`app/api/vision/route.ts`**

```typescript
import { generateText } from 'ai'
import { openai } from '@ai-sdk/openai'

export async function POST(req: Request) {
  const { imageUrl, prompt } = await req.json()

  const { text } = await generateText({
    model: openai('gpt-4o'),
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: prompt || '请详细描述这张图片的内容、构图、色彩和风格' },
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
      body: JSON.stringify({
        imageUrl,
        prompt: '用中文详细描述这张图片，包括主体、背景、色彩、构图、风格等',
      }),
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
          placeholder="输入图片 URL，例如 https://picsum.photos/seed/1/800/600"
          className="w-full border rounded px-3 py-2 mb-2"
          disabled={loading}
        />
        <button
          type="submit"
          className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
          disabled={loading || !imageUrl}
        >
          {loading ? '分析中...' : '分析图片'}
        </button>
      </form>
      {imageUrl && (
        <div className="my-4 border rounded overflow-hidden">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={imageUrl}
            alt="预览"
            className="max-w-full h-80 object-contain mx-auto"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = 'none'
            }}
          />
        </div>
      )}
      {description && (
        <div className="mt-4">
          <h2 className="text-lg font-semibold mb-2">AI 分析结果</h2>
          <div className="bg-gray-50 rounded-lg p-4 whitespace-pre-wrap leading-relaxed">
            {description}
          </div>
        </div>
      )}
    </div>
  )
}
```

### 示例 2：前端多模态上传页面

支持文件上传（拖拽或点击），将图片转为 Base64 发送给 AI。

**`app/api/vision-upload/route.ts`**

```typescript
import { generateText } from 'ai'
import { openai } from '@ai-sdk/openai'

export async function POST(req: Request) {
  const { imageBase64, fileName } = await req.json()

  const { text } = await generateText({
    model: openai('gpt-4o'),
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: `分析用户上传的文件 ${fileName}。请描述：\n1. 图片中的主要内容\n2. 物体/人物\n3. 文字内容（如果有）\n4. 整体构图` },
          { type: 'image', image: imageBase64 },
        ],
      },
    ],
    maxTokens: 1024,
  })

  return Response.json({ description: text })
}
```

**`app/vision-upload/page.tsx`**

```tsx
'use client'

import { useState, useRef } from 'react'

export default function VisionUploadPage() {
  const [preview, setPreview] = useState<string | null>(null)
  const [fileName, setFileName] = useState('')
  const [description, setDescription] = useState('')
  const [loading, setLoading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as string)
      reader.onerror = reject
      reader.readAsDataURL(file)
    })
  }

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setFileName(file.name)
    const base64 = await fileToBase64(file)
    setPreview(base64)
    setLoading(true)
    try {
      const res = await fetch('/api/vision-upload', {
        method: 'POST',
        body: JSON.stringify({ imageBase64: base64, fileName: file.name }),
      })
      const data = await res.json()
      setDescription(data.description)
    } catch {
      setDescription('分析失败，请重试')
    }
    setLoading(false)
  }

  return (
    <div className="max-w-3xl mx-auto p-4">
      <h1 className="text-2xl font-bold mb-4">图片上传分析</h1>

      <div
        className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center cursor-pointer hover:border-blue-400 transition-colors"
        onClick={() => fileRef.current?.click()}
      >
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          onChange={handleFileChange}
          className="hidden"
        />
        {preview ? (
          <img src={preview} alt="预览" className="max-h-64 mx-auto rounded" />
        ) : (
          <div className="text-gray-400">
            <p className="text-4xl mb-2">+</p>
            <p>点击或拖拽上传图片</p>
            <p className="text-sm mt-1">支持 JPG、PNG、WebP</p>
          </div>
        )}
      </div>

      {loading && (
        <div className="mt-4 text-center text-gray-500">
          <p className="animate-pulse">AI 正在分析图片...</p>
        </div>
      )}

      {description && !loading && (
        <div className="mt-4">
          <h2 className="text-lg font-semibold mb-2">分析结果</h2>
          <div className="bg-gray-50 rounded-lg p-4 whitespace-pre-wrap leading-relaxed">
            {description}
          </div>
        </div>
      )}
    </div>
  )
}
```

### 示例 3：流式 Markdown → HTML 实时转换

在 AI 输出的 Markdown 内容流式传输时，实时将其转换为 HTML。

**`app/api/stream-md/route.ts`**

```typescript
import { streamText } from 'ai'
import { openai } from '@ai-sdk/openai'

export async function POST(req: Request) {
  const { messages } = await req.json()

  const result = streamText({
    model: openai('gpt-4o'),
    messages,
  })

  const encoder = new TextEncoder()
  const decoder = new TextDecoder()

  const transformStream = new TransformStream({
    transform(chunk: Uint8Array, controller) {
      let html = decoder.decode(chunk, { stream: true })

      // 标题转换
      html = html
        .replace(/^### (.+)$/gm, '<h3>$1</h3>')
        .replace(/^## (.+)$/gm, '<h2>$1</h2>')
        .replace(/^# (.+)$/gm, '<h1>$1</h1>')

      // 代码块
      html = html.replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) => {
        const langClass = lang ? ` class="language-${lang}"` : ''
        return `<pre><code${langClass}>${code.trim()}</code></pre>`
      })

      // 行内格式
      html = html
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.+?)\*/g, '<em>$1</em>')
        .replace(/`([^`]+)`/g, '<code>$1</code>')

      // 列表
      html = html.replace(/^- (.+)$/gm, '<li>$1</li>')
      html = html.replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>')

      // 段落（未被标签包裹的文本行）
      html = html.replace(/^(?!<[hplu]|<li)(.+)$/gm, '<p>$1</p>')

      controller.enqueue(encoder.encode(html))
    },
  })

  return result.toDataStreamResponse({ transform: transformStream })
}
```

**`app/stream-md/page.tsx`**

```tsx
'use client'

import { useChat } from 'ai/react'
import { useMemo } from 'react'

export default function StreamMdPage() {
  const { messages, input, handleInputChange, handleSubmit, isLoading } = useChat({
    api: '/api/stream-md',
  })

  return (
    <div className="max-w-4xl mx-auto p-4">
      <h1 className="text-2xl font-bold mb-2">流式 Markdown 转换</h1>
      <p className="text-sm text-gray-500 mb-4">
        AI 回答中的 Markdown 实时转换为 HTML — 输入"用 Markdown 格式..."
      </p>

      <div className="border rounded-lg h-[500px] overflow-y-auto p-4 mb-4 bg-white">
        {messages.map((m) => (
          <div key={m.id} className={`mb-4 ${m.role === 'user' ? 'text-right' : 'text-left'}`}>
            <div className={`inline-block px-4 py-2 rounded-lg max-w-[85%] text-left ${
              m.role === 'user' ? 'bg-blue-500 text-white' : 'bg-gray-50 border'
            }`}>
              <p className="text-xs opacity-60 mb-1">{m.role === 'user' ? '你' : 'AI'}</p>
              {m.role === 'user' ? (
                <div className="whitespace-pre-wrap text-sm">{m.content}</div>
              ) : (
                <div
                  className="prose prose-sm max-w-none"
                  dangerouslySetInnerHTML={{ __html: m.content }}
                />
              )}
            </div>
          </div>
        ))}
        {isLoading && (
          <div className="text-center text-gray-400 text-sm">AI 正在生成...</div>
        )}
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

### 示例 4：流式内容过滤（敏感词过滤）

在流式传输过程中实时屏蔽敏感内容。

**`app/api/stream-filter/route.ts`**

```typescript
import { streamText } from 'ai'
import { openai } from '@ai-sdk/openai'

const SENSITIVE_WORDS = ['暴力', '色情', '赌博', '毒品', '违法']

function filterContent(text: string): string {
  let filtered = text
  for (const word of SENSITIVE_WORDS) {
    const regex = new RegExp(word, 'gi')
    filtered = filtered.replace(regex, '***')
  }
  return filtered
}

// 额外的规则：手机号脱敏
function maskPhoneNumbers(text: string): string {
  return text.replace(/1[3-9]\d{9}/g, (match) => {
    return match.slice(0, 3) + '****' + match.slice(7)
  })
}

// 邮箱脱敏
function maskEmails(text: string): string {
  return text.replace(/(\w{2})\w+@(\w+\.\w+)/g, '$1***@$2')
}

export async function POST(req: Request) {
  const { messages } = await req.json()

  const result = streamText({
    model: openai('gpt-4o'),
    system: '你是一个友好的助手。回答简洁准确。',
    messages,
  })

  const encoder = new TextEncoder()
  const decoder = new TextDecoder()

  const transformStream = new TransformStream({
    transform(chunk: Uint8Array, controller) {
      let text = decoder.decode(chunk, { stream: true })
      text = filterContent(text)
      text = maskPhoneNumbers(text)
      text = maskEmails(text)
      controller.enqueue(encoder.encode(text))
    },
  })

  return result.toDataStreamResponse({ transform: transformStream })
}
```

**`app/stream-filter/page.tsx`**

```tsx
'use client'

import { useChat } from 'ai/react'

export default function StreamFilterPage() {
  const { messages, input, handleInputChange, handleSubmit, isLoading, error } = useChat({
    api: '/api/stream-filter',
  })

  return (
    <div className="max-w-3xl mx-auto p-4">
      <h1 className="text-2xl font-bold mb-2">流式内容过滤</h1>
      <div className="bg-yellow-50 border border-yellow-200 rounded p-3 mb-4 text-sm text-yellow-800">
        <strong>演示说明：</strong>敏感词（暴力、色情等）将被替换为 ***，手机号和邮箱自动脱敏。
        本页面仅为演示流式过滤机制，实际内容监控需要更完善的方案。
      </div>

      <div className="border rounded-lg h-[450px] overflow-y-auto p-4 mb-4 bg-white">
        {messages.length === 0 && (
          <div className="text-gray-400 text-center mt-32">
            <p>输入消息开始对话</p>
            <p className="text-sm mt-1">可以尝试让 AI 生成包含敏感词或联系方式的文本</p>
          </div>
        )}
        {messages.map((m) => (
          <div key={m.id} className={`mb-4 ${m.role === 'user' ? 'text-right' : 'text-left'}`}>
            <div className={`inline-block px-4 py-2 rounded-lg max-w-[80%] text-left ${
              m.role === 'user' ? 'bg-blue-500 text-white' : 'bg-gray-100'
            }`}>
              <p className="text-xs opacity-60 mb-1">{m.role === 'user' ? '你' : 'AI'}</p>
              <div className="whitespace-pre-wrap text-sm">{m.content}</div>
            </div>
          </div>
        ))}
        {isLoading && (
          <div className="text-center text-gray-400 text-sm">生成中...</div>
        )}
        {error && (
          <div className="text-center text-red-500 text-sm">错误：{error.message}</div>
        )}
      </div>

      <form onSubmit={handleSubmit}>
        <input
          type="text"
          value={input}
          onChange={handleInputChange}
          placeholder="输入消息..."
          className="w-full border rounded px-3 py-2"
          disabled={isLoading}
        />
      </form>
    </div>
  )
}
```

## 10.5 运行验证

### 前提条件

```bash
npm install ai @ai-sdk/openai
echo "OPENAI_API_KEY=sk-your-key" >> .env.local
npm run dev
```

### 验证步骤

**步骤 1：图像识别**

访问 `/vision`，输入图片 URL（如 `https://picsum.photos/seed/1/800/600`）。

预期：AI 返回图片的详细描述，包括主体、色彩、构图等。

**步骤 2：图片上传分析**

访问 `/vision-upload`，点击或拖拽上传本地图片。

预期：图片预览显示，AI 分析结果出现在下方。

**步骤 3：Markdown 实时转换**

访问 `/stream-md`，输入"用 Markdown 格式写一篇关于 TypeScript 的介绍，包含标题、列表、代码块"。

预期：AI 的回答显示为格式化 HTML（标题、列表、代码块有不同样式），而不是原始 Markdown 文本。

**步骤 4：内容过滤**

访问 `/stream-filter`，输入"生成一段包含手机号 13800138000 和邮箱 test@example.com 的联系方式"。

预期：手机号显示为 `138****8000`，邮箱显示为 `te***@example.com`。

### 调试技巧

```bash
# 在 TransformStream 中打印日志
transform(chunk, controller) {
  const text = decoder.decode(chunk)
  console.log('Chunk received:', text.length, 'chars')
  controller.enqueue(encoder.encode(text))
}
```

## 10.6 常见问题

### Q1: 多模态请求返回 400 错误？

常见原因：
- **图片 URL 不可访问**：确保 URL 是公开可访问的，不需要登录
- **图片格式不支持**：GPT-4o 支持 JPEG、PNG、GIF、WebP
- **图片太大**：建议压缩到 20MB 以内
- **CORS 限制**：某些图片源拒绝 AI 服务商的请求，尝试用直链

### Q2: TransformStream 中的编码问题？

```typescript
// 正确的编码/解码方式
const encoder = new TextEncoder()
const decoder = new TextDecoder()
const transform = new TransformStream({
  transform(chunk: Uint8Array, controller) {
    // 解码时要加 { stream: true }，处理不完整的字符
    const text = decoder.decode(chunk, { stream: true })
    // 处理文本...
    controller.enqueue(encoder.encode(text))
  },
})
```

关键点：
- `TextDecoder` 必须加 `{ stream: true }` 参数
- `TextEncoder` 输出 `Uint8Array`
- Chunk 边界可能切在 UTF-8 字符中间，`{ stream: true }` 处理这个问题

### Q3: TransformStream 会显著增加延迟吗？

不会。TransformStream 的处理是同步的，每个 chunk 的处理时间通常在微秒级别，不会对用户体验产生可感知的延迟。

但如果你的转换逻辑涉及异步操作（如调用外部 API），就需要特别小心——这会阻塞整个流。

```typescript
// ❌ 错误：异步操作阻塞流
async transform(chunk, controller) {
  const result = await someApiCall(chunk)  // 阻塞！
  controller.enqueue(result)
}

// ✓ 正确：只做同步处理
transform(chunk, controller) {
  const result = syncProcess(chunk)
  controller.enqueue(result)
}
```

### Q4: useChat 和 TransformStream 如何配合？

`useChat` 自动解析 `toDataStreamResponse()` 返回的数据流。你只需要在服务端配置 transform：

```typescript
// 服务端
return result.toDataStreamResponse({ transform: myTransform })

// 客户端 useChat 自动接收转换后的数据
const { messages, input, handleInputChange, handleSubmit } = useChat()
```

### Q5: 如何同时传输原始内容和转换后内容？

可以在 TransformStream 的 `flush` 中发送元数据：

```typescript
new TransformStream({
  transform(chunk, controller) {
    // 正常处理
    controller.enqueue(chunk)
  },
  flush(controller) {
    const encoder = new TextEncoder()
    // 在流结束时附加元数据
    controller.enqueue(encoder.encode('\n\n<!-- filtered: true -->'))
  },
})
```

## 10.7 本章小结

本章介绍了两个强大的 AI 应用能力：

**多模态输入**：
- 使用 `content` 数组传递文本和图片
- 支持 URL 和 Base64 两种图片格式
- GPT-4o / Claude 3.5 Sonnet 等模型原生支持多模态
- 在 API Route 中处理图片分析，在前端实现文件上传和预览

**流式中间件**：
- TransformStream 的工作原理：intercept → transform → forward
- 实时 Markdown → HTML 转换
- 内容安全过滤：敏感词屏蔽、手机号/邮箱脱敏
- 编码注意事项：TextDecoder 的 `{ stream: true }` 参数

多模态和流式中间件是两个互补的能力——一个扩展了 AI 的输入类型，一个增强了对 AI 输出的控制。在下一章中，我们将学习如何通过链式编排和并行调用构建更复杂的 AI 工作流。
