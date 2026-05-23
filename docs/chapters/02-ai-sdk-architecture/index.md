# 第2章 AI SDK 核心架构与 Provider 配置

## 2.1 概述

第1章搭建了项目骨架并成功调用了 AI 接口。本章深入 Vercel AI SDK 的内部架构，重点理解 **Provider 机制**——它是 SDK 灵活性的核心。

### 学习目标

- 理解 AI SDK 的三层架构设计
- 掌握 Provider 工厂函数的工作原理
- 学会独立配置 OpenAI 和 Anthropic Provider
- 掌握 Provider 切换工厂模式的实现
- 能够通过 curl 验证双 Provider

### 前置知识

- 已完成第1章的环境搭建
- 理解基础 TypeScript 类型系统
- 拥有 OpenAI 和 Anthropic 的 API Key

---

## 2.2 AI SDK 架构总览

Vercel AI SDK v4 采用**三层架构**设计：

```
┌──────────────────────────────────────────────┐
│              应用层 (Your App)                 │
│  generateText │ streamText │ generateObject    │
│  useChat │ useCompletion                     │
└──────────────────┬───────────────────────────┘
                   │
┌──────────────────▼───────────────────────────┐
│              核心层 (ai 包)                    │
│  Provider 抽象 │ Tool 系统 │ Stream 处理       │
│  统一 Response 格式 │ 错误处理                │
└──────────────────┬───────────────────────────┘
                   │
┌──────────────────▼───────────────────────────┐
│            Provider 插件层                     │
│  @ai-sdk/openai │ @ai-sdk/anthropic │ ...     │
│  createOpenAI()   createAnthropic()           │
└──────────────────┬───────────────────────────┘
                   │
┌──────────────────▼───────────────────────────┐
│              LLM 服务 (API)                    │
│  OpenAI GPT │ Anthropic Claude │ Google Gemini │
└──────────────────────────────────────────────┘
```

### 各层职责

**应用层**：开发者直接调用的 API。`generateText` 生成完整文本，`streamText` 流式输出，`useChat` 是 React Hook。

**核心层**：SDK 的 `ai` 包。统一了所有 Provider 的调用方式，管理请求/响应的生命周期，提供流式处理的底层原语。

**Provider 插件层**：每个 Provider 是一个独立的 npm 包（`@ai-sdk/openai`、`@ai-sdk/anthropic`）。每个包导出一个工厂函数（`createOpenAI`、`createAnthropic`），返回一个 Provider 实例，该实例暴露创建 Model 对象的方法。

这种设计的好处：

1. **按需安装**：只用 OpenAI 就不需要安装 Anthropic 的包
2. **统一接口**：所有 Provider 提供相同的 API 签名
3. **易于扩展**：社区可以为任意 AI 服务编写 Provider

---

## 2.3 Provider 模型详解

Provider 的核心产出是一个 **Model 对象**——它是你可以传递给 `generateText`、`streamText` 等函数的 `model` 参数。

### 工厂函数的工作流

```
工厂函数接收配置参数
    │
    ▼
创建 Provider 实例（携带 apiKey、baseURL 等配置）
    │
    ▼
调用 Provider 实例（传入模型名称）
    │
    ▼
返回 Model 对象（可传递给 generateText 等函数）
```

### createOpenAI

```typescript
import { createOpenAI } from "@ai-sdk/openai";

// 创建 OpenAI Provider 实例
const openai = createOpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  // 可选：自定义 baseURL（兼容 OpenAI 接口的服务）
  // baseURL: "https://api.openai.com/v1",
});

// 通过调用实例获取具体的 Model 对象
const model = openai("gpt-4o");

// model 对象可直接用于 generateText/streamText
```

### createAnthropic

```typescript
import { createAnthropic } from "@ai-sdk/anthropic";

// 创建 Anthropic Provider 实例
const anthropic = createAnthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
  // 可选：自定义 baseURL
  // baseURL: "https://api.anthropic.com",
});

// 获取具体的 Claude Model 对象
const model = anthropic("claude-sonnet-4-20250514");
```

### 核心接口

Provider 实例的类型签名概览：

