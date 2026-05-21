import { NextRequest } from "next/server";
import { getModel } from "@/lib/ai";
import { streamText } from "ai";

export async function POST(request: NextRequest) {
  try {
    const { messages, provider } = await request.json();
    const model = getModel(provider);

    const result = streamText({
      model,
      messages: messages.map((m: { role: string; content: string }) => ({
        role: m.role as "user" | "assistant" | "system",
        content: m.content,
      })),
    });

    return result.toDataStreamResponse();
  } catch (error) {
    console.error("Stream Chat API Error:", error);
    return new Response("Internal server error", { status: 500 });
  }
}
