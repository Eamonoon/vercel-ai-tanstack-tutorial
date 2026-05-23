# 第1章 环境搭建与项目初始化

## 1.1 概述

本章将从零搭建基于 **Next.js + TypeScript** 的 AI 应用开发环境，集成 **Vercel AI SDK**，并配置 **OpenAI** 和 **Anthropic** 双 Provider。

### 学习目标

- 掌握 Next.js 项目创建与 TypeScript 配置
- 理解 Vercel AI SDK 的作用与架构层次
- 学会配置 OpenAI + Anthropic 双 Provider
- 掌握环境变量管理与安全实践
- 能够编写第一条 AI API 调用

### 前置知识

- 熟悉 JavaScript / TypeScript 基本语法
- 了解 Node.js 基础概念
- 拥有 OpenAI 或 Anthropic 的 API Key

---

## 1.2 核心概念

### Next.js

Next.js 是一个 React 全栈框架，提供服务端渲染、API Routes、文件系统路由等能力。在 AI 应用中，我们利用它的 **API Routes** 安全地调用 AI 服务——API Key 不会暴露给前端浏览器。

### Vercel AI SDK

Vercel AI SDK（`ai`）是一个统一的 AI 开发工具包，核心能力包括：

- **Streaming 支持**：原生支持文字流式输出，实现打字机效果
- **Provider 抽象**：通过统一接口切换不同 AI 服务，业务代码无需修改
- **React Hooks**：`useChat`、`useCompletion` 等开箱即用的前端 Hook
- **工具调用**：让模型能够调用外部函数（API、数据库等）
- **结构化输出**：强制模型输出符合 JSON Schema 的数据

### Provider 模式

```
你的代码 → Vercel AI SDK → Provider (OpenAI/Anthropic) → LLM
```

Provider 是 SDK 与具体 AI 服务之间的适配层。每个 Provider 封装了一个 AI 服务商的 API 差异。切换 Provider 只需要修改一行代码，业务逻辑完全不变。

### TypeScript

TypeScript 为 AI 应用提供类型安全。AI SDK 本身完全用 TypeScript 编写，所有 API 都有完整的类型定义。在处理 AI 返回的复杂数据结构时，类型系统能大幅减少运行时错误。

---

## 1.3 环境要求

| 工具 | 最低版本 | 推荐版本 |
|------|---------|---------|
| Node.js | 18.x | 20.x+ |
| npm | 9.x | 10.x+ |
| pnpm（可选） | 8.x | 9.x+ |

检查已安装版本：

```bash
node -v
npm -v
```

---

## 1.4 项目初始化

### 1.4.1 创建 Next.js 项目

```bash
npx create-next-app@latest ai-tutorial \
  --typescript \
  --tailwind \
  --eslint \
  --app \
  --src-dir \
  --import-alias "@/*"
```

参数说明：

| 参数 | 说明 |
|------|------|
| `--typescript` | 使用 TypeScript |
| `--tailwind` | 集成 Tailwind CSS |
| `--eslint` | 启用 ESLint |
| `--app` | 使用 App Router |
| `--src-dir` | 源代码放在 `src/` 目录 |
| `--import-alias "@/*"` | 路径别名 |

### 1.4.2 安装 Vercel AI SDK

```bash
cd ai-tutorial

# 安装核心 SDK
npm install ai

# 安装 Provider 包
npm install @ai-sdk/openai
npm install @ai-sdk/anthropic

# 安装 Zod（用于结构化输出和环境变量校验）
npm install zod
```

### 1.4.3 验证 package.json

确保 `package.json` 中包含以下依赖：

```json
{
  "dependencies": {
    "ai": "^4.0.0",
    "@ai-sdk/openai": "^1.0.0",
    "@ai-sdk/anthropic": "^1.0.0",
    "zod": "^3.22.0",
    "next": "^14.0.0",
    "react": "^18.0.0",
    "react-dom": "^18.0.0"
  }
}
```

---

## 1.5 环境变量配置

### 1.5.1 创建环境变量文件

在项目根目录创建 `.env.local`：

```bash
touch .env.local
```

### 1.5.2 配置 API Key

编辑 `.env.local`：

```env
# OpenAI
OPENAI_API_KEY=sk-your-openai-api-key-here
OPENAI_MODEL=gpt-4o

# Anthropic
ANTHROPIC_API_KEY=sk-ant-your-anthropic-api-key-here
ANTHROPIC_MODEL=claude-sonnet-4-20250514

# 可选：设置默认 Provider（openai 或 anthropic）
DEFAULT_PROVIDER=openai
```

