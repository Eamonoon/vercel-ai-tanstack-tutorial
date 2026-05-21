# 第6章 企业级实战案例一：AI 智能客服系统

## 项目概述

本章将构建一个完整的企业级 AI 智能客服系统，支持多轮对话、知识库检索、人工客服转接、会话历史管理等功能。系统适配 OpenAI 和 Anthropic 双 Provider，实现高可用架构。

### 功能需求

- 多轮对话：支持上下文记忆，连续问答
- 知识库问答：基于企业文档的 RAG（检索增强生成）
- 多 Agent 路由：根据问题类型自动分发到不同专业 Agent
- 会话管理：创建、切换、删除会话
- 人工转接：复杂问题转接人工客服
- 数据统计：对话数量、解决率等基础指标

### 技术栈

- Next.js 14 (App Router) + TypeScript
- Vercel AI SDK (@ai-sdk/react, ai)
- Tailwind CSS + shadcn/ui
- SQLite (Turso/libsql) 或 PostgreSQL
- OpenAI + Anthropic 双 Provider

---

## 架构设计

```
┌─────────────────────────────────────────────────┐
│                    Frontend                      │
│  Next.js App Router + Tailwind CSS + shadcn/ui   │
├─────────────────────────────────────────────────┤
│                 API Routes                       │
│  /api/chat         → 对话流                      │
│  /api/knowledge    → 知识库检索                   │
│  /api/session      → 会话管理                     │
│  /api/agent/route  → Agent 路由分发               │
├─────────────────────────────────────────────────┤
│               AI Layer (Vercel AI SDK)           │
│  ┌──────────┐  ┌──────────┐  ┌──────────────┐   │
│  │ OpenAI   │  │ Anthropic│  │  Agent Router │   │
│  └──────────┘  └──────────┘  └──────────────┘   │
├─────────────────────────────────────────────────┤
│                 Data Layer                       │
│  SQLite (Turso) / PostgreSQL                     │
│  ┌──────────┐  ┌──────────┐  ┌──────────────┐   │
│  │ sessions │  │ messages │  │  knowledge    │   │
│  └──────────┘  └──────────┘  └──────────────┘   │
└─────────────────────────────────────────────────┘
```

---

## 项目初始化

### 创建 Next.js 项目

```bash
npx create-next-app@latest ai-customer-service --typescript --tailwind --eslint
cd ai-customer-service
```

### 安装依赖

```bash
# AI SDK
npm install ai @ai-sdk/react @ai-sdk/openai @ai-sdk/anthropic

# UI 组件
npm install class-variance-authority clsx tailwind-merge lucide-react

# 数据库
npm install @libsql/client

# 工具库
npm install nanoid zod
```

### 配置环境变量

创建 `.env.local`：

```bash
# OpenAI
OPENAI_API_KEY=sk-your-openai-key-here

# Anthropic
ANTHROPIC_API_KEY=sk-ant-your-anthropic-key-here

# 数据库（使用本地 SQLite）
TURSO_DATABASE_URL=file:./data/customer-service.db

# 应用配置
NEXT_PUBLIC_APP_NAME=AI智能客服系统
```

---

## 数据库层

### `lib/db/schema.ts`

```typescript
export interface Session {
  id: string;
  title: string;
  status: 'active' | 'resolved' | 'transferred';
  agent_type: string;
  created_at: number;
  updated_at: number;
}

export interface Message {
  id: string;
  session_id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  created_at: number;
}

export interface KnowledgeDoc {
  id: string;
  title: string;
  content: string;
  category: string;
  created_at: number;
}
```

### `lib/db/index.ts`

