# 第4章 流式输出与前端集成

## 4.1 概述

第3章学习了 `generateText`。本章深入**流式输出**，这是构建 AI 聊天应用的核心技术。

### 为什么需要流式

| 对比维度 | 非流式 (generateText) | 流式 (streamText) |
|----------|----------------------|-------------------|
| TTFB | 等待完整响应（5-30秒） | 几百毫秒看到首个 token |
| 用户体验 | 白屏等待 | 打字机效果，即时反馈 |
| 网络传输 | 一次性传输 | 分块传输，渐进式加载 |
| 中断控制 | 无法中途停止 | 支持 abort 取消 |

### 学习目标

- 理解 `streamText` 的工作原理与 API
- 掌握 `useChat` Hook 的使用方法
- 学会管理流式聊天的前端四种状态
- 实现 Provider 切换、中止、重试等交互

### 前置知识

- 已完成第1章的环境搭建
- 理解第2章的 Provider 配置
- 了解 React Hooks 基本用法

---

## 4.2 streamText API 详解

`streamText` 参数与 `generateText` 一致，但返回值是流式的。

### 基本用法

```typescript
import { streamText } from "ai";
import { openai } from "@ai-sdk/openai";

export async function POST(req: Request) {
  const { messages } = await req.json();

  const result = streamText({
    model: openai("gpt-4o"),
    messages,
    system: "你是一名友好的中文助手。",
    maxTokens: 1024,
    temperature: 0.7,
  });

  // 返回 SSE (Server-Sent Events) 流
  return result.toDataStreamResponse();
}
```

### 返回值详解

```typescript
const result = streamText({ model, prompt: "你好" });

// 1. 转换为 HTTP SSE 响应（最常用）
const response: Response = result.toDataStreamResponse();

// 2. 自定义响应头
const response: Response = result.toDataStreamResponse({
  headers: { "X-Provider": "openai" },
  status: 200,
});

// 3. 直接消费 textStream
for await (const chunk of result.textStream) {
  process.stdout.write(chunk); // 逐块输出
}

// 4. 获取完整文本
const fullText: string = await result.text;

// 5. 完成回调
result.onFinish({ text, finishReason, usage, response });

// 6. 错误回调
result.onError({ error });
```

### 参数说明

`streamText` 接受与 `generateText` 完全相同的参数：

```typescript
streamText({
  model,        // Model 对象（必需）
  messages,     // 或 prompt（二选一）
  system,       // 系统提示词
  maxTokens,    // 最大生成长度
  temperature,  // 随机性
  tools,        // 工具定义（第5章）
  maxSteps,     // 工具调用步数
  abortSignal,  // 取消信号
});
```

---

## 4.3 useChat Hook 详解

`useChat` 是 AI SDK 提供的 React Hook，封装了流式聊天的全部逻辑。

### 基本用法

```typescript
"use client";

import { useChat } from "ai/react";

export default function ChatPage() {
  const {
    messages,            // 消息数组 [{id, role, content}]
    input,               // 输入框当前值
    handleInputChange,   // input onChange 处理器
    handleSubmit,        // form onSubmit 处理器
    isLoading,           // 是否正在加载
    stop,                // 中止生成
    reload,              // 重新生成最后一条回复
    error,               // 错误对象
    append,              // 手动追加消息
    setMessages,         // 直接设置消息数组
  } = useChat({
    api: "/api/chat",       // API Route 地址
    body: { provider: "openai" }, // 附加到请求体的数据
    headers: { "X-Custom": "value" },
    initialMessages: [],     // 初始消息
    onFinish: (message) => {}, // 完成回调
    onError: (error) => {},    // 错误回调
  });

  return (
    <div>
      {messages.map((m) => (
        <div key={m.id}>
          <strong>{m.role}:</strong> {m.content}
        </div>
      ))}
      <form onSubmit={handleSubmit}>
        <input value={input} onChange={handleInputChange} disabled={isLoading} />
        <button type="submit" disabled={isLoading}>发送</button>
      </form>
    </div>
  );
}
```

### 核心交互模式

