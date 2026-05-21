# Vercel AI SDK + TanStack AI 中文教程

从入门到企业级 Agent 的完整教程，兼容 OpenAI / Anthropic 等多 Provider。

---

## 📖 目录

| 章节 | 内容 | 难度 |
|------|------|------|
| [📦 第1章 环境搭建](chapters/01-environment/README.md) | Next.js 脚手架、AI SDK 安装、多 Provider 配置 | ⭐ 入门 |
| [⚡ 第2章 Vercel AI SDK 基础](chapters/02-vercel-ai-sdk-basics/README.md) | generateText、streamText、useChat | ⭐ 入门 |
| [🚀 第3章 Vercel AI SDK 进阶](chapters/03-vercel-ai-sdk-advanced/README.md) | Tool Calling、Agent 循环、Embedding | ⭐⭐ 进阶 |
| [🧩 第4章 高级应用模式](chapters/04-vercel-ai-sdk-advanced-patterns/README.md) | RAG、多模态、流式中间件、Provider 封装 | ⭐⭐⭐ 高级 |
| [🏭 第5章 生产就绪实践](chapters/05-vercel-ai-sdk-production/README.md) | Multi-Agent、语义缓存、安全合规、错误处理 | ⭐⭐⭐ 高级 |
| [🏪 第6章 企业实战(一)](chapters/06-enterprise-case-1/README.md) | AI 智能客服系统（RAG + 多 Agent 路由） | ⭐⭐⭐⭐ 企业级 |
| [🏗️ 第7章 企业实战(二)](chapters/07-enterprise-case-2/README.md) | AI 内容生成平台（模板引擎 + 流式输出） | ⭐⭐⭐⭐ 企业级 |

## 🚀 快速开始

```bash
git clone https://github.com/Eamonoon/vercel-ai-tanstack-tutorial.git
cd vercel-ai-tanstack-tutorial/chapters/01-environment
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