```typescript
import { createClient } from '@libsql/client';
import { nanoid } from 'nanoid';
import type { Session, Message, KnowledgeDoc } from './schema';

const client = createClient({
  url: process.env.TURSO_DATABASE_URL || 'file:./data/customer-service.db',
});

export async function initDB() {
  await client.execute(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      agent_type TEXT NOT NULL DEFAULT 'general',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);
  await client.execute(`
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (session_id) REFERENCES sessions(id)
    )
  `);
  await client.execute(`
    CREATE TABLE IF NOT EXISTS knowledge_docs (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      category TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )
  `);
}

export async function createSession(title: string, agentType = 'general'): Promise<Session> {
  const id = nanoid();
  const now = Date.now();
  await client.execute({
    sql: 'INSERT INTO sessions (id, title, status, agent_type, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    args: [id, title, 'active', agentType, now, now],
  });
  return { id, title, status: 'active', agent_type: agentType, created_at: now, updated_at: now };
}

export async function getSessions(limit = 50): Promise<Session[]> {
  const result = await client.execute({
    sql: 'SELECT * FROM sessions ORDER BY updated_at DESC LIMIT ?',
    args: [limit],
  });
  return result.rows as unknown as Session[];
}

export async function addMessage(
  sessionId: string,
  role: 'user' | 'assistant' | 'system',
  content: string
): Promise<Message> {
  const id = nanoid();
  const now = Date.now();
  await client.execute({
    sql: 'INSERT INTO messages (id, session_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)',
    args: [id, sessionId, role, content, now],
  });
  await client.execute({
    sql: 'UPDATE sessions SET updated_at = ? WHERE id = ?',
    args: [now, sessionId],
  });
  return { id, session_id: sessionId, role, content, created_at: now };
}

export async function getMessages(sessionId: string): Promise<Message[]> {
  const result = await client.execute({
    sql: 'SELECT * FROM messages WHERE session_id = ? ORDER BY created_at ASC',
    args: [sessionId],
  });
  return result.rows as unknown as Message[];
}

export async function getKnowledgeDocs(query: string, limit = 3): Promise<KnowledgeDoc[]> {
  const result = await client.execute({
    sql: 'SELECT * FROM knowledge_docs WHERE content LIKE ? LIMIT ?',
    args: [`%${query}%`, limit],
  });
  return result.rows as unknown as KnowledgeDoc[];
}

export async function seedKnowledge() {
  const count = await client.execute('SELECT COUNT(*) as c FROM knowledge_docs');
  if ((count.rows[0] as any).c > 0) return;

  const docs = [
    { title: '退款政策', category: '售后', content: '用户可在购买后 7 天内申请无理由退款。退款将在 3-5 个工作日内原路返回。' },
    { title: '发货说明', category: '物流', content: '工作日 16:00 前下单当日发货。默认使用顺丰快递，通常 2-3 天送达。' },
    { title: '会员权益', category: '会员', content: 'VIP 会员享 9 折优惠、免运费、专属客服。月卡 29 元，年卡 299 元。' },
  ];
  for (const doc of docs) {
    await client.execute({
      sql: 'INSERT INTO knowledge_docs (id, title, content, category, created_at) VALUES (?, ?, ?, ?, ?)',
      args: [nanoid(), doc.title, doc.content, doc.category, Date.now()],
    });
  }
}
```

---

## AI 层 — Agent 路由与双 Provider

### `lib/ai/providers.ts`

```typescript
import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';

export const openai = createOpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

export const anthropic = createAnthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
});

export type ProviderType = 'openai' | 'anthropic';

export function getModel(provider: ProviderType, modelName?: string) {
  if (provider === 'openai') {
    return openai(modelName || 'gpt-4o');
  }
  return anthropic(modelName || 'claude-sonnet-4-20250514');
}
```

### `lib/ai/agents.ts`

```typescript
import { streamText, tool } from 'ai';
import { z } from 'zod';
import { getModel, type ProviderType } from './providers';
import { getKnowledgeDocs, addMessage } from '../db';

const SYSTEM_PROMPTS: Record<string, string> = {
  general: `你是一位专业的客服助手。请友好、准确地回答用户的问题。
如果需要查询知识库，请使用 searchKnowledge 工具。
如果用户的问题超出了你的能力范围，请建议转接人工客服。`,

  technical: `你是一位技术支持专家。擅长解答技术问题、排查故障。
请给出清晰、可操作的解决方案步骤。
如果需要查询知识库，请使用 searchKnowledge 工具。`,

  billing: `你是一位账单与财务专员。擅长解答支付、发票、退款等问题。
