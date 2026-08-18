/**
 * 무료 플랜 결과물에 씌우는 워터마크 오버레이.
 * TODO(Phase 5): 다운로드 파일에도 워터마크를 굽는다 (canvas 합성).
 */
import { BRAND } from "@/config/brand";

const TILE = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="130" viewBox="0 0 200 130">
  <text x="18" y="76" transform="rotate(-24 18 76)" font-family="Pretendard, sans-serif" font-size="18" fill="#ffffff" fill-opacity="0.34" font-weight="600">${BRAND.watermark}</text>
</svg>`;

const TILE_URL = `url("data:image/svg+xml;utf8,${encodeURIComponent(TILE)}")`;

export function Watermark({ className = "" }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={`pointer-events-none absolute inset-0 ${className}`}
      style={{ backgroundImage: TILE_URL, backgroundRepeat: "repeat" }}
    />
  );
}
