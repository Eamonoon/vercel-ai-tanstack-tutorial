"use client";

import { useChat } from "ai/react";
import { useRef, useEffect, useState } from "react";

type Status = "idle" | "loading" | "aborted";

export default function ChatUI() {
  const [status, setStatus] = useState<Status>("idle");
  const bottomRef = useRef<HTMLDivElement>(null);

  const {
    messages, input, handleInputChange, handleSubmit,
    isLoading, stop, reload, error,
  } = useChat({
    api: "/api/chat",
    body: { provider: "openai" },
    onFinish: () => setStatus("idle"),
    onError: () => setStatus("idle"),
  });

  useEffect(() => {
    if (isLoading) setStatus("loading");
  }, [isLoading]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  return (
    <div className="max-w-2xl mx-auto p-4">
      <h1 className="text-2xl font-bold mb-4">AI Chat</h1>

      {status === "loading" && <p className="text-blue-500 text-sm mb-2">&#x25cf; AI 正在回复...</p>}
      {status === "aborted" && (
        <p className="text-yellow-600 text-sm mb-2">
          &#x25cf; 已停止 <button onClick={() => reload()} className="text-blue-600 underline ml-2">重新生成</button>
        </p>
      )}

      <div className="border rounded-lg p-4 mb-4 h-96 overflow-y-auto space-y-3">
        {messages.map((m) => (
          <div key={m.id} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[80%] px-4 py-2 rounded-lg whitespace-pre-wrap ${
              m.role === "user" ? "bg-blue-500 text-white" : "bg-gray-100"
            }`}>{m.content}</div>
          </div>
        ))}
        {isLoading && (
          <div className="flex justify-start">
            <div className="bg-gray-100 px-4 py-2 rounded-lg"><span className="animate-pulse">&#x25ca;</span></div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded p-3 mb-4 flex justify-between items-center">
          <span className="text-red-700 text-sm">{error.message}</span>
          <button onClick={() => reload()} className="text-red-600 text-sm underline">重试</button>
        </div>
      )}

      <form onSubmit={handleSubmit} className="flex gap-2">
        <input value={input} onChange={handleInputChange} placeholder="输入消息..."
          disabled={isLoading} className="flex-1 border rounded px-3 py-2 disabled:opacity-50" />

        {isLoading ? (
          <button type="button" onClick={() => { stop(); setStatus("aborted"); }}
            className="bg-red-500 text-white px-4 py-2 rounded hover:bg-red-600">停止</button>
        ) : (
          <button type="submit" disabled={!input.trim()}
            className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 disabled:opacity-50">发送</button>
        )}
      </form>
    </div>
  );
}