| 场景 | 方法 | 说明 |
|------|------|------|
| 发送消息 | `handleSubmit(e)` | 提交表单，自动追加消息并触发流式响应 |
| 中止生成 | `stop()` | 立即停止当前流式响应 |
| 重新生成 | `reload()` | 用当前消息列表重新生成最后一条回复 |
| 清空对话 | `setMessages([])` | 清空消息数组 |
| 动态传递参数 | `handleSubmit(e, { body: { provider } })` | 在提交时覆盖 body 参数 |

---

## 4.4 前端 UI 状态管理

流式聊天 UI 有四种核心状态：**就绪 → 加载中 → 完成 / 错误 / 已中止**

### 状态组件

```typescript
"use client";

import { useChat } from "ai/react";
import { useRef, useEffect } from "react";

type Status = "idle" | "loading" | "aborted";

export default function ChatUI() {
  const [status, setStatus] = useState<Status>("idle");
  const bottomRef = useRef<HTMLDivElement>(null);

  const {
    messages, input, handleInputChange, handleSubmit,
    isLoading, stop, reload, error,
  } = useChat({
    api: "/api/chat",
    body: { provider: "openai" },
    onFinish: () => setStatus("idle"),
    onError: () => setStatus("idle"),
  });

  // 检测 loading 变化
  useEffect(() => {
    if (isLoading) setStatus("loading");
  }, [isLoading]);

  // 自动滚动
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  return (
    <div className="max-w-2xl mx-auto p-4">
      <h1 className="text-2xl font-bold mb-4">AI Chat</h1>

      {/* 状态指示器 */}
      {status === "loading" && <p className="text-blue-500 text-sm mb-2">● AI 正在回复...</p>}
      {status === "aborted" && (
        <p className="text-yellow-600 text-sm mb-2">
          ● 已停止 <button onClick={() => reload()} className="text-blue-600 underline ml-2">重新生成</button>
        </p>
      )}

      {/* 消息列表 */}
      <div className="border rounded-lg p-4 mb-4 h-96 overflow-y-auto space-y-3">
        {messages.map((m) => (
          <div key={m.id} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[80%] px-4 py-2 rounded-lg whitespace-pre-wrap ${
              m.role === "user" ? "bg-blue-500 text-white" : "bg-gray-100"
            }`}>{m.content}</div>
          </div>
        ))}
        {isLoading && (
          <div className="flex justify-start">
            <div className="bg-gray-100 px-4 py-2 rounded-lg"><span className="animate-pulse">▊</span></div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* 错误提示 */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded p-3 mb-4 flex justify-between items-center">
          <span className="text-red-700 text-sm">{error.message}</span>
          <button onClick={() => reload()} className="text-red-600 text-sm underline">重试</button>
        </div>
      )}

      {/* 输入区域 */}
      <form onSubmit={handleSubmit} className="flex gap-2">
        <input value={input} onChange={handleInputChange} placeholder="输入消息..."
          disabled={isLoading} className="flex-1 border rounded px-3 py-2 disabled:opacity-50" />

        {isLoading ? (
          <button type="button" onClick={() => { stop(); setStatus("aborted"); }}
            className="bg-red-500 text-white px-4 py-2 rounded hover:bg-red-600">停止</button>
        ) : (
          <button type="submit" disabled={!input.trim()}
            className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 disabled:opacity-50">发送</button>
        )}
      </form>
    </div>
  );
}
```

---

## 4.5 代码示例

### 示例1：流式 API Route

`src/app/api/chat/route.ts`：

```typescript
import { NextRequest } from "next/server";
import { streamText } from "ai";
import { getModel } from "@/lib/ai";

