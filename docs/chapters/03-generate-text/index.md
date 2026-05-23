# 第3章 文本生成：generateText 深入详解

## 3.1 概述

第2章理解了 AI SDK 的架构。本章聚焦最核心的 API——**`generateText`**，它是所有文本生成操作的基础。

### 学习目标

- 理解 `generateText` 与 `streamText` 的适用场景
- 掌握 `generateText` 所有参数与返回值
- 学会构建高效的 Prompt
- 掌握错误处理与重试机制
- 能够编写多轮对话和分类任务

### 前置知识

- 已完成第1章的环境搭建
- 理解第2章的 Provider 基本概念

---

## 3.2 generateText API 详解

### 适用场景对比

| 场景 | 推荐 API |
|------|---------|
| 翻译、总结、分类 | `generateText` |
| 代码生成、数据提取 | `generateText` |
| 聊天 UI（打字机效果） | `streamText` |
| 长时间推理（逐步输出） | `streamText` |

核心原则：用户需要等待完整结果才看到内容，用 `generateText`；需要逐字展示给用户，用 `streamText`。

### 参数签名

```typescript
import { generateText } from "ai";

const result = await generateText({
  model: openai("gpt-4o"),       // 必需：Model 对象
  prompt: "你好",                  // 二选一：简单输入
  messages: [                      // 二选一：多轮对话
    { role: "system", content: "你是助手。" },
    { role: "user", content: "你好" },
  ],
  system: "你是一名中文助手。",     // 可选：系统提示词
  maxTokens: 1024,                 // 可选：最大生成 token
  temperature: 0.7,                // 可选：随机性 (0-2)
  topP: 1,                         // 可选：核采样
  presencePenalty: 0,              // 可选：话题多样性
  frequencyPenalty: 0,             // 可选：重复惩罚
  stopSequences: ["\n\n"],         // 可选：停止标记
  abortSignal: AbortSignal.timeout(30000), // 可选：超时控制
});
```

### 参数详解

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `model` | `Model` | 是 | Provider 创建的 Model 对象 |
| `prompt` | `string` | 二选一 | 简单单轮输入 |
| `messages` | `Message[]` | 二选一 | 多轮对话消息数组 |
| `system` | `string` | 否 | 系统提示词，设定 AI 角色和行为 |
| `maxTokens` | `number` | 否 | 最大生成 token 数 |
| `temperature` | `number` | 否 | 随机性 0-2，默认 0.7 |
| `topP` | `number` | 否 | 核采样 0-1，默认 1 |
| `presencePenalty` | `number` | 否 | 话题多样性 -2 到 2 |
| `frequencyPenalty` | `number` | 否 | 重复惩罚 -2 到 2 |
| `stopSequences` | `string[]` | 否 | 停止生成的标记 |
| `abortSignal` | `AbortSignal` | 否 | 用于取消请求 |

### 返回值

```typescript
const result = await generateText({ model, prompt: "你好" });

result.text;          // 生成的文本内容
result.finishReason;  // 结束原因: 'stop' | 'length' | 'content-filter' | 'tool-calls' | 'error' | 'other'
result.usage;         // Token 用量: { promptTokens, completionTokens, totalTokens }
result.response.messages; // 完整的消息数组
result.timings;       // 时间戳信息（可选）
```

### finishReason 详解

| 值 | 含义 | 处理 |
|----|------|------|
| `stop` | 正常结束 | 正常处理 |
| `length` | 达到 maxTokens 上限 | 增大 maxTokens |
| `content-filter` | 被内容过滤器拦截 | 降低 temperature 或修改 prompt |
| `tool-calls` | 模型请求调用工具 | 处理工具调用 |
| `error` | 生成出错 | 检查日志，重试 |

---

## 3.3 Prompt 构建技巧

### 简单 Prompt vs Messages

```typescript
// 简单 prompt——适合单轮无上下文
const { text } = await generateText({
  model: openai("gpt-4o"),
  prompt: "解释什么是量子计算，不超过100字",
});

// Messages——适合多轮对话
const { text } = await generateText({
  model: openai("gpt-4o"),
  messages: [
    { role: "system", content: "你是一名 Python 导师，用简单易懂的方式回答问题。" },
    { role: "user", content: "什么是装饰器？" },
    { role: "assistant", content: "装饰器是一种高阶函数，可以在不修改原函数代码的情况下添加功能。" },
    { role: "user", content: "能给我一个实际的例子吗？" },
  ],
});
```

注意：`prompt` 和 `messages` 不能同时使用。`system` 参数与 `messages` 中的 `system` 角色消息可以同时生效。

### System Prompt 最佳实践

