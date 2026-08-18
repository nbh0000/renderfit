import { getStorage } from "@/lib/storage";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { createServerSupabase } from "@/lib/supabase/server";

const MIME_BY_EXT: Record<string, string> = {
  svg: "image/svg+xml",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  json: "application/json",
  glb: "model/gltf-binary",
};

/**
 * Scene 파일 서빙.
 *
 * 운영에서는 Supabase의 비공개 버킷을 이 라우트가 중계한다
 * (사용자가 올린 방 사진이 URL만으로 외부에 노출되지 않도록).
 * TODO: 프로젝트 소유자 단위 ACL까지 확인하도록 강화한다.
 */
export async function GET(_request: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  const key = path.join("/");

  if (isSupabaseConfigured()) {
    const supabase = await createServerSupabase();
    const {
      data: { user },
    } = (await supabase?.auth.getUser()) ?? { data: { user: null } };
    if (!user) return new Response("Unauthorized", { status: 401 });
  }

  try {
    const buffer = await getStorage().download(key);
    const extension = key.split(".").pop()?.toLowerCase() ?? "";
    return new Response(new Uint8Array(buffer), {
      headers: {
        "Content-Type": MIME_BY_EXT[extension] ?? "application/octet-stream",
        "Cache-Control": isSupabaseConfigured()
          ? "private, max-age=3600"
          : "public, max-age=3600",
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