export async function POST(request: NextRequest) {
  try {
    const { messages, provider } = await request.json();
    const model = getModel(provider);

    const result = streamText({
      model,
      messages: [
        { role: "system", content: "你是一名友好的中文助手。请用简洁清晰的语言回答问题。" },
        ...messages,
      ],
      maxTokens: 2048,
      temperature: 0.7,
    });

    return result.toDataStreamResponse({
      headers: { "X-Provider": provider ?? "openai" },
    });
  } catch (error) {
    console.error("Stream Error:", error);
    return new Response(JSON.stringify({ error: "Stream generation failed" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
```

### 示例2：基础聊天组件

`src/app/page.tsx`：

```typescript
"use client";

import { useChat } from "ai/react";

export default function ChatPage() {
  const { messages, input, handleInputChange, handleSubmit, isLoading, error } =
    useChat({ api: "/api/chat", body: { provider: "openai" } });

  return (
    <div className="max-w-2xl mx-auto p-4">
      <h1 className="text-2xl font-bold mb-4">AI Streaming Chat</h1>

      <div className="border rounded-lg p-4 mb-4 h-96 overflow-y-auto space-y-3">
        {messages.length === 0 && <p className="text-gray-400 text-center mt-32">开始对话...</p>}
        {messages.map((m) => (
          <div key={m.id} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[80%] px-4 py-2 rounded-lg whitespace-pre-wrap ${
              m.role === "user" ? "bg-blue-500 text-white" : "bg-gray-100"
            }`}>{m.content}</div>
          </div>
        ))}
        {isLoading && (
          <div className="flex justify-start">
            <div className="bg-gray-100 px-4 py-2 rounded-lg"><span className="animate-pulse">▊</span></div>
          </div>
        )}
      </div>

      {error && <div className="bg-red-50 border rounded p-3 mb-4 text-red-600 text-sm">错误: {error.message}</div>}

      <form onSubmit={handleSubmit} className="flex gap-2">
        <input value={input} onChange={handleInputChange} placeholder="输入消息..."
          disabled={isLoading} className="flex-1 border rounded px-3 py-2 disabled:opacity-50" />
        <button type="submit" disabled={isLoading}
          className="bg-blue-600 text-white px-4 py-2 rounded disabled:opacity-50 hover:bg-blue-700">
          {isLoading ? "..." : "发送"}
        </button>
      </form>
    </div>
  );
}
```

### 示例3：支持 Provider 切换的聊天组件

核心思路：`body` 参数可以是动态的，通过 `handleSubmit(e, { body: { provider } })` 在每次提交时指定。

```typescript
"use client";

import { useChat } from "ai/react";
import { useState } from "react";

export default function ChatWithProviderSwitch() {
  const [provider, setProvider] = useState<"openai" | "anthropic">("openai");

  const { messages, input, handleInputChange, handleSubmit, isLoading, error, stop } =
    useChat({ api: "/api/chat" });

  return (
    <div className="max-w-2xl mx-auto p-4">
      <h1 className="text-2xl font-bold mb-2">AI Chat</h1>

      <div className="mb-4 flex items-center gap-3">
        <label className="text-sm font-medium">Provider:</label>
        <select value={provider} onChange={(e) => setProvider(e.target.value as any)}
          className="border rounded px-2 py-1 text-sm" disabled={isLoading}>
          <option value="openai">OpenAI GPT-4o</option>
          <option value="anthropic">Anthropic Claude</option>
        </select>
      </div>

      <div className="border rounded-lg p-4 mb-4 h-96 overflow-y-auto space-y-3">
        {messages.map((m) => (
          <div key={m.id} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[80%] px-4 py-2 rounded-lg whitespace-pre-wrap ${
              m.role === "user" ? "bg-blue-500 text-white" : "bg-gray-100"
            }`}>{m.content}</div>
          </div>
        ))}
      </div>

      {error && <div className="bg-red-50 border rounded p-3 mb-4 text-red-600 text-sm">{error.message}</div>}

      <form onSubmit={(e) => handleSubmit(e, { body: { provider } })} className="flex gap-2">
        <input value={input} onChange={handleInputChange} placeholder="输入消息..."
          disabled={isLoading} className="flex-1 border rounded px-3 py-2 disabled:opacity-50" />
        {isLoading ? (
          <button type="button" onClick={stop}
            className="bg-red-500 text-white px-4 py-2 rounded hover:bg-red-600">停止</button>
        ) : (
          <button type="submit" disabled={!input.trim()}
            className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 disabled:opacity-50">发送</button>
        )}
      </form>
    </div>
  );
}
```

### 示例4：中止与重试

关键点：`stop()` 中止生成，`reload()` 重新生成最后一条回复，`AbortController` 可在 API Route 端协作超时控制。

```typescript
"use client";

import { useChat } from "ai/react";
import { useState } from "react";

export default function ChatWithAbortRetry() {
  const [aborted, setAborted] = useState(false);

  const { messages, input, handleInputChange, handleSubmit, isLoading, stop, reload, error } =
    useChat({
      api: "/api/chat",
      body: { provider: "openai" },
      onFinish: () => setAborted(false),
    });

  return (
    <div className="max-w-2xl mx-auto p-4">
      <h1 className="text-2xl font-bold mb-4">Chat (Abort & Retry)</h1>

      {aborted && (
        <p className="text-yellow-600 text-sm mb-2">
          ● 已停止 <button onClick={() => reload()} className="text-blue-600 underline ml-2">重新生成</button>
        </p>
      )}

      <div className="border rounded-lg p-4 mb-4 h-96 overflow-y-auto space-y-3">
        {messages.map((m) => (
          <div key={m.id} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[80%] px-4 py-2 rounded-lg whitespace-pre-wrap ${
              m.role === "user" ? "bg-blue-500 text-white" : "bg-gray-100"
            }`}>{m.content}</div>
          </div>
        ))}
      </div>

      {error && (
        <div className="bg-red-50 border rounded p-3 mb-4">
          <p className="text-red-600 text-sm mb-2">{error.message}</p>
          <button onClick={() => reload()} className="text-sm bg-red-100 text-red-700 px-3 py-1 rounded">重试</button>
        </div>
      )}

      <form onSubmit={handleSubmit} className="flex gap-2">
        <input value={input} onChange={handleInputChange} placeholder="输入消息..."
          disabled={isLoading} className="flex-1 border rounded px-3 py-2 disabled:opacity-50" />
        {isLoading ? (
          <button type="button" onClick={() => { stop(); setAborted(true); }}
            className="bg-red-500 text-white px-4 py-2 rounded hover:bg-red-600">停止</button>
        ) : (
          <button type="submit" disabled={!input.trim()}
            className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 disabled:opacity-50">发送</button>
        )}
      </form>

      <p className="text-xs text-gray-400 mt-2">按 Enter 发送 · 停止后可重新生成</p>
    </div>
  );
}
```

---

## 4.6 运行验证

```bash
npm run dev
```

### 测试流程

1. 访问 `http://localhost:3000`，观察打字机效果
2. 生成过程中点击"停止"，验证中止功能
3. 中止后点击"重新生成"，验证恢复功能
4. 切换 Provider，观察不同模型的回复风格
5. 暂时删除 API Key，验证错误提示和重试按钮

### curl 测试流式接口

```bash
curl -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"从1数到5"}],"provider":"openai"}'
```

返回的 SSE 格式：

```
data: {"type":"text","text":"1"}

data: {"type":"text","text":"、2"}

data: {"type":"text","text":"、3"}
...
data: {"type":"finish","finishReason":"stop","usage":{"promptTokens":25,"completionTokens":45,"totalTokens":70}}
```

---

## 4.7 常见问题

### Q1: 流式输出为空或不完整

确认 API Route 返回 `result.toDataStreamResponse()` 而非 `NextResponse.json()`，且 `useChat` 的 `api` 路径正确指向流式端点。

### Q2: `useChat` 报 "Invalid hook call"

`useChat` 必须在 `"use client"` 组件中使用。确保文件顶部包含 `"use client"` 指令。

### Q3: 停止后如何重新生成？

调用 `reload()` 函数。它会使用当前消息列表重新发送最后一次用户消息，触发新的流式响应。

### Q4: 如何清空对话历史？

调用 `setMessages([])`。

### Q5: `useChat` 的 body 参数如何动态更新？

通过 `handleSubmit` 的第二个参数传入覆盖值：

```typescript
handleSubmit(e, { body: { provider: "anthropic" } });
```

### Q6: 流式输出在移动端有性能问题吗？

SSE 流本身很轻量。如果消息列表过长，建议使用虚拟滚动（如 `react-window`）优化长列表渲染。

---

## 4.8 本章小结

已完成：

- ✅ 理解流式输出与 `streamText` 的工作原理
- ✅ 掌握 `toDataStreamResponse` 转换 SSE 响应
- ✅ 学会 `useChat` Hook 的所有参数与返回值
- ✅ 实现消息列表渲染、打字机效果、自动滚动
- ✅ 管理 idle / loading / error / aborted 四种 UI 状态
- ✅ 实现 Provider 切换、中止、重试功能
- ✅ 完成完整的错误处理与重试机制

下一章将介绍**工具调用（Tool Calling）**，让 AI 能够调用外部函数，实现交互式智能应用。
