import { getQueue } from "@/lib/queue";

/** background job 상태 폴링 */
export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const job = getQueue().get(id);

  if (!job) return Response.json({ error: "작업을 찾을 수 없습니다." }, { status: 404 });
  return Response.json(job, { headers: { "Cache-Control": "no-store" } });
}
