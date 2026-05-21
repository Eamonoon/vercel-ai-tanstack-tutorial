# Vercel AI SDK + TanStack AI 中文教程

从入门到企业级 Agent 的完整教程，兼容 OpenAI / Anthropic 等多 Provider。

## 技术栈

- Next.js + TypeScript
- Vercel AI SDK (`ai`, `@ai-sdk/openai`, `@ai-sdk/anthropic`)
- TanStack AI (`@tanstack/react-ai`, `@tanstack/start-ai`)

## 目录结构

```
chapters/
├── 01-environment/                  # 环境搭建与项目初始化
├── 02-vercel-ai-sdk-basics/         # Vercel AI SDK 核心概念与基础用法
├── 03-vercel-ai-sdk-advanced/       # Vercel AI SDK 高级特性
├── 04-vercel-ai-sdk-advanced-patterns/  # Vercel AI SDK 高级应用模式
├── 05-vercel-ai-sdk-production/     # Vercel AI SDK 生产就绪实践
├── 06-enterprise-case-1/            # 企业级实战案例（一）
└── 07-enterprise-case-2/            # 企业级实战案例（二）
```

## 快速开始

```bash
# 克隆仓库
git clone https://github.com/Eamonoon/vercel-ai-tanstack-tutorial.git
cd vercel-ai-tanstack-tutorial

# 进入对应章节
cd chapters/01-environment

# 安装依赖
npm install

# 配置环境变量
cp .env.example .env.local
# 编辑 .env.local 填入你的 API Key

# 启动开发服务器
npm run dev
```

## Provider 配置

所有代码兼容以下 Provider：

| Provider | API Key | Base URL |
|----------|---------|----------|
| OpenAI | `OPENAI_API_KEY` | `OPENAI_BASE_URL` |
| Anthropic | `ANTHROPIC_API_KEY` | `ANTHROPIC_BASE_URL` |
| 自定义 | 通过环境变量注入 | 自定义 Base URL |

## License

MIT