如果需要查询知识库，请使用 searchKnowledge 工具。`,
};

export type AgentType = keyof typeof SYSTEM_PROMPTS;

export function detectAgentType(message: string): AgentType {
  const billingKeywords = ['退款', '发票', '支付', '账单', '费用', '价格', '优惠', '折扣', '会员'];
  const techKeywords = ['技术', '故障', '报错', '错误', '安装', '配置', '代码', 'API', 'bug'];

  const lower = message.toLowerCase();
  const billingScore = billingKeywords.filter(k => lower.includes(k)).length;
  const techScore = techKeywords.filter(k => lower.includes(k)).length;

  if (billingScore > techScore) return 'billing';
  if (techScore > billingScore) return 'technical';
  return 'general';
}

export async function chat(
  messages: { role: string; content: string }[],
  sessionId: string,
  provider: ProviderType = 'openai',
  agentType: AgentType = 'general'
) {
  const searchTool = tool({
    description: '搜索企业知识库，获取相关文档内容',
    parameters: z.object({
      query: z.string().describe('搜索关键词'),
    }),
    execute: async ({ query }) => {
      const docs = await getKnowledgeDocs(query);
      return docs.map(d => `[${d.title}](${d.category}): ${d.content}`).join('\n');
    },
  });

  const result = streamText({
    model: getModel(provider),
    system: SYSTEM_PROMPTS[agentType],
    messages: messages.map(m => ({ role: m.role as 'user' | 'assistant', content: m.content })),
    tools: { searchKnowledge: searchTool },
    maxSteps: 5,
    onFinish: async ({ text }) => {
      await addMessage(sessionId, 'assistant', text);
    },
  });

  return result;
}
```

---

## API 路由

### `app/api/chat/route.ts`

```typescript
import { NextRequest } from 'next/server';
import { chat, detectAgentType } from '@/lib/ai/agents';
import { addMessage, getMessages } from '@/lib/db';

export async function POST(req: NextRequest) {
  const { sessionId, message, provider = 'openai' } = await req.json();

  if (!sessionId || !message) {
    return Response.json({ error: '缺少必要参数' }, { status: 400 });
  }

  // 保存用户消息
  await addMessage(sessionId, 'user', message);

  // 检测 Agent 类型
  const agentType = detectAgentType(message);

  // 获取历史消息
  const history = await getMessages(sessionId);

  const result = await chat(
    history.map(m => ({ role: m.role, content: m.content })),
    sessionId,
    provider,
    agentType
  );

  return result.toDataStreamResponse();
}
```

### `app/api/session/route.ts`

```typescript
import { NextRequest } from 'next/server';
import { createSession, getSessions } from '@/lib/db';

export async function GET() {
  const sessions = await getSessions();
  return Response.json(sessions);
}

export async function POST(req: NextRequest) {
  const { title, agentType } = await req.json();
  const session = await createSession(
    title || `新会话 ${new Date().toLocaleString('zh-CN')}`,
    agentType
  );
  return Response.json(session);
}
```

### `app/api/messages/route.ts`

```typescript
import { NextRequest } from 'next/server';
import { getMessages } from '@/lib/db';

export async function GET(req: NextRequest) {
  const sessionId = req.nextUrl.searchParams.get('sessionId');
  if (!sessionId) {
    return Response.json({ error: '缺少 sessionId' }, { status: 400 });
  }
  const messages = await getMessages(sessionId);
  return Response.json(messages);
}
```

### `app/api/agent/route/route.ts`

```typescript
import { NextRequest } from 'next/server';
import { detectAgentType } from '@/lib/ai/agents';

export async function POST(req: NextRequest) {
  const { message } = await req.json();
  const agentType = detectAgentType(message);
  return Response.json({ agentType });
}
```

---

## 前端页面

### `app/layout.tsx`

```typescript
import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'AI 智能客服系统',
  description: '基于 Vercel AI SDK 的企业级 AI 智能客服系统',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN">
      <body className="min-h-screen bg-background font-sans antialiased">
        {children}
      </body>
    </html>
  );
}
```

### `app/globals.css`

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  :root {
    --background: 0 0% 100%;
    --foreground: 222.2 84% 4.9%;
    --primary: 221.2 83.2% 53.3%;
    --primary-foreground: 210 40% 98%;
    --muted: 210 40% 96.1%;
    --muted-foreground: 215.4 16.3% 46.9%;
    --border: 214.3 31.8% 91.4%;
  }
}
```

### `app/page.tsx` — 主页面

```typescript
'use client';

