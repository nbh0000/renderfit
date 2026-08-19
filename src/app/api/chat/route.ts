import { createProviders } from "@/ai/providers";
import {
  ASSISTANT_NAME,
  FALLBACK_DEFAULT,
  FALLBACK_REPLIES,
  assistantSystemPrompt,
} from "@/config/assistant";

/**
 * 서비스 전용 챗봇.
 *
 * LLM 호출은 서버에서만 한다 (API 키가 브라우저로 나가지 않는다).
 * 키가 없으면 규칙 기반 안내로 폴백해 화면이 죽지 않게 한다.
 */

export const dynamic = "force-dynamic";

/** 한 번에 받을 수 있는 대화 길이 — 프롬프트 비용 상한 */
const MAX_MESSAGES = 12;
const MAX_LENGTH = 2000;

interface ChatBody {
  messages?: { role: "user" | "assistant"; content: string }[];
}

function fallbackReply(text: string): string {
  const normalized = text.toLowerCase();
  const hit = FALLBACK_REPLIES.find((entry) =>
    entry.match.some((keyword) => normalized.includes(keyword))
  );
  return hit?.reply ?? FALLBACK_DEFAULT;
}

export async function POST(request: Request) {
  let body: ChatBody;
  try {
    body = (await request.json()) as ChatBody;
  } catch {
    return Response.json({ error: "요청 형식이 올바르지 않습니다." }, { status: 400 });
  }

  const messages = (body.messages ?? [])
    .filter((message) => message && typeof message.content === "string")
    .slice(-MAX_MESSAGES)
    .map((message) => ({
      role: message.role === "assistant" ? ("assistant" as const) : ("user" as const),
      content: message.content.slice(0, MAX_LENGTH),
    }));

  const last = [...messages].reverse().find((message) => message.role === "user");
  if (!last) return Response.json({ error: "메시지가 비어 있습니다." }, { status: 400 });

  const providers = createProviders();

  // 키가 없으면 mock LLM이 붙는다 — 이 경우 규칙 기반 안내를 돌려준다.
  if (providers.llm.name !== "anthropic") {
    return Response.json({ reply: fallbackReply(last.content), assistant: ASSISTANT_NAME });
  }

  try {
    const reply = await providers.llm.chat([
      { role: "system", content: assistantSystemPrompt() },
      ...messages,
    ]);
    return Response.json({ reply: reply.trim() || FALLBACK_DEFAULT, assistant: ASSISTANT_NAME });
  } catch {
    return Response.json({ reply: fallbackReply(last.content), assistant: ASSISTANT_NAME });
  }
}