好的 system prompt 应包含角色定义、行为约束和输出格式：

```typescript
const { text } = await generateText({
  model: openai("gpt-4o"),
  system: [
    "你是一名专业的技术文档翻译者。",
    "规则：",
    "- 将英文技术文档翻译成中文",
    "- 保留技术术语不翻译（如 API, SDK, REST）",
    "- 保持代码块格式不变",
    "- 不要添加翻译说明",
  ].join("\n"),
  prompt: "An API is a set of defined rules that enable applications to communicate.",
});
```

### Temperature 调优指南

| temperature | 效果 | 适用场景 |
|-------------|------|---------|
| 0 - 0.2 | 几乎确定的输出 | 分类、数据提取、翻译 |
| 0.3 - 0.5 | 稳定有适度多样性 | 客服、代码生成 |
| 0.6 - 0.8 | 创意与平衡 | 一般对话、写作辅助 |
| 0.9 - 1.5 | 高度创意 | 头脑风暴、诗歌 |

---

## 3.4 错误处理

### 常见错误分类

```typescript
import { generateText } from "ai";

try {
  const { text } = await generateText({
    model: openai("gpt-4o"),
    prompt: "你好",
  });
} catch (error) {
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    if (msg.includes("api key")) console.error("API Key 无效");
    else if (msg.includes("rate limit")) console.error("频率超限，请稍后重试");
    else if (msg.includes("timeout")) console.error("请求超时");
    else if (msg.includes("quota")) console.error("API 额度不足");
    else console.error("未知错误:", error.message);
  }
}
```

### 带退避的重试

```typescript
async function generateTextWithRetry(
  params: Parameters<typeof generateText>[0],
  maxRetries = 3
) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await generateText(params);
    } catch (error) {
      const retryable = ["rate limit", "timeout", "503", "500"];
      const msg = (error as Error).message.toLowerCase();

      if (!retryable.some((s) => msg.includes(s))) throw error;

      if (attempt < maxRetries) {
        await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, attempt - 1)));
      } else {
        throw error;
      }
    }
  }
}
```

---

## 3.5 代码示例

### 示例1：基础文本生成

`src/app/api/generate/route.ts`：

```typescript
import { NextRequest, NextResponse } from "next/server";
import { generateText } from "ai";
import { openai } from "@ai-sdk/openai";

export async function POST(request: NextRequest) {
  try {
    const { prompt } = await request.json();

    const { text, usage, finishReason } = await generateText({
      model: openai("gpt-4o"),
      prompt,
      maxTokens: 500,
    });

    return NextResponse.json({ text, usage, finishReason });
  } catch (error) {
    console.error("Generate Error:", error);
    return NextResponse.json({ error: "生成失败" }, { status: 500 });
  }
}
```

```bash
curl -X POST http://localhost:3000/api/generate \
  -H "Content-Type: application/json" \
  -d '{"prompt":"用一句话解释什么是 REST API"}'
```

预期返回：
```json
{
  "text": "REST API 是一种基于 HTTP 协议、利用 GET/POST/PUT/DELETE 等方法对资源进行增删改查的 API 设计规范。",
  "usage": { "promptTokens": 21, "completionTokens": 48, "totalTokens": 69 },
  "finishReason": "stop"
}
```

### 示例2：多轮对话

`src/app/api/chat/multi-turn/route.ts`：

```typescript
import { NextRequest, NextResponse } from "next/server";
import { generateText } from "ai";
import { openai } from "@ai-sdk/openai";

export async function POST(request: NextRequest) {
  try {
    const { messages } = await request.json();

    const { text } = await generateText({
      model: openai("gpt-4o"),
      messages: [
        { role: "system", content: "你是一名中文历史老师，用通俗语言回答问题。" },
        ...messages,
      ],
      maxTokens: 800,
      temperature: 0.5,
    });

    return NextResponse.json({ text });
  } catch (error) {
    return NextResponse.json({ error: "对话失败" }, { status: 500 });
  }
}
```

```bash
curl -X POST http://localhost:3000/api/chat/multi-turn \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"秦始皇最重大的贡献是什么？"}]}'
```

### 示例3：文本分类

`src/app/api/classify/route.ts`：

