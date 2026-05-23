import { NextRequest, NextResponse } from "next/server";
import { generateText } from "ai";
import { getModel } from "@/lib/ai";
import { env } from "@/env";

export async function POST(request: NextRequest) {
  try {
    const { messages, provider } = await request.json();
    const model = getModel(provider);

    const result = await generateText({
      model,
      messages: messages.map((m: { role: string; content: string }) => ({
        role: m.role as "user" | "assistant" | "system",
        content: m.content,
      })),
    });

    return NextResponse.json({
      content: result.text,
      provider: provider ?? env.DEFAULT_PROVIDER,
    });
  } catch (error) {
    console.error("Chat API Error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