```typescript
type ProviderInstance = (modelId: string) => Model;

type Model = {
  // SDK 内部使用的方法签名（开发者无需手动调用）
  readonly provider: string;
  readonly modelId: string;
};
```

> 开发者不需要直接操作 Model 对象的内部方法，只需将它作为 `model` 参数传入 `generateText` / `streamText` 等 API 即可。

---

## 2.4 配置 OpenAI Provider

### 基本配置

```typescript
import { createOpenAI } from "@ai-sdk/openai";

const openai = createOpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});
```

### 可选参数

```typescript
const openai = createOpenAI({
  apiKey: process.env.OPENAI_API_KEY,

  // 自定义 API 地址（兼容 OpenAI 接口的第三方服务）
  baseURL: "https://api.openai.com/v1",

  // 自定义请求头
  headers: {
    "X-Custom-Header": "value",
  },

  // 请求超时（毫秒）
  timeout: 30000,

  // 是否提取中间思考步骤（用于 reasoning 模型）
  // extractThinking: true,
});
```

### 常用模型

| 模型 | 特点 |
|------|------|
| `gpt-4o` | 多模态旗舰模型，支持文本+图片输入 |
| `gpt-4o-mini` | 轻量版，性价比高 |
| `gpt-4-turbo` | 上一代旗舰 |
| `o1` | 推理模型，适合复杂逻辑 |
| `o1-mini` | 推理模型轻量版 |

### 使用方式

```typescript
// 获取模型
const model = openai("gpt-4o");

// 传递额外参数
const model = openai("gpt-4o", {
  // 某些 Provider 支持在模型层面设置额外参数
});
```

---

## 2.5 配置 Anthropic Provider

### 基本配置

```typescript
import { createAnthropic } from "@ai-sdk/anthropic";

const anthropic = createAnthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});
```

### 可选参数

```typescript
const anthropic = createAnthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,

  // 自定义 API 地址
  baseURL: "https://api.anthropic.com",

  // 自定义请求头
  headers: {
    "X-Custom-Header": "value",
  },

  // 请求超时（毫秒）
  timeout: 60000,
});
```

### 常用模型

| 模型 | 特点 |
|------|------|
| `claude-sonnet-4-20250514` | 最新旗舰，平衡性能与速度 |
| `claude-3-5-sonnet-20241022` | 上一代旗舰，稳定可靠 |
| `claude-3-haiku-20240307` | 轻量快速，适合简单任务 |
| `claude-3-opus-20240229` | 深度推理，适合复杂分析 |

### 使用方式

```typescript
const model = anthropic("claude-sonnet-4-20250514");
```

---

## 2.6 双 Provider 切换工厂

### 工厂函数实现

创建 `src/lib/ai/provider.ts`：

```typescript
import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";

type ProviderType = "openai" | "anthropic";

type ProviderConfig = {
  openai: { apiKey: string; model?: string };
  anthropic: { apiKey: string; model?: string };
  defaultProvider?: ProviderType;
};

export function createProviderFactory(config: ProviderConfig) {
  const openai = createOpenAI({ apiKey: config.openai.apiKey });
  const anthropic = createAnthropic({ apiKey: config.anthropic.apiKey });

  function getModel(provider?: ProviderType) {
    const selected = provider ?? config.defaultProvider ?? "openai";

    switch (selected) {
      case "openai":
        return openai(config.openai.model ?? "gpt-4o");
      case "anthropic":
        return anthropic(config.anthropic.model ?? "claude-sonnet-4-20250514");
      default:
        throw new Error(`Unknown provider: ${selected}`);
    }
  }

  return {
    getModel,
    openai,
    anthropic,
  };
}
```

### 与 env 集成

创建 `src/lib/ai/index.ts`：

```typescript
import { env } from "@/env";
import { createProviderFactory } from "./provider";

export const { getModel, openai, anthropic } = createProviderFactory({
  openai: {
    apiKey: env.OPENAI_API_KEY,
    model: env.OPENAI_MODEL,
  },
  anthropic: {
    apiKey: env.ANTHROPIC_API_KEY,
    model: env.ANTHROPIC_MODEL,
  },
  defaultProvider: env.DEFAULT_PROVIDER as "openai" | "anthropic",
});
```

### 在 API Route 中使用