import { useState, useRef, useEffect } from 'react';
import { useChat } from '@ai-sdk/react';
import { nanoid } from 'nanoid';

interface Session {
  id: string;
  title: string;
  status: string;
  agent_type: string;
  created_at: number;
  updated_at: number;
}

export default function Home() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string>('');
  const [provider, setProvider] = useState<'openai' | 'anthropic'>('openai');
  const [agentType, setAgentType] = useState<string>('general');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const { messages, input, handleInputChange, handleSubmit, isLoading, setMessages } = useChat({
    api: '/api/chat',
    body: { sessionId: currentSessionId, provider },
    onFinish: () => loadSessions(),
  });

  useEffect(() => {
    loadSessions();
    initApp();
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function initApp() {
    await fetch('/api/init', { method: 'POST' });
  }

  async function loadSessions() {
    const res = await fetch('/api/session');
    const data = await res.json();
    setSessions(data);
    if (data.length > 0 && !currentSessionId) {
      setCurrentSessionId(data[0].id);
    }
  }

  async function newSession() {
    const res = await fetch('/api/session', {
      method: 'POST',
      body: JSON.stringify({ title: `新会话 ${new Date().toLocaleString('zh-CN')}` }),
    });
    const session = await res.json();
    setCurrentSessionId(session.id);
    setMessages([]);
    loadSessions();
  }

  async function loadSession(sessionId: string) {
    setCurrentSessionId(sessionId);
    setMessages([]);

    const res = await fetch(`/api/messages?sessionId=${sessionId}`);
    const history = await res.json();
    for (const msg of history) {
      setMessages(prev => [...prev, { id: msg.id, role: msg.role, content: msg.content }]);
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!currentSessionId) {
      const res = await fetch('/api/session', {
        method: 'POST',
        body: JSON.stringify({ title: input.slice(0, 30) }),
      });
      const session = await res.json();
      setCurrentSessionId(session.id);
    }
    handleSubmit(e);
  }

  return (
    <div className="flex h-screen bg-white">
      {/* Sidebar */}
      <div className={`${sidebarOpen ? 'w-72' : 'w-0'} transition-all duration-300 border-r bg-gray-50 overflow-hidden`}>
        <div className="p-4">
          <button
            onClick={newSession}
            className="w-full py-2 px-4 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition"
          >
            + 新会话
          </button>
        </div>
        <div className="overflow-y-auto h-[calc(100vh-80px)]">
          {sessions.map(s => (
            <div
              key={s.id}
              onClick={() => loadSession(s.id)}
              className={`px-4 py-3 cursor-pointer border-b hover:bg-blue-50 transition ${
                s.id === currentSessionId ? 'bg-blue-100 border-l-4 border-l-blue-600' : ''
              }`}
            >
              <div className="text-sm font-medium truncate">{s.title}</div>
              <div className="text-xs text-gray-500 mt-1">
                {s.status === 'active' ? '进行中' : s.status === 'resolved' ? '已解决' : '已转接'} ·
                {s.agent_type === 'general' ? '通用' : s.agent_type === 'technical' ? '技术' : '账单'}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Main */}
      <div className="flex-1 flex flex-col">
        {/* Header */}
        <header className="border-b px-6 py-3 flex items-center justify-between bg-white">
          <div className="flex items-center gap-4">
            <button onClick={() => setSidebarOpen(!sidebarOpen)} className="text-gray-500 hover:text-gray-700">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
            <h1 className="text-lg font-semibold">AI 智能客服系统</h1>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-gray-500">
              当前: <span className="font-medium">{agentType === 'general' ? '通用客服' : agentType === 'technical' ? '技术支持' : '账单专员'}</span>
            </span>
            <select
              value={provider}
              onChange={(e) => setProvider(e.target.value as 'openai' | 'anthropic')}
              className="text-sm border rounded px-2 py-1"
            >
              <option value="openai">OpenAI</option>
              <option value="anthropic">Anthropic</option>
            </select>
          </div>
        </header>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full text-gray-400">
              <svg className="w-16 h-16 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
              <p className="text-lg">欢迎使用 AI 智能客服系统</p>
              <p className="text-sm mt-1">请描述您的问题，我将为您解答</p>
            </div>
          )}
          {messages.map(m => (
            <div key={m.id} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[70%] rounded-2xl px-4 py-3 ${
                m.role === 'user'
                  ? 'bg-blue-600 text-white rounded-br-md'
                  : 'bg-gray-100 text-gray-800 rounded-bl-md'
              }`}>
                <div className="text-sm leading-relaxed whitespace-pre-wrap">{m.content}</div>
                <div className="text-xs mt-1 opacity-60">
                  {m.role === 'user' ? '用户' : 'AI 客服'}
                </div>
              </div>
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <div className="border-t px-6 py-4 bg-white">
          <form onSubmit={onSubmit} className="flex gap-3">
            <input
              value={input}
              onChange={handleInputChange}
              placeholder="请输入您的问题..."
              className="flex-1 border rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              disabled={isLoading}
            />
            <button
              type="submit"
              disabled={isLoading || !input.trim()}
              className="px-6 py-3 bg-blue-600 text-white rounded-xl hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
            >
              {isLoading ? (
                <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
              ) : '发送'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
```

### `app/api/init/route.ts` — 初始化数据库

```typescript
import { initDB, seedKnowledge } from '@/lib/db';

export async function POST() {
  await initDB();
  await seedKnowledge();
  return Response.json({ success: true });
}
```

---

## Docker 部署

### `Dockerfile`

```dockerfile
FROM node:20-alpine AS base
WORKDIR /app

FROM base AS deps
COPY package*.json ./
RUN npm ci --only=production

FROM base AS builder
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM base AS runner
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/package.json ./

EXPOSE 3000
CMD ["npm", "start"]
```

### `docker-compose.yml`

```yaml
version: '3.8'
services:
  app:
    build: .
    ports:
      - "3000:3000"
    environment:
      - OPENAI_API_KEY=${OPENAI_API_KEY}
      - ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}
      - TURSO_DATABASE_URL=file:./data/customer-service.db
    volumes:
      - ./data:/app/data
```

---

## 部署到 Vercel

```bash
# 安装 Vercel CLI
npm i -g vercel

# 部署
vercel

# 设置环境变量
vercel env add OPENAI_API_KEY
vercel env add ANTHROPIC_API_KEY
```

> **注意**：Vercel 使用无状态函数，SQLite 文件写入不持久。生产环境建议使用 Turso 云数据库或 PostgreSQL。

### 使用 Turso 云数据库

```bash
# 安装 Turso CLI
curl -sSfL https://get.turso.tech/install.sh | sh

# 创建数据库
turso db create ai-customer-service

# 获取连接 URL 和 token
turso db show ai-customer-service --url
turso db tokens create ai-customer-service
```

更新 `.env.local`：
```
TURSO_DATABASE_URL=libsql://your-db.turso.io
TURSO_AUTH_TOKEN=your-token
```

---

## 运行验证

```bash
# 安装依赖
npm install

# 初始化数据库并启动
npm run dev

# 访问
open http://localhost:3000

# 测试用例
# 1. 通用客服："你好，我想咨询一下"
# 2. 知识库问答："退款政策是怎样的？"
# 3. 技术支持："我的账号登录报错"
# 4. 账单相关："会员卡怎么收费"
# 5. 切换 Provider：右上角下拉框切换到 Anthropic
```

---

## 常见问题

**Q: 为什么需要双 Provider 配置？**
A: 企业级应用需要高可用性。当某个 Provider 不可用时，可自动或手动切换到另一个。

**Q: SQLite 在 Vercel 上能用吗？**
A: Vercel Serverless 函数是无状态的，SQLite 文件写入不会持久化。推荐使用 Turso（兼容 SQLite 的分布式数据库）或 PostgreSQL（Neon、Supabase）。

**Q: Agent 路由的工作原理是什么？**
A: 系统通过关键词匹配检测用户问题类型（通用/技术/账单），自动选择合适的 AI 助手指令和知识库范围。

**Q: 如何扩展新的 Agent 类型？**
A: 在 `lib/ai/agents.ts` 的 `SYSTEM_PROMPTS` 中添加新的类型和提示词，然后在 `detectAgentType` 函数中添加匹配逻辑即可。
