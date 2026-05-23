# 第17章 企业级实战案例二：AI 内容生成平台

## 目录

- [17.1 项目概述](#171-项目概述)
- [17.2 架构设计](#172-架构设计)
- [17.3 项目初始化](#173-项目初始化)
- [17.4 模板引擎设计](#174-模板引擎设计)
- [17.5 AI 生成层](#175-ai-生成层)
- [17.6 API 路由](#176-api-路由)
- [17.7 前端页面](#177-前端页面)
- [17.8 导出功能](#178-导出功能)
- [17.9 部署方案](#179-部署方案)
- [17.10 运行验证](#1710-运行验证)
- [17.11 常见问题](#1711-常见问题)

---

## 17.1 项目概述

构建一个企业级 AI 内容生成平台（ContentGPT），支持文章生成、文案创作、翻译润色、SEO 优化等功能。系统适配 OpenAI 和 Anthropic 双 Provider，提供模板管理、历史记录、导出分享等完整工作流。

### 17.1.1 功能需求

- **多场景模板**：文章写作、营销文案、翻译润色、SEO 优化
- **双 Provider 支持**：OpenAI / Anthropic 自由切换
- **流式输出**：实时显示生成内容
- **参数调节**：温度、最大长度、创意度
- **历史管理**：保存、查看、复用生成记录
- **导出分享**：Markdown / HTML / 纯文本导出
- **模板自定义**：用户可创建和管理自己的模板

### 17.1.2 技术栈

- Next.js 14 (App Router) + TypeScript
- Vercel AI SDK（`ai`、`@ai-sdk/react`、`@ai-sdk/openai`、`@ai-sdk/anthropic`）
- Tailwind CSS + shadcn/ui
- SQLite（Turso/libsql）或 PostgreSQL
- OpenAI + Anthropic 双 Provider
- Zod（参数校验）

---

## 17.2 架构设计

```
┌─────────────────────────────────────────────────────┐
│                     Frontend                         │
│     Next.js App Router + Tailwind CSS + shadcn/ui     │
├─────────────────────────────────────────────────────┤
│                   API Routes                         │
│  /api/generate    → 内容生成                          │
│  /api/templates   → 模板 CRUD                         │
│  /api/history     → 历史记录                          │
│  /api/export      → 内容导出                          │
├─────────────────────────────────────────────────────┤
│                AI Layer (Vercel AI SDK)               │
│  ┌──────────────┐  ┌──────────────┐                   │
│  │  OpenAI       │  │  Anthropic   │                   │
│  │  gpt-4o       │  │  claude-sonnet │                 │
│  └──────────────┘  └──────────────┘                   │
│         ↑                 ↑                            │
│    ┌─────────────────────────────┐                    │
│    │     Template Engine         │                    │
│    │  系统模板 + 自定义模板       │                    │
│    └─────────────────────────────┘                    │
├─────────────────────────────────────────────────────┤
│                  Data Layer                           │
│  ┌────────────┐  ┌────────────┐  ┌──────────────┐   │
│  │ templates  │  │  history   │  │   exports     │   │
│  └────────────┘  └────────────┘  └──────────────┘   │
└─────────────────────────────────────────────────────┘
```

系统采用分层架构：

- **前端层**：Next.js App Router + Tailwind CSS，三标签页界面（生成、历史、模板管理）
- **API 层**：RESTful 接口处理生成、模板 CRUD、历史查询和文件导出
- **AI 层**：Vercel AI SDK 统一封装双 Provider，Template Engine 实现提示词模板化
- **数据层**：SQLite/PostgreSQL 存储模板、生成记录和导出记录

---

## 17.3 项目初始化

### 17.3.1 创建 Next.js 项目

```bash
npx create-next-app@latest ai-content-platform --typescript --tailwind --eslint
cd ai-content-platform
```

### 17.3.2 安装依赖

```bash
# AI SDK
npm install ai @ai-sdk/react @ai-sdk/openai @ai-sdk/anthropic

# UI 组件
npm install class-variance-authority clsx tailwind-merge lucide-react react-markdown

# 数据库
npm install @libsql/client

# 工具库
npm install nanoid zod
```

### 17.3.3 配置环境变量

创建 `.env.local`：

```bash
# OpenAI
OPENAI_API_KEY=sk-your-openai-key-here

# Anthropic
ANTHROPIC_API_KEY=sk-ant-your-anthropic-key-here

# 数据库（使用本地 SQLite）
TURSO_DATABASE_URL=file:./data/content-platform.db

# 应用配置
NEXT_PUBLIC_APP_NAME=ContentGPT - AI 内容生成平台
```

---

## 17.4 模板引擎设计

### 17.4.1 模板数据模型 — `lib/db/schema.ts`

```typescript
export interface Template {
  id: string;
  name: string;
  category: string;
  system_prompt: string;
  user_prompt_template: string;
  default_params: string; // JSON string
  is_system: number; // 0 or 1
  created_at: number;
  updated_at: number;
}

export interface GenerationRecord {
  id: string;
  template_id: string;
  template_name: string;
  provider: string;
  model: string;
  params: string; // JSON: temperature, maxTokens
  input_text: string;
  output_text: string;
  tokens_input: number;
  tokens_output: number;
  duration_ms: number;
  created_at: number;
}

export interface ExportRecord {
  id: string;
  generation_id: string;
  format: string;
  content: string;
  created_at: number;
}
```

### 17.4.2 模板变量填充 — `lib/ai/template-engine.ts`

模板引擎的核心功能是将用户输入的变量（如 `{topic}`、`{audience}`）替换到预设的提示词模板中：

```typescript
export function fillTemplate(template: string, variables: Record<string, string>): string {
  let result = template;
  for (const [key, value] of Object.entries(variables)) {
    result = result.replace(new RegExp(`\\{${key}\\}`, 'g'), value);
  }
  return result;
}
```

使用示例：

```typescript
const prompt = fillTemplate(
  '请帮我写一篇关于「{topic}」的博客文章。目标读者：{audience}。',
  { topic: 'AI 对电商的影响', audience: '电商从业者' }
);
// 结果：'请帮我写一篇关于「AI 对电商的影响」的博客文章。目标读者：电商从业者。'
```

### 17.4.3 系统模板定义 — `lib/db/index.ts`（seedTemplates）

系统预置了五类模板，覆盖常见内容生成场景：

| 名称 | 分类 | System Prompt 特点 | 默认参数 |
|------|------|-------------------|---------|
| 博客文章 | 文章写作 | 专业内容创作者，要求结构完整 | temperature: 0.7, maxTokens: 4096 |
| 营销文案 | 文案创作 | 资深营销文案撰稿人，突出卖点 | temperature: 0.8, maxTokens: 2048 |
| 翻译润色 | 翻译校对 | 专业翻译和编辑，保留原文风格 | temperature: 0.3, maxTokens: 4096 |
| SEO 优化 | SEO优化 | SEO 专家，包含关键词和结构优化 | temperature: 0.5, maxTokens: 4096 |
| 社交媒体帖子 | 文案创作 | 社交媒体运营专家，简洁有力 | temperature: 0.9, maxTokens: 1024 |

每个模板包含：

- **`system_prompt`**：系统级指令，定义 AI 的角色和行为
- **`user_prompt_template`**：用户提示词模板，包含 `{变量名}` 占位符
- **`default_params`**：默认的 temperature 和 maxTokens 参数

---

## 17.5 AI 生成层

### 17.5.1 Provider 封装 — `lib/ai/providers.ts`

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

### 17.5.2 生成核心逻辑 — `lib/ai/template-engine.ts`

```typescript
import { streamText } from 'ai';
import { getModel, type ProviderType } from './providers';

export interface GenerateParams {
  systemPrompt: string;
  userPrompt: string;
  temperature?: number;
  maxTokens?: number;
  provider?: ProviderType;
  model?: string;
}

export function fillTemplate(template: string, variables: Record<string, string>): string {
  let result = template;
  for (const [key, value] of Object.entries(variables)) {
    result = result.replace(new RegExp(`\\{${key}\\}`, 'g'), value);
  }
  return result;
}

export async function generateContent(params: GenerateParams) {
  const result = streamText({
    model: getModel(params.provider || 'openai', params.model),
    system: params.systemPrompt,
    prompt: params.userPrompt,
    temperature: params.temperature ?? 0.7,
    maxTokens: params.maxTokens ?? 4096,
  });

  return result;
}

export const TEMPLATE_CATEGORIES = [
  '文章写作',
  '文案创作',
  '翻译校对',
  'SEO优化',
] as const;
```

### 17.5.3 模板扩展指南

如需添加新的系统模板，在 `seedTemplates()` 中添加即可：

```typescript
const newTemplate = {
  name: '产品说明书',
  category: '文章写作',
  system_prompt: '你是一位技术文档专家。请根据产品参数撰写清晰、准确的产品说明书。',
  user_prompt_template: '产品名称：{product}\n功能列表：{features}\n目标用户：{audience}\n\n请生成产品说明书。',
  default_params: JSON.stringify({ temperature: 0.4, maxTokens: 2048 }),
};
```

---

## 17.6 API 路由

### 17.6.1 内容生成 — `app/api/generate/route.ts`

```typescript
import { NextRequest } from 'next/server';
import { generateContent, fillTemplate } from '@/lib/ai/template-engine';
import { getTemplate, saveGeneration } from '@/lib/db';
import type { ProviderType } from '@/lib/ai/providers';

export async function POST(req: NextRequest) {
  const { templateId, variables, provider = 'openai', model, temperature, maxTokens } = await req.json();

  if (!templateId || !variables) {
    return Response.json({ error: '缺少必要参数' }, { status: 400 });
  }

  const template = await getTemplate(templateId);
  if (!template) {
    return Response.json({ error: '模板不存在' }, { status: 404 });
  }

  const startTime = Date.now();
  const systemPrompt = template.system_prompt;
  const userPrompt = fillTemplate(template.user_prompt_template, variables);
  const params = {
    ...JSON.parse(template.default_params || '{}'),
    temperature: temperature ?? undefined,
    maxTokens: maxTokens ?? undefined,
  };

  const result = await generateContent({
    systemPrompt,
    userPrompt,
    temperature: params.temperature,
    maxTokens: params.maxTokens,
    provider: provider as ProviderType,
    model,
  });

  // 收集完整输出以保存到历史记录
  let fullOutput = '';
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      for await (const chunk of result.textStream) {
        fullOutput += chunk;
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();

      // 保存生成记录
      const usage = await result.usage;
      await saveGeneration({
        template_id: templateId,
        template_name: template.name,
        provider,
        model: model || (provider === 'openai' ? 'gpt-4o' : 'claude-sonnet-4-20250514'),
        params: JSON.stringify(params),
        input_text: JSON.stringify(variables),
        output_text: fullOutput,
        tokens_input: usage.promptTokens,
        tokens_output: usage.completionTokens,
        duration_ms: Date.now() - startTime,
      });
    },
  });

  return new Response(stream, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}
```

### 17.6.2 模板 CRUD — `app/api/templates/route.ts`

```typescript
import { NextRequest } from 'next/server';
import { getTemplates, saveTemplate } from '@/lib/db';

export async function GET() {
  const templates = await getTemplates();
  return Response.json(templates);
}

export async function POST(req: NextRequest) {
  const data = await req.json();
  const template = await saveTemplate({
    name: data.name,
    category: data.category,
    system_prompt: data.system_prompt,
    user_prompt_template: data.user_prompt_template,
    default_params: JSON.stringify(data.default_params || {}),
    is_system: 0,
  });
  return Response.json(template, { status: 201 });
}
```

### 17.6.3 历史记录 — `app/api/history/route.ts`

```typescript
import { NextRequest } from 'next/server';
import { getHistory, getGeneration } from '@/lib/db';

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('id');
  if (id) {
    const record = await getGeneration(id);
    return Response.json(record || { error: '记录不存在' }, { status: record ? 200 : 404 });
  }
  const history = await getHistory();
  return Response.json(history);
}
```

### 17.6.4 导出接口 — `app/api/export/route.ts`

```typescript
import { NextRequest } from 'next/server';
import { getGeneration } from '@/lib/db';

export async function POST(req: NextRequest) {
  const { generationId, format = 'markdown' } = await req.json();

  const record = await getGeneration(generationId);
  if (!record) {
    return Response.json({ error: '记录不存在' }, { status: 404 });
  }

  let content = '';
  const filename = `content-${generationId.slice(0, 8)}`;

  switch (format) {
    case 'markdown':
      content = `# ${record.template_name}\n\n${record.output_text}`;
      break;
    case 'html':
      content = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${record.template_name}</title></head><body><article>${record.output_text.replace(/\n/g, '<br>')}</article></body></html>`;
      break;
    case 'text':
    default:
      content = record.output_text;
      break;
  }

  return new Response(content, {
    headers: {
      'Content-Type': format === 'html' ? 'text/html; charset=utf-8' : 'text/plain; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}.${format === 'html' ? 'html' : format === 'markdown' ? 'md' : 'txt'}"`,
    },
  });
}
```

### 17.6.5 数据库初始化 — `app/api/init/route.ts`

```typescript
import { initDB, seedTemplates } from '@/lib/db';

export async function POST() {
  await initDB();
  await seedTemplates();
  return Response.json({ success: true });
}
```

---

## 17.7 前端页面

### 17.7.1 根布局 — `app/layout.tsx`

```typescript
import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'ContentGPT - AI 内容生成平台',
  description: '基于 Vercel AI SDK 的企业级 AI 内容生成平台',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN">
      <body className="min-h-screen bg-gray-50 font-sans antialiased">
        {children}
      </body>
    </html>
  );
}
```

### 17.7.2 全局样式 — `app/globals.css`

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

.prose pre {
  background: #1e293b;
  color: #e2e8f0;
  padding: 1rem;
  border-radius: 0.5rem;
  overflow-x: auto;
}
```

### 17.7.3 主页面 — `app/page.tsx`

```typescript
'use client';

import { useState, useEffect, useRef } from 'react';

interface Template {
  id: string;
  name: string;
  category: string;
  system_prompt: string;
  user_prompt_template: string;
  default_params: string;
  is_system: number;
}

interface GenerationRecord {
  id: string;
  template_name: string;
  provider: string;
  input_text: string;
  output_text: string;
  tokens_input: number;
  tokens_output: number;
  duration_ms: number;
  created_at: number;
}

type Tab = 'generate' | 'history' | 'templates';

export default function Home() {
  const [activeTab, setActiveTab] = useState<Tab>('generate');
  const [templates, setTemplates] = useState<Template[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<string>('');
  const [provider, setProvider] = useState<'openai' | 'anthropic'>('openai');
  const [temperature, setTemperature] = useState(0.7);
  const [maxTokens, setMaxTokens] = useState(4096);
  const [variables, setVariables] = useState<Record<string, string>>({});
  const [output, setOutput] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [history, setHistory] = useState<GenerationRecord[]>([]);
  const [customTemplates, setCustomTemplates] = useState<Template[]>([]);
  const outputRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    initApp();
    loadTemplates();
    loadHistory();
  }, []);

  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [output]);

  async function initApp() {
    await fetch('/api/init', { method: 'POST' });
  }

  async function loadTemplates() {
    const res = await fetch('/api/templates');
    const data = await res.json();
    setTemplates(data.filter((t: Template) => t.is_system === 1));
    setCustomTemplates(data.filter((t: Template) => t.is_system === 0));
  }

  async function loadHistory() {
    const res = await fetch('/api/history');
    const data = await res.json();
    setHistory(data);
  }

  function handleSelectTemplate(templateId: string) {
    setSelectedTemplate(templateId);
    setOutput('');

    const tmpl = [...templates, ...customTemplates].find(t => t.id === templateId);
    if (tmpl) {
      const matches = tmpl.user_prompt_template.match(/\{(\w+)\}/g) || [];
      const vars: Record<string, string> = {};
      for (const m of matches) {
        const key = m.slice(1, -1);
        vars[key] = '';
      }
      setVariables(vars);
      const params = JSON.parse(tmpl.default_params || '{}');
      if (params.temperature) setTemperature(params.temperature);
      if (params.maxTokens) setMaxTokens(params.maxTokens);
    }
  }

  async function generate() {
    if (!selectedTemplate) return;
    setIsGenerating(true);
    setOutput('');

    try {
      const res = await fetch('/api/generate', {
        method: 'POST',
        body: JSON.stringify({
          templateId: selectedTemplate,
          variables,
          provider,
          temperature,
          maxTokens,
        }),
      });

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();

      while (reader) {
        const { done, value } = await reader.read();
        if (done) break;
        setOutput(prev => prev + decoder.decode(value, { stream: true }));
      }

      await loadHistory();
    } catch (err) {
      setOutput(`生成失败：${err}`);
    } finally {
      setIsGenerating(false);
    }
  }

  async function exportContent(format: string) {
    const latest = history[0];
    if (!latest) return;

    const res = await fetch('/api/export', {
      method: 'POST',
      body: JSON.stringify({ generationId: latest.id, format }),
    });
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `content.${format === 'html' ? 'html' : format === 'markdown' ? 'md' : 'txt'}`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const currentTemplate = [...templates, ...customTemplates].find(t => t.id === selectedTemplate);

  return (
    <div className="max-w-6xl mx-auto p-6">
      {/* Header */}
      <header className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900">ContentGPT</h1>
        <p className="text-gray-500 mt-1">AI 内容生成平台 — 基于 Vercel AI SDK</p>
      </header>

      {/* 标签页切换 */}
      <div className="flex gap-1 mb-6 bg-white rounded-lg p-1 shadow-sm border">
        {([
          { key: 'generate', label: '内容生成' },
          { key: 'history', label: '历史记录' },
          { key: 'templates', label: '模板管理' },
        ] as { key: Tab; label: string }[]).map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`flex-1 py-2 px-4 rounded-md text-sm font-medium transition ${
              activeTab === tab.key
                ? 'bg-blue-600 text-white'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'generate' && (
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
          {/* 左侧配置面板 */}
          <div className="lg:col-span-2 space-y-4">
            <div className="bg-white rounded-xl p-5 shadow-sm border space-y-4">
              <h2 className="font-semibold text-gray-900">生成配置</h2>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">模板</label>
                <select
                  value={selectedTemplate}
                  onChange={e => handleSelectTemplate(e.target.value)}
                  className="w-full border rounded-lg px-3 py-2 text-sm"
                >
                  <option value="">选择模板...</option>
                  {templates.map(t => (
                    <option key={t.id} value={t.id}>{t.name} ({t.category})</option>
                  ))}
                  {customTemplates.length > 0 && (
                    <optgroup label="自定义模板">
                      {customTemplates.map(t => (
                        <option key={t.id} value={t.id}>{t.name}</option>
                      ))}
                    </optgroup>
                  )}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">AI Provider</label>
                <div className="flex gap-2">
                  {(['openai', 'anthropic'] as const).map(p => (
                    <button
                      key={p}
                      onClick={() => setProvider(p)}
                      className={`flex-1 py-2 rounded-lg text-sm font-medium border transition ${
                        provider === p
                          ? 'bg-blue-600 text-white border-blue-600'
                          : 'bg-white text-gray-700 hover:bg-gray-50'
                      }`}
                    >
                      {p === 'openai' ? 'OpenAI (GPT-4o)' : 'Anthropic (Claude)'}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  温度: {temperature}
                </label>
                <input
                  type="range"
                  min="0"
                  max="2"
                  step="0.1"
                  value={temperature}
                  onChange={e => setTemperature(parseFloat(e.target.value))}
                  className="w-full"
                />
                <div className="flex justify-between text-xs text-gray-400">
                  <span>精确</span>
                  <span>创意</span>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  最大长度: {maxTokens}
                </label>
                <input
                  type="range"
                  min="256"
                  max="8192"
                  step="256"
                  value={maxTokens}
                  onChange={e => setMaxTokens(parseInt(e.target.value))}
                  className="w-full"
                />
              </div>
            </div>

            {/* 变量输入区 */}
            {Object.keys(variables).length > 0 && (
              <div className="bg-white rounded-xl p-5 shadow-sm border space-y-3">
                <h2 className="font-semibold text-gray-900">输入参数</h2>
                {Object.entries(variables).map(([key, value]) => (
                  <div key={key}>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      {key}
                    </label>
                    <textarea
                      value={value}
                      onChange={e => setVariables(prev => ({ ...prev, [key]: e.target.value }))}
                      rows={key === 'text' ? 4 : 2}
                      className="w-full border rounded-lg px-3 py-2 text-sm"
                      placeholder={`请输入${key}`}
                    />
                  </div>
                ))}
                <button
                  onClick={generate}
                  disabled={isGenerating || !selectedTemplate}
                  className="w-full py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition font-medium"
                >
                  {isGenerating ? '生成中...' : '开始生成'}
                </button>
              </div>
            )}
          </div>

          {/* 右侧输出区域 */}
          <div className="lg:col-span-3">
            <div className="bg-white rounded-xl shadow-sm border flex flex-col h-[600px]">
              <div className="px-5 py-3 border-b flex items-center justify-between">
                <h2 className="font-semibold text-gray-900">生成结果</h2>
                {output && (
                  <div className="flex gap-2">
                    <button onClick={() => exportContent('markdown')} className="text-xs px-3 py-1 bg-gray-100 rounded hover:bg-gray-200">Markdown</button>
                    <button onClick={() => exportContent('html')} className="text-xs px-3 py-1 bg-gray-100 rounded hover:bg-gray-200">HTML</button>
                    <button onClick={() => exportContent('text')} className="text-xs px-3 py-1 bg-gray-100 rounded hover:bg-gray-200">纯文本</button>
                    <button onClick={() => { navigator.clipboard.writeText(output); }} className="text-xs px-3 py-1 bg-gray-100 rounded hover:bg-gray-200">复制</button>
                  </div>
                )}
              </div>
              <div ref={outputRef} className="flex-1 overflow-y-auto p-5">
                {!output && !isGenerating && (
                  <div className="flex flex-col items-center justify-center h-full text-gray-400">
                    <svg className="w-12 h-12 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                    </svg>
                    <p>选择一个模板，输入参数后点击生成</p>
                  </div>
                )}
                {isGenerating && !output && (
                  <div className="flex items-center justify-center h-full">
                    <div className="animate-pulse text-gray-400">正在生成...</div>
                  </div>
                )}
                {output && (
                  <div className="prose prose-sm max-w-none whitespace-pre-wrap">
                    {output}
                  </div>
                )}
              </div>
              {history[0] && output && (
                <div className="px-5 py-2 border-t text-xs text-gray-400 flex gap-4">
                  <span>模板: {history[0].template_name}</span>
                  <span>Provider: {history[0].provider}</span>
                  <span>输入: {history[0].tokens_input} tokens</span>
                  <span>输出: {history[0].tokens_output} tokens</span>
                  <span>耗时: {(history[0].duration_ms / 1000).toFixed(1)}s</span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {activeTab === 'history' && (
        <div className="bg-white rounded-xl shadow-sm border">
          <div className="px-5 py-4 border-b">
            <h2 className="font-semibold text-gray-900">历史记录</h2>
          </div>
          <div className="divide-y">
            {history.length === 0 ? (
              <div className="p-10 text-center text-gray-400">暂无生成记录</div>
            ) : (
              history.map(r => (
                <div key={r.id} className="px-5 py-4 hover:bg-gray-50 transition cursor-pointer"
                  onClick={async () => {
                    const res = await fetch(`/api/history?id=${r.id}`);
                    const detail = await res.json();
                    setOutput(detail.output_text);
                    setActiveTab('generate');
                  }}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="font-medium text-sm">{r.template_name}</span>
                      <span className="ml-2 text-xs text-gray-400">{r.provider}</span>
                    </div>
                    <div className="text-xs text-gray-400">
                      {new Date(r.created_at).toLocaleString('zh-CN')}
                    </div>
                  </div>
                  <div className="mt-1 text-sm text-gray-600 line-clamp-2">
                    {r.output_text.slice(0, 200)}
                  </div>
                  <div className="mt-1 text-xs text-gray-400">
                    tokens: {r.tokens_input} → {r.tokens_output} |
                    耗时: {(r.duration_ms / 1000).toFixed(1)}s
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {activeTab === 'templates' && (
        <div className="space-y-6">
          {/* 系统模板列表 */}
          <div className="bg-white rounded-xl shadow-sm border">
            <div className="px-5 py-4 border-b">
              <h2 className="font-semibold text-gray-900">系统模板</h2>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-5">
              {templates.map(t => (
                <div key={t.id} className="border rounded-lg p-4">
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="font-medium text-gray-900">{t.name}</h3>
                    <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded">
                      {t.category}
                    </span>
                  </div>
                  <p className="text-xs text-gray-500 line-clamp-2">{t.system_prompt}</p>
                </div>
              ))}
            </div>
          </div>

          {/* 自定义模板 */}
          <div className="bg-white rounded-xl shadow-sm border">
            <div className="px-5 py-4 border-b flex items-center justify-between">
              <h2 className="font-semibold text-gray-900">自定义模板</h2>
            </div>
            {customTemplates.length === 0 ? (
              <div className="p-10 text-center text-gray-400">
                <p>暂无自定义模板</p>
                <p className="text-xs mt-1">可通过 API 创建自定义模板</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-5">
                {customTemplates.map(t => (
                  <div key={t.id} className="border rounded-lg p-4">
                    <h3 className="font-medium text-gray-900">{t.name}</h3>
                    <p className="text-xs text-gray-500 mt-1 line-clamp-2">{t.system_prompt}</p>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* API 创建模板文档 */}
          <details className="bg-white rounded-xl shadow-sm border">
            <summary className="px-5 py-4 cursor-pointer font-semibold text-gray-900 hover:bg-gray-50 rounded-xl">
              通过 API 创建自定义模板
            </summary>
            <div className="px-5 py-4 border-t">
              <pre className="bg-gray-900 text-gray-100 p-4 rounded-lg text-sm overflow-x-auto">
{`curl -X POST http://localhost:3000/api/templates \\
  -H "Content-Type: application/json" \\
  -d '{
    "name": "我的模板",
    "category": "文章写作",
    "system_prompt": "你是一位...",
    "user_prompt_template": "请写一篇关于{topic}的文章",
    "default_params": {
      "temperature": 0.7,
      "maxTokens": 2048
    }
  }'`}
              </pre>
            </div>
          </details>
        </div>
      )}
    </div>
  );
}
```

---

## 17.8 导出功能

系统支持三种导出格式，用户可一键将生成内容导出为文件：

### 17.8.1 导出格式对比

| 格式 | 适用场景 | MIME 类型 | 文件名后缀 |
|------|---------|-----------|-----------|
| Markdown | 博客写作、文档 | `text/plain` | `.md` |
| HTML | 网页发布、邮件 | `text/html` | `.html` |
| 纯文本 | 通用使用 | `text/plain` | `.txt` |

### 17.8.2 前端导出流程

导出功能通过 `exportContent` 函数实现：

1. 获取最新一条生成记录的 ID
2. 调用 `/api/export` 接口请求指定格式
3. 将返回的 Blob 转为下载链接
4. 触发自动下载

```typescript
async function exportContent(format: string) {
  const latest = history[0];
  if (!latest) return;

  const res = await fetch('/api/export', {
    method: 'POST',
    body: JSON.stringify({ generationId: latest.id, format }),
  });
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `content.${format === 'html' ? 'html' : format === 'markdown' ? 'md' : 'txt'}`;
  a.click();
  URL.revokeObjectURL(url);
}
```

### 17.8.3 扩展自定义导出格式

如需添加新的导出格式（如 PDF、JSON），在 `app/api/export/route.ts` 中增加 case 分支即可：

```typescript
case 'json':
  content = JSON.stringify({
    title: record.template_name,
    content: record.output_text,
    meta: {
      provider: record.provider,
      tokens: { input: record.tokens_input, output: record.tokens_output },
    },
  }, null, 2);
  break;
```

---

## 17.9 部署方案

### 17.9.1 Docker 部署

**Dockerfile**

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

**docker-compose.yml**

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
      - TURSO_DATABASE_URL=file:./data/content-platform.db
    volumes:
      - ./data:/app/data
```

### 17.9.2 Vercel 部署

```bash
# 安装 Vercel CLI
npm i -g vercel

# 部署
vercel

# 设置环境变量
vercel env add OPENAI_API_KEY
vercel env add ANTHROPIC_API_KEY
```

### 17.9.3 Neon PostgreSQL（推荐用于 Vercel）

```bash
# 注册 Neon 获得免费数据库
# 然后在 Vercel 项目设置中添加环境变量
```

更新 `.env.local`：

```
TURSO_DATABASE_URL=postgresql://user:pass@ep-xxx.neon.tech/content-platform
```

---

## 17.10 运行验证

```bash
# 安装依赖
npm install

# 初始化数据库并启动
npm run dev

# 访问
open http://localhost:3000

# 测试流程
# 1. 选择「博客文章」模板
# 2. 填写 topic="AI 对电商行业的影响", audience="电商从业者", length="1500字", style="通俗易懂"
# 3. 切换 Provider 为 OpenAI 或 Anthropic
# 4. 点击「开始生成」
# 5. 查看实时流式输出
# 6. 导出为 Markdown / HTML / 纯文本
# 7. 切换到「历史记录」查看所有生成记录
```

---

## 17.11 常见问题

**Q: 如何添加更多系统模板？**
A: 在 `lib/db/index.ts` 的 `seedTemplates()` 函数中添加新模板对象。按照已有模板的格式定义 `name`、`category`、`system_prompt`、`user_prompt_template` 和 `default_params` 即可。

**Q: 流式输出为什么有时会中断？**
A: 可能原因：网络不稳定、Provider API 限流、`maxTokens` 过大导致超时。建议检查网络连接，适当降低 `maxTokens` 值。双 Provider 配置可在其中一个不可用时切换到另一个。

**Q: 如何重置数据库？**
A: 删除 `data/` 目录下的 SQLite 文件，重启应用即可自动重建。生产环境建议通过数据库管理工具执行 DROP TABLE 操作。

**Q: 可以对接其他 AI Provider 吗？**
A: 可以。在 `lib/ai/providers.ts` 中添加新的 Provider（如 Google Vertex AI、Azure OpenAI），然后在 `generateContent` 函数中增加相应的分支即可。

**Q: 如何做多租户隔离？**
A: 在数据库表中添加 `tenant_id` 字段，所有查询增加租户过滤条件。API 层通过认证中间件获取当前租户信息。前端在请求头中携带租户标识。
