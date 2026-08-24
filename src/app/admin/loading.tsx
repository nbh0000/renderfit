import { PageSkeleton } from "@/components/RouteSkeleton";

/**
 * 이 경로가 서버에서 그려지는 동안 보여 줄 것.
 *
 * 없으면 링크를 눌러도 서버가 답할 때까지 화면이 그대로 멈춰 있어 앱이 먹통인 것처럼
 * 보인다. 이 파일이 있으면 누르는 즉시 넘어가고, Next가 이 경로를 부분적으로 미리
 * 받아 두기도 한다.
 */
export default function Loading() {
  return <PageSkeleton />;
}
