import { providerStatus } from "@/ai/providers";
import { isSupabaseConfigured } from "@/lib/supabase/env";

/** Railway 헬스체크 + 현재 연결된 provider 확인용 */
export async function GET() {
  return Response.json(
    {
      ok: true,
      time: new Date().toISOString(),
      env: process.env.NODE_ENV,
      supabase: isSupabaseConfigured(),
      serviceRole: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
      gemini: Boolean(process.env.GEMINI_API_KEY),
      providers: providerStatus(),
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
