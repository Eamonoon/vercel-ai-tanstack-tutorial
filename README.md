# Vercel AI SDK 中文教程

从入门到企业级 Agent 的完整教程，兼容 OpenAI / Anthropic 等多 Provider。

## 技术栈

- Next.js + TypeScript
- Vercel AI SDK (`ai`, `@ai-sdk/openai`, `@ai-sdk/anthropic`)

## 目录结构

```
chapters/
├── 01-environment/                  # 环境搭建与项目初始化
├── 02-ai-sdk-architecture/          # AI SDK 核心架构与 Provider 配置
├── 03-generate-text/                # 文本生成：generateText 深入
├── 04-streaming-chat/               # 流式输出与前端集成
├── 05-tool-calling/                 # 工具调用（Tool Calling）实战
├── 06-structured-output/            # 结构化输出：generateObject
├── 07-embedding/                    # Embedding 与语义搜索
├── 08-agent-patterns/               # Agent 模式与多步推理
├── 09-rag/                          # RAG 检索增强生成
├── 10-multimodal-stream/            # 多模态与流式中间件
├── 11-chain-parallel/               # 链式编排与并行调用
├── 12-custom-provider/              # 自定义 Provider 与可观测性
├── 13-security-compliance/          # 安全计算与内容合规
├── 14-multi-agent/                  # Multi-Agent 协作架构
├── 15-error-handling/               # 生产级错误处理与高可用
├── 16-enterprise-case-1/            # AI 智能客服系统
└── 17-enterprise-case-2/            # AI 内容生成平台
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