```typescript
import { NextRequest, NextResponse } from "next/server";
import { generateText } from "ai";
import { openai } from "@ai-sdk/openai";

const CATEGORIES = ["技术", "体育", "娱乐", "政治", "教育", "其他"];

export async function POST(request: NextRequest) {
  try {
    const { text } = await request.json();

    const systemPrompt = [
      "你将收到一段文本，请分类到以下类别之一：",
      CATEGORIES.map((c, i) => `${i + 1}. ${c}`).join("\n"),
      "只输出类别名称，不要包含其他文字。无法确定则输出"其他"。",
    ].join("\n");

    const { text: category } = await generateText({
      model: openai("gpt-4o"),
      system: systemPrompt,
      prompt: text,
      temperature: 0.1,
      maxTokens: 10,
    });

    return NextResponse.json({
      category: category.trim(),
      confidence: CATEGORIES.includes(category.trim()) ? "high" : "low",
    });
  } catch (error) {
    return NextResponse.json({ error: "分类失败" }, { status: 500 });
  }
}
```

```bash
curl -X POST http://localhost:3000/api/classify \
  -H "Content-Type: application/json" \
  -d '{"text":"梅西在世界杯决赛中打入关键进球"}'
```

预期返回：`{"category":"体育","confidence":"high"}`

### 示例4：带重试的鲁棒 API

`src/app/api/generate/robust/route.ts`：

```typescript
import { NextRequest, NextResponse } from "next/server";
import { generateText } from "ai";
import { openai } from "@ai-sdk/openai";

export async function POST(request: NextRequest) {
  try {
    const { prompt } = await request.json();
    if (!prompt || typeof prompt !== "string") {
      return NextResponse.json({ error: "请提供有效的 prompt" }, { status: 400 });
    }

    let lastError: Error | null = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 20000);

        const result = await generateText({
          model: openai("gpt-4o"),
          prompt,
          maxTokens: 1000,
          abortSignal: controller.signal,
        });

        clearTimeout(timeout);
        return NextResponse.json({ success: true, ...result });
      } catch (error) {
        lastError = error as Error;
        clearTimeout(undefined!);
        const msg = lastError.message.toLowerCase();
        if (msg.includes("rate limit") || msg.includes("timeout") || msg.includes("503")) {
          if (attempt < 3) await new Promise((r) => setTimeout(r, 1000 * attempt));
          else throw error;
        } else {
          throw error;
        }
      }
    }
    throw lastError;
  } catch (error) {
    const msg = (error as Error).message;
    if (msg.includes("API key")) return NextResponse.json({ error: "API Key 错误" }, { status: 401 });
    if (msg.includes("quota")) return NextResponse.json({ error: "额度不足" }, { status: 429 });
    return NextResponse.json({ error: "生成失败" }, { status: 500 });
  }
}
```

---

## 3.6 运行验证

```bash
npm run dev
```

| 端点 | 功能 | 测试命令 |
|------|------|---------|
| `/api/generate` | 基础文本生成 | 见示例1 |
| `/api/chat/multi-turn` | 多轮对话 | 见示例2 |
| `/api/classify` | 文本分类 | 见示例3 |
| `/api/generate/robust` | 带重试的 API | 见示例4 |

验证要点：
- 确认 `text` 字段内容正确
- 观察 `usage` 理解每次调用的 token 消耗
- 检查 `finishReason` 是否为 `stop`
- 用不同类别文本测试分类准确性
- 用空 prompt 测试错误响应

---

## 3.7 常见问题

### Q1: `generateText` 和 `streamText` 性能有差异吗？

`generateText` TTFB 更长（需等待完整响应），但总 token 相同。`streamText` 的 TTFB 更短，用户体验更好。

### Q2: `maxTokens` 设置多少合适？

简单问答 200-500，文章生成 1000-2000，代码生成 500-2000，翻译/分类 100-300。未设置时使用模型默认值。

### Q3: temperature 和 topP 可以同时设置吗？

可以，但推荐固定一个、微调另一个。大多数场景下调 `temperature` 即可。

### Q4: `prompt` 和 `messages` 有什么区别？

`prompt` 是简单的字符串，SDK 内部转为 `[{role: "user", content: prompt}]`。`messages` 支持完整的 system/user/assistant 多轮对话。

### Q5: 为什么响应被截断了？

检查 `finishReason`：`length` 表示达到 `maxTokens` 上限，增大该值即可。

### Q6: API 调用总是超时怎么办？

减少 `maxTokens`，使用更快的模型（如 `gpt-4o-mini`），增加超时时间，或开启重试机制。

---

## 3.8 本章小结

已完成：

- ✅ 理解 `generateText` 与 `streamText` 的适用场景
- ✅ 掌握 `generateText` 所有参数和返回值
- ✅ 学会构建 system prompt 和 messages 数组
- ✅ 掌握 temperature 调优方法
- ✅ 实现错误处理与指数退避重试
- ✅ 编写四个实用示例

下一章将学习**流式输出与前端集成**，实现打字机效果的聊天界面。