> **⚠️ 安全提醒**：`.env.local` 已默认被 `.gitignore` 排除，不会提交到 Git。切勿将 API Key 硬编码在代码中。

### 1.5.3 TypeScript 类型声明

创建 `src/env.ts`，通过 Zod 对环境变量做运行时校验：

```typescript
import { z } from "zod";

const envSchema = z.object({
  OPENAI_API_KEY: z.string().min(1, "OPENAI_API_KEY is required"),
  OPENAI_MODEL: z.string().default("gpt-4o"),
  ANTHROPIC_API_KEY: z.string().min(1, "ANTHROPIC_API_KEY is required"),
  ANTHROPIC_MODEL: z.string().default("claude-sonnet-4-20250514"),
  DEFAULT_PROVIDER: z.enum(["openai", "anthropic"]).default("openai"),
});

export const env = envSchema.parse({
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  OPENAI_MODEL: process.env.OPENAI_MODEL,
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
  ANTHROPIC_MODEL: process.env.ANTHROPIC_MODEL,
  DEFAULT_PROVIDER: process.env.DEFAULT_PROVIDER,
});

export type Env = z.infer<typeof envSchema>;
```

---

## 1.6 Provider 配置

### 1.6.1 创建 Provider 工厂

创建 `src/lib/ai/provider.ts`：

```typescript
import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { env } from "@/env";

const openai = createOpenAI({
  apiKey: env.OPENAI_API_KEY,
});

const anthropic = createAnthropic({
  apiKey: env.ANTHROPIC_API_KEY,
});

export function getModel(provider?: string) {
  const activeProvider = provider ?? env.DEFAULT_PROVIDER;

  switch (activeProvider) {
    case "openai":
      return openai(env.OPENAI_MODEL);
    case "anthropic":
      return anthropic(env.ANTHROPIC_MODEL);
    default:
      throw new Error(`Unknown provider: ${activeProvider}`);
  }
}

export { openai, anthropic };
```

### 1.6.2 创建工具函数库索引

创建 `src/lib/ai/index.ts`：

```typescript
export { getModel, openai, anthropic } from "./provider";
```

---

## 1.7 第一条 AI 调用

### 1.7.1 API Route——文字生成

创建 `src/app/api/chat/route.ts`：

```typescript
import { NextRequest, NextResponse } from "next/server";
import { generateText } from "ai";
import { getModel } from "@/lib/ai";
import { env } from "@/env";

export async function POST(request: NextRequest) {
  try {
    const { messages, provider } = await request.json();
    const model = getModel(provider);

    const result = await generateText({
      model,
      messages: messages.map((m: { role: string; content: string }) => ({
        role: m.role as "user" | "assistant" | "system",
        content: m.content,
      })),
    });

    return NextResponse.json({
      content: result.text,
      provider: provider ?? env.DEFAULT_PROVIDER,
    });
  } catch (error) {
    console.error("Chat API Error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
```

### 1.7.2 流式 API Route

创建 `src/app/api/chat/stream/route.ts`：

```typescript
import { NextRequest } from "next/server";
import { getModel } from "@/lib/ai";
import { streamText } from "ai";

export async function POST(request: NextRequest) {
  try {
    const { messages, provider } = await request.json();
    const model = getModel(provider);

    const result = streamText({
      model,
      messages: messages.map((m: { role: string; content: string }) => ({
        role: m.role as "user" | "assistant" | "system",
        content: m.content,
      })),
    });

    return result.toDataStreamResponse();
  } catch (error) {
    console.error("Stream Chat API Error:", error);
    return new Response("Internal server error", { status: 500 });
  }
}
```

### 1.7.3 前端测试页面

创建 `src/app/page.tsx`：

