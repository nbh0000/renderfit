import { getViewer } from "@/lib/auth";

/** 현재 계정 상태(플랜·크레딧). 생성이 끝난 뒤 클라이언트가 잔액을 동기화하는 데 쓴다. */
export async function GET() {
  const viewer = await getViewer();

  return Response.json(
    {
      configured: viewer.configured,
      authed: Boolean(viewer.userId),
      plan: viewer.profile?.plan ?? null,
      credits: viewer.profile?.credits ?? null,
      email: viewer.profile?.email ?? null,
      fullName: viewer.profile?.fullName ?? null,
      avatarUrl: viewer.profile?.avatarUrl ?? null,
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