```typescript
import { NextRequest, NextResponse } from "next/server";
import { generateText } from "ai";
import { getModel } from "@/lib/ai";

export async function POST(request: NextRequest) {
  const { prompt, provider } = await request.json();

  const model = getModel(provider);

  const { text } = await generateText({
    model,
    prompt,
  });

  return NextResponse.json({ text, provider: provider ?? "openai" });
}
```

### 流式双 Provider API

```typescript
import { NextRequest } from "next/server";
import { streamText } from "ai";
import { getModel } from "@/lib/ai";

export async function POST(request: NextRequest) {
  const { messages, provider } = await request.json();

  const model = getModel(provider);

  const result = streamText({
    model,
    messages,
  });

  return result.toDataStreamResponse();
}
```

---

## 2.7 运行验证

### 启动服务器

```bash
npm run dev
```

### 测试 OpenAI

```bash
curl -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [{"role":"user","content":"用一句话介绍 AI SDK"}],
    "provider": "openai"
  }'
```

预期返回：

```json
{
  "text": "Vercel AI SDK 是一个统一的 TypeScript 库，用于构建流式 AI 应用。",
  "provider": "openai"
}
```

### 测试 Anthropic

```bash
curl -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [{"role":"user","content":"用一句话介绍 AI SDK"}],
    "provider": "anthropic"
  }'
```

### 测试流式接口

```bash
curl -X POST http://localhost:3000/api/chat/stream \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [{"role":"user","content":"从1数到5"}],
    "provider": "openai"
  }'
```

流式接口会分块返回 SSE（Server-Sent Events）格式的数据，每块包含一段文本 token。

### 双 Provider 对比

用同一个 prompt 分别请求两个 Provider，观察：

| 对比维度 | OpenAI GPT-4o | Anthropic Claude |
|---------|---------------|-----------------|
| 响应风格 | 直接、简洁 | 结构化、详细 |
| 中文能力 | 良好 | 优秀 |
| 响应速度 | 较快 | 稍慢但稳定 |

---

## 2.8 常见问题

### Q1: Provider 和 Model 的关系是什么？

Provider 是"工厂"，Model 是"产品"。`createOpenAI()` 创建工厂（Provider 实例），`openai("gpt-4o")` 生产具体的 Model 对象。`generateText()` 接收的就是 Model 对象。

### Q2: 一个项目可以同时使用多个 Provider 吗？

可以。一个项目内可以创建多个 Provider 实例，甚至可以多次调用同一 Provider 的不同模型。通过工厂函数模式可以优雅地管理多 Provider。

### Q3: 如何添加自定义 baseURL？

在工厂函数的配置中传入 `baseURL` 参数：

```typescript
const openai = createOpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: "https://your-proxy.com/v1",
});
```

这适用于使用兼容 OpenAI 接口的代理或私有部署模型。

### Q4: Provider 和 Model 是一对一的关系吗？

不是。一个 Provider 实例可以创建多个 Model 对象，对应不同模型：

```typescript
const gpt4o = openai("gpt-4o");
const gpt4oMini = openai("gpt-4o-mini");
```

### Q5: 如何获取当前使用的 Provider 名称？

可以直接从 Model 对象的 `modelId` 字段读取，或者在请求返回中包含 `provider` 信息（如代码示例中显示 "openai" 或 "anthropic"）。

### Q6: `@ai-sdk/openai` 和 `openai` npm 包有什么区别？

`@ai-sdk/openai` 是 Vercel AI SDK 的官方 Provider 插件，提供与 AI SDK 核心 API 兼容的接口。`openai` 是 OpenAI 官方的 Node.js SDK，API 风格完全不同。在本书中统一使用 `@ai-sdk/openai`。

---

## 2.9 本章小结

已完成：

- ✅ 理解 AI SDK 的三层架构（应用层 → 核心层 → Provider 层）
- ✅ 学会使用 `createOpenAI` / `createAnthropic` 工厂函数
- ✅ 掌握 Provider 实例化参数与模型选择
- ✅ 实现双 Provider 切换工厂模式
- ✅ 编写支持双 Provider 的 API Route
- ✅ 通过 curl 验证两个 Provider

下一章将深入 **`generateText` API**，掌握提示词构建、参数调优与错误处理的最佳实践。
