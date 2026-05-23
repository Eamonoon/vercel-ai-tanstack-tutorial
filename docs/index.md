# Vercel AI SDK 中文教程

从入门到企业级 Agent 的完整教程，兼容 OpenAI / Anthropic 等多 Provider。

---

## 📖 目录

### 📘 基础篇

| 章节 | 内容 | 难度 |
|------|------|------|
| [第1章 环境搭建与项目初始化](chapters/01-environment/README.md) | Next.js 脚手架、AI SDK 安装、环境变量配置 | ⭐ 入门 |
| [第2章 AI SDK 核心架构与 Provider 配置](chapters/02-ai-sdk-architecture/README.md) | Provider 模型、双 Provider 切换、架构原理 | ⭐ 入门 |
| [第3章 文本生成：generateText 深入](chapters/03-generate-text/README.md) | Prompt 构建、多轮消息、System Prompt、错误处理 | ⭐ 入门 |
| [第4章 流式输出与前端集成](chapters/04-streaming-chat/README.md) | streamText、useChat、打字机效果、UI 状态管理 | ⭐ 入门 |

### 📗 进阶篇

| 章节 | 内容 | 难度 |
|------|------|------|
| [第5章 工具调用（Tool Calling）实战](chapters/05-tool-calling/README.md) | 工具定义、参数校验、真实 API 调用 | ⭐⭐ 进阶 |
| [第6章 结构化输出：generateObject](chapters/06-structured-output/README.md) | Zod Schema、批量处理、多 Schema 输出 | ⭐⭐ 进阶 |
| [第7章 Embedding 与语义搜索](chapters/07-embedding/README.md) | 向量化、相似度计算、向量数据库选型 | ⭐⭐ 进阶 |
| [第8章 Agent 模式与多步推理](chapters/08-agent-patterns/README.md) | Agent 循环、maxSteps、状态管理 | ⭐⭐⭐ 高级 |

### 📙 高级篇

| 章节 | 内容 | 难度 |
|------|------|------|
| [第9章 RAG 检索增强生成](chapters/09-rag/README.md) | 分块策略、向量检索、Prompt 注入、生产优化 | ⭐⭐⭐ 高级 |
| [第10章 多模态与流式中间件](chapters/10-multimodal-stream/README.md) | 图像理解、TransformStream、实时过滤 | ⭐⭐⭐ 高级 |
| [第11章 链式编排与并行调用](chapters/11-chain-parallel/README.md) | 串行管线、并行对比、错误传递 | ⭐⭐⭐ 高级 |
| [第12章 自定义 Provider 与可观测性](chapters/12-custom-provider/README.md) | Provider 封装、监控、日志、缓存 | ⭐⭐⭐ 高级 |

### 📕 生产实践篇

| 章节 | 内容 | 难度 |
|------|------|------|
| [第13章 安全计算与内容合规](chapters/13-security-compliance/README.md) | 安全工具执行、Prompt 注入防御、输出审核 | ⭐⭐⭐ 高级 |
| [第14章 Multi-Agent 协作架构](chapters/14-multi-agent/README.md) | Supervisor 模式、专业化 Agent、任务编排 | ⭐⭐⭐⭐ 企业级 |
| [第15章 生产级错误处理与高可用](chapters/15-error-handling/README.md) | 重试、降级、熔断器、Provider 故障转移 | ⭐⭐⭐⭐ 企业级 |

### 📚 企业实战篇

| 章节 | 内容 | 难度 |
|------|------|------|
| [第16章 AI 智能客服系统](chapters/16-enterprise-case-1/README.md) | RAG + 多 Agent 路由 + 会话管理 + 部署 | ⭐⭐⭐⭐ 企业级 |
| [第17章 AI 内容生成平台](chapters/17-enterprise-case-2/README.md) | 模板引擎 + 流式输出 + 历史管理 + 导出 | ⭐⭐⭐⭐ 企业级 |

### 📋 附录

| 附录 | 内容 |
|------|------|
| [附录A 常见问题与排障](appendix-a.md) | 各章节 FAQ 汇总、常见错误排查 |
| [附录B 技术栈对比与选型](appendix-b.md) | AI SDK vs LangChain、版本迁移指南 |

---

## 🚀 快速开始

```bash
git clone https://github.com/Eamonoon/vercel-ai-tanstack-tutorial.git
cd vercel-ai-tanstack-tutorial/docs/chapters/01-environment
cp .env.example .env.local
# 编辑 .env.local 填入 API Key
npm install && npm run dev
```

## 🔧 Provider 兼容

所有代码兼容以下 Provider，通过环境变量注入：

| Provider | 环境变量 |
|----------|----------|
| OpenAI | `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `OPENAI_MODEL` |
| Anthropic | `ANTHROPIC_API_KEY`, `ANTHROPIC_BASE_URL`, `ANTHROPIC_MODEL` |
| 自定义 | `CUSTOM_*` |

## 📄 License

MIT