```typescript
"use client";

import { useState } from "react";

export default function Home() {
  const [input, setInput] = useState("");
  const [response, setResponse] = useState("");
  const [loading, setLoading] = useState(false);
  const [provider, setProvider] = useState("openai");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!input.trim()) return;

    setLoading(true);
    setResponse("");

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [{ role: "user", content: input }],
          provider,
        }),
      });

      const data = await res.json();
      setResponse(data.content);
    } catch (err) {
      setResponse("Error: " + (err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen p-8 max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">AI Tutorial - Chat Demo</h1>

      <div className="mb-4">
        <label className="block text-sm font-medium mb-1">Provider</label>
        <select
          value={provider}
          onChange={(e) => setProvider(e.target.value)}
          className="border rounded px-3 py-2 w-full"
        >
          <option value="openai">OpenAI (GPT-4o)</option>
          <option value="anthropic">Anthropic (Claude)</option>
        </select>
      </div>

      <form onSubmit={handleSubmit} className="mb-4">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="输入你的问题..."
          className="border rounded px-3 py-2 w-full min-h-[100px]"
        />
        <button
          type="submit"
          disabled={loading}
          className="mt-2 bg-blue-600 text-white px-4 py-2 rounded disabled:opacity-50"
        >
          {loading ? "请求中..." : "发送"}
        </button>
      </form>

      {response && (
        <div className="border rounded p-4 bg-gray-50 whitespace-pre-wrap">
          {response}
        </div>
      )}
    </main>
  );
}
```

---

## 1.8 运行验证

### 1.8.1 启动开发服务器

```bash
npm run dev
```

访问 `http://localhost:3000`，应该能看到测试页面。

### 1.8.2 测试流程

1. 选择 Provider（OpenAI / Anthropic）
2. 输入问题（如 "Hello, what can you do?"）
3. 点击发送
4. 查看 AI 返回结果

### 1.8.3 切换 Provider 验证

用同一个问题分别在 OpenAI 和 Anthropic 下测试，观察返回结果的风格差异。无需修改代码，只需在下拉菜单中切换 Provider 即可。

### 1.8.4 流式测试

也可以用 curl 测试流式接口：

```bash
curl -X POST http://localhost:3000/api/chat/stream \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"从1数到5"}],"provider":"openai"}'
```

---

## 1.9 项目目录结构

初始化完成后的项目结构如下：

```
ai-tutorial/
├── .env.local                 # 环境变量（不提交 Git）
├── .gitignore
├── next.config.ts
├── package.json
├── tsconfig.json
├── tailwind.config.ts
├── postcss.config.js
├── src/
│   ├── env.ts                 # 环境变量类型声明与校验
│   ├── app/
│   │   ├── page.tsx           # 测试页面
│   │   ├── globals.css
│   │   ├── layout.tsx
│   │   └── api/
│   │       └── chat/
│   │           ├── route.ts         # 非流式 API
│   │           └── stream/
│   │               └── route.ts     # 流式 API
│   └── lib/
│       └── ai/
│           ├── index.ts             # 统一导出
│           └── provider.ts          # Provider 工厂配置
```

---

## 1.10 常见问题

### Q1: `OPENAI_API_KEY` 未设置

```
Error: OPENAI_API_KEY is required
```

**解决**：确保 `.env.local` 文件存在且包含正确的 API Key，然后重启 dev server。

### Q2: CORS 错误

**解决**：Next.js API Routes 默认同域访问。开发环境下确保前端也运行在 `localhost:3000`。生产环境需配置 CORS 中间件。

### Q3: Provider 切换不生效

**解决**：检查 `DEFAULT_PROVIDER` 环境变量是否拼写正确（全小写 `openai` 或 `anthropic`）。也可以在请求体中显式指定 `provider` 字段。

### Q4: Zod 校验失败

**解决**：`src/env.ts` 中的 `envSchema.parse()` 会在服务器启动时校验所有环境变量。确保所有必填变量均已配置。如果暂时只用一个 Provider，可以放宽校验规则（例如将 `ANTHROPIC_API_KEY` 改为可选）。

### Q5: 安装 `ai` 时版本冲突

**解决**：确保 Next.js 版本 >= 14，React >= 18。如有冲突，尝试：

```bash
npm install ai@latest --legacy-peer-deps
```

### Q6: 流式响应在浏览器中不显示

**解决**：确认服务端使用了 `result.toDataStreamResponse()` 而非 `NextResponse.json()`。前端需要使用 `useChat` Hook 或手动处理 `ReadableStream`。

---

## 1.11 本章小结

已完成：

- ✅ Next.js + TypeScript 项目脚手架搭建
- ✅ Vercel AI SDK 安装与配置
- ✅ OpenAI + Anthropic 双 Provider 配置
- ✅ 环境变量管理与类型安全校验
- ✅ 非流式 + 流式 API Route
- ✅ 前端测试页面
- ✅ 运行验证与 Provider 切换测试

下一章将深入 AI SDK 的**核心架构**，理解 Provider 的工作原理与高级配置方法。
