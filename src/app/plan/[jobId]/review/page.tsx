import { PlanReview } from "@/components/plan/PlanReview";

/**
 * 도면 검수 화면.
 *
 * 들여온 도면은 여기를 지나야만 편집기·3D 로 넘어간다. 확인을 누르면
 * review.status 가 "confirmed" 가 되고, 그때 프로젝트에 얹힌다.
 */
export default async function PlanReviewPage({
  params,
}: {
  params: Promise<{ jobId: string }>;
}) {
  const { jobId } = await params;
  return <PlanReview jobId={jobId} />;
}
