import { NextRequest, NextResponse } from "next/server";
import { streamText } from "ai";
import { getModel } from "@/lib/ai";

export async function POST(request: NextRequest) {
  try {
    const { messages, provider } = await request.json();
    const model = getModel(provider);

    const result = streamText({
      model,
      messages: [
        { role: "system", content: "你是一名友好的中文助手。请用简洁清晰的语言回答问题。" },
        ...messages,
      ],
      maxTokens: 2048,
      temperature: 0.7,
    });

    return result.toDataStreamResponse({
      headers: { "X-Provider": provider ?? "openai" },
    });
  } catch (error) {
    console.error("Stream Error:", error);
    return NextResponse.json(
      { error: "Stream generation failed" },
      { status: 500 }
    );
  }
}
