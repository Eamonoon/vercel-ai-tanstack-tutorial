# 附录B 技术栈对比与选型参考

## 目录

- [B.1 Vercel AI SDK vs LangChain.js](#b1-vercel-ai-sdk-vs-langchainjs)
- [B.2 Vercel AI SDK v3 → v4 迁移指南](#b2-vercel-ai-sdk-v3--v4-迁移指南)
- [B.3 Provider 对比](#b3-provider-对比)
- [B.4 向量数据库对比](#b4-向量数据库对比)
- [B.5 部署平台对比](#b5-部署平台对比)

---

## B.1 Vercel AI SDK vs LangChain.js

### B.1.1 核心理念对比

| 维度 | Vercel AI SDK | LangChain.js |
|------|---------------|-------------|
| **定位** | 轻量级 AI 集成框架 | 全栈 LLM 应用框架 |
| **设计哲学** | 简洁、类型安全、流式优先 | 高度抽象、模块化、生态丰富 |
| **包体积** | 小（核心包 <100KB） | 大（核心包 + 大量集成包） |
| **学习曲线** | 平缓，几分钟上手 | 陡峭，需要理解 Chain/Agent/Tool 等概念 |
| **TypeScript 支持** | 原生、一流 | 良好，但有较多类型洞 |
| **流式输出** | 一等公民，原生支持 | 需要额外配置 |
| **React 集成** | 内置 `useChat`、`useAssistant` | 通过 LangChain.js + 社区库 |

### B.1.2 何时使用 Vercel AI SDK

- **Next.js 项目**：需要快速集成 AI 能力的全栈应用
- **流式 UI 优先**：聊天机器人、实时内容生成等需要流式输出的场景
- **轻量级需求**：不需要复杂的 Chain/Agent 编排
- **团队 TypeScript 经验丰富**：希望利用类型安全减少运行时错误
- **快速原型到生产**：从 MVP 到规模化部署的平滑过渡

**典型项目**：AI 客服、内容生成工具、智能搜索、教育应用

### B.1.3 何时使用 LangChain.js

- **复杂 RAG 流水线**：多步检索、重排序、压缩等高级 RAG 策略
- **多模型编排**：需要多个模型协同工作（如分类 → 生成 → 评估）
- **已有 LangChain 生态投资**：使用了 LangSmith、LangServe 等工具
- **非 Node.js 环境**：Python 生态优先，但 JS 版本也在快速完善
- **需要和外部系统深度集成**：大量预构建的集成组件

**典型项目**：企业级 RAG 系统、AI Agent 平台、自动化工作流

### B.1.4 共存策略

两者并不互斥。可在 Vercel AI SDK 项目中按需引入 LangChain.js 的特定组件：

```typescript
import { streamText } from 'ai';
import { openai } from '@ai-sdk/openai';
// 仅引入 LangChain 的文本分割器
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';

// 使用 Vercel AI SDK 生成
const result = streamText({
  model: openai('gpt-4o'),
  prompt: userQuery,
});

// 使用 LangChain 的文本分割器处理文档
const splitter = new RecursiveCharacterTextSplitter({
  chunkSize: 1000,
  chunkOverlap: 200,
});
const chunks = await splitter.splitText(document);
```

---

## B.2 Vercel AI SDK v3 → v4 迁移指南

### B.2.1 主要变更

| 变更项 | v3 | v4 |
|--------|-----|-----|
| Node.js 要求 | >= 18 | >= 18 |
| TypeScript 要求 | >= 4.x | >= 5.x |
| 核心包 | `ai` | `ai`（升级到 4.x） |
| React Hooks | `ai/react` | `@ai-sdk/react` |
| OpenAI Provider | `@ai-sdk/openai` 0.x | `@ai-sdk/openai` 1.x |
| Anthropic Provider | `@ai-sdk/anthropic` 0.x | `@ai-sdk/anthropic` 1.x |

### B.2.2 Import 路径变更

```typescript
// v3（旧）
import { useChat } from 'ai/react';
import { OpenAI } from '@ai-sdk/openai'; // 旧版 Provider 创建方式

// v4（新）
import { useChat } from '@ai-sdk/react';
import { createOpenAI } from '@ai-sdk/openai';
```

### B.2.3 Provider 创建方式

**v3 方式**：

```typescript
import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});
```

**v4 方式**（使用 `@ai-sdk/openai`）：

```typescript
import { createOpenAI } from '@ai-sdk/openai';

const openai = createOpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// 获取模型实例
const model = openai('gpt-4o');
```

### B.2.4 流式 API

**v3**：

```typescript
import { streamText } from 'ai';

const result = await streamText({
  model: openai.chat('gpt-4o'),
  prompt: '...',
});

return new Response(result.toAIStream());
```

**v4**：

```typescript
import { streamText } from 'ai';

const result = await streamText({
  model: openai('gpt-4o'),
  prompt: '...',
});

// 推荐使用 toDataStreamResponse()
return result.toDataStreamResponse();
```

### B.2.5 迁移检查清单

- [ ] 将 `ai` 升级到 4.x
- [ ] 将 `@ai-sdk/openai` 升级到 1.x
- [ ] 将 `@ai-sdk/anthropic` 升级到 1.x
- [ ] 添加 `@ai-sdk/react` 依赖
- [ ] 将所有 `ai/react` 导入改为 `@ai-sdk/react`
- [ ] 将 Provider 创建方式改为 `createOpenAI()` / `createAnthropic()`
- [ ] 将 `toAIStream()` 改为 `toDataStreamResponse()`
- [ ] 更新 `model: openai.chat(...)` 为 `model: openai(...)`

---

## B.3 Provider 对比

### B.3.1 综合对比

| 特性 | OpenAI | Anthropic | Google Gemini | 开源模型 |
|------|--------|-----------|---------------|---------|
| **代表模型** | GPT-4o, GPT-4o-mini | Claude Sonnet 4, Claude Haiku 3.5 | Gemini 2.0 Flash, Gemini 1.5 Pro | Llama 3, Qwen 2.5 |
| **中文能力** | 优秀 | 优秀 | 良好 | 优秀（Qwen） |
| **Tool Calling** | 原生支持，稳定 | 原生支持，稳定 | 支持 | 部分支持 |
| **流式输出** | SSE | SSE | SSE | 取决于部署 |
| **上下文窗口** | 128K | 200K | 1M | 32K-128K |
| **多模态** | 图片、音频 | 图片 | 图片、音频、视频 | 图片 |
| **价格（输出/1M tokens）** | $10（GPT-4o） | $15（Sonnet 4） | $0.40（Flash） | 免费自托管 |
| **速率限制** | 较严格 | 适中 | 宽松 | 无限制 |

### B.3.2 选型建议

| 场景 | 推荐 Provider | 理由 |
|------|-------------|------|
| 通用对话、客服 | OpenAI GPT-4o-mini | 性价比最优，工具调用稳定 |
| 长文档分析、写作 | Anthropic Claude Sonnet 4 | 200K 上下文窗口，中文写作质量高 |
| 多模态理解 | Google Gemini 2.0 Flash | 原生支持多模态，价格低廉 |
| 高并发、低延迟 | OpenAI GPT-4o-mini / Gemini Flash | 响应速度快 |
| 数据安全、私有部署 | 开源模型（Qwen、Llama） | 完全自控，无数据泄露风险 |
| 代码生成 | Anthropic Claude | 代码理解和生成能力突出 |

### B.3.3 Provider 切换实现

```typescript
import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';

const openai = createOpenAI({ apiKey: process.env.OPENAI_API_KEY });
const anthropic = createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const google = createGoogleGenerativeAI({ apiKey: process.env.GOOGLE_API_KEY });

export function getModel(provider: string, modelName?: string) {
  switch (provider) {
    case 'openai':
      return openai(modelName || 'gpt-4o');
    case 'anthropic':
      return anthropic(modelName || 'claude-sonnet-4-20250514');
    case 'google':
      return google(modelName || 'gemini-2.0-flash');
    default:
      throw new Error(`Unknown provider: ${provider}`);
  }
}
```

---

## B.4 向量数据库对比

### B.4.1 功能对比

| 特性 | pgvector | Pinecone | Chroma | Weaviate |
|------|---------|---------|--------|----------|
| **类型** | PostgreSQL 扩展 | 托管向量 DB | 嵌入式/客户端 | 自托管/云 |
| **部署方式** | 自托管/云 | 全托管 SaaS | 本地/嵌入 | 自托管/云 SaaS |
| **向量维度** | 最高 2000（可扩展） | 最高 2048 | 无限制 | 无限制 |
| **索引算法** | IVFFlat, HNSW | 专有算法 | HNSW | HNSW |
| **混合搜索** | 原生 SQL + 向量 | 需额外配置 | 支持 | 原生支持 |
| **过滤** | SQL WHERE 条件 | 元数据过滤 | 元数据过滤 | 丰富的过滤语法 |
| **开源** | 是 | 否 | 是 | 是（BSD-3） |
| **Schema 管理** | 原生 SQL | 无 Schema | 无 Schema | 带 Schema |

### B.4.2 选型建议

| 场景 | 推荐方案 | 理由 |
|------|---------|------|
| 已有 PostgreSQL | pgvector | 无需额外基础设施，利用现有数据库 |
| 快速原型、小规模 | Chroma | 本地嵌入，零配置，Python/JS 直接集成 |
| 生产级、大规模 | Pinecone | 托管服务，自动扩缩容，运维成本最低 |
| 需要混合搜索 | Weaviate 或 pgvector | 原生支持向量 + 关键词混合查询 |
| 边缘/离线场景 | Chroma | 轻量级，可嵌入到应用中 |
| 多模态搜索 | Weaviate | 原生支持图片、文本等多模态向量 |

### B.4.3 集成示例（pgvector）

```bash
npm install @vercel/postgres ai @ai-sdk/openai
```

```typescript
import { sql } from '@vercel/postgres';
import { openai } from '@ai-sdk/openai';
import { embed } from 'ai';

export async function searchSimilar(query: string, limit = 5) {
  const { embedding } = await embed({
    model: openai.embedding('text-embedding-3-small'),
    value: query,
  });

  const result = await sql`
    SELECT content, title, 1 - (embedding <=> ${JSON.stringify(embedding)}::vector) AS similarity
    FROM documents
    ORDER BY similarity DESC
    LIMIT ${limit}
  `;

  return result.rows;
}
```

---

## B.5 部署平台对比

### B.5.1 综合对比

| 特性 | Vercel | Docker 自托管 | 云服务器 (ECS/EC2) | Kubernetes |
|------|--------|-------------|-------------------|------------|
| **部署复杂度** | 极低 | 中等 | 中等 | 高 |
| **冷启动** | 有（免费版明显） | 无 | 无 | 无 |
| **扩缩容** | 自动 | 手动 | 手动/自动 | 自动 |
| **成本（低流量）** | 免费额度充足 | 服务器费用 | 服务器费用 | 较高 |
| **超时限制** | 10s（免费）/60s-900s（Pro） | 无限制 | 无限制 | 无限制 |
| **数据库持久化** | 需外部 DB | Volume 挂载 | 本地/云盘 | PVC |
| **CI/CD 集成** | GitHub 自动部署 | Docker Compose | 需配置 | GitOps |
| **域名/SSL** | 自动 | 手动 | 手动/自动 | 手动 |
| **适合场景** | 小型到中型 Next.js | 中型到大型应用 | 各类应用 | 大规模微服务 |

### B.5.2 选型建议

**选择 Vercel 当**：
- 项目基于 Next.js
- 团队规模小，希望最小化运维
- API 超时在平台限制范围内
- 不需要本地文件持久化

**选择 Docker 当**：
- 需要长期运行的进程
- 已经在使用容器化部署
- 需要自定义网络/存储配置
- API 生成时间超过 Vercel 限制

**选择云服务器当**：
- 需要完全控制服务器配置
- 部署非 Node.js 应用
- 需要 GPU 资源（自托管模型）
- 已有成熟的运维体系

**选择 Kubernetes 当**：
- 微服务架构，多个服务协同
- 需要精细的资源调度和扩缩容
- 跨可用区高可用要求
- 已有 Kubernetes 基础设施

### B.5.3 混合部署策略

在实际项目中，可以结合多种部署方式：

```
┌─────────────────┐     ┌──────────────────┐
│   Vercel        │     │   Docker (VPS)    │
│  (Frontend)     │ ←─→ │  (API + AI)       │
│  静态资源/CDN   │     │  长时间任务        │
└─────────────────┘     └──────────────────┘
         │                       │
         ↓                       ↓
┌──────────────────────────────────┐
│         Data Layer               │
│  Neon (PostgreSQL) + Turso DB    │
└──────────────────────────────────┘
```

前端静态资源和轻量 API 部署在 Vercel，需要长时间运行的 AI 生成任务通过 Docker 部署，数据库使用云服务。这种方式兼顾了开发效率和运行灵活性。
