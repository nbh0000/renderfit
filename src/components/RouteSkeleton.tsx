/**
 * 화면이 오는 동안 자리를 잡아 두는 뼈대.
 *
 * 우리 화면은 대부분 로그인한 사람의 자료를 서버에서 읽어 그리는 동적 경로다. 그런
 * 경로는 Next가 미리 받아 두지 않으므로, 링크를 눌러도 서버가 답할 때까지 화면이
 * 그대로 멈춰 있는다 — 개발 모드에서 "Rendering..."이 뜨던 것이 그 상태다.
 * 사용자에게는 앱이 먹통이 된 것처럼 보인다.
 *
 * 경로마다 loading.tsx 를 두면 누르는 즉시 화면이 넘어가고 그 동안 이 뼈대가 보인다.
 * 곁들여 Next가 그 경로를 부분적으로 미리 받아 둘 수 있게 된다.
 *
 * 진짜 화면과 비슷한 자리에 회색 덩어리를 놓는 것이 중요하다. 빙글빙글 도는 원 하나만
 * 두면 화면이 뜰 때 내용이 튀어 보인다.
 */

/** 회색 덩어리 하나 */
function Block({ className }: { className: string }) {
  return <div className={`animate-pulse rounded-[var(--radius-control)] bg-sunken ${className}`} />;
}

/** 제목 + 카드 격자 — 대시보드·보관함·갤러리처럼 목록을 보여 주는 화면 */
export function ListSkeleton({ columns = 3 }: { columns?: number }) {
  return (
    <div className="mx-auto max-w-[1180px] px-5 py-10 sm:px-8">
      <Block className="h-7 w-40" />
      <Block className="mt-2 h-4 w-72" />

      <div
        className={[
          "mt-8 grid grid-cols-1 gap-3 sm:grid-cols-2",
          columns >= 3 ? "lg:grid-cols-3" : "",
        ].join(" ")}
      >
        {Array.from({ length: columns * 2 }, (_, index) => (
          <div key={index} className="overflow-hidden rounded-[var(--radius-card)] border border-line">
            <Block className="aspect-[4/3] w-full rounded-none" />
            <div className="space-y-2 p-3">
              <Block className="h-4 w-2/3" />
              <Block className="h-3 w-1/2" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** 글이 이어지는 화면 — 요금제·약관처럼 읽는 화면 */
export function PageSkeleton() {
  return (
    <div className="mx-auto max-w-[1000px] px-5 py-10 sm:px-8">
      <Block className="h-8 w-52" />
      <Block className="mt-3 h-4 w-96" />

      <div className="mt-10 space-y-3">
        {Array.from({ length: 8 }, (_, index) => (
          <Block key={index} className={index % 3 === 2 ? "h-4 w-2/3" : "h-4 w-full"} />
        ))}
      </div>
    </div>
  );
}

/**
 * 편집기 — 리본·좌측 패널·캔버스·우측 패널.
 *
 * 편집기는 열리는 데 가장 오래 걸리는 화면이라(장면을 읽고 3D를 준비한다) 뼈대가
 * 실제 배치와 같아야 기다리는 동안 덜 답답하다.
 */
export function EditorSkeleton() {
  return (
    <div className="flex h-dvh flex-col bg-canvas">
      <div className="flex h-[76px] shrink-0 items-center gap-2 border-b border-line bg-surface px-4">
        {Array.from({ length: 8 }, (_, index) => (
          <Block key={index} className="h-9 w-16" />
        ))}
      </div>

      <div className="flex min-h-0 flex-1">
        <aside className="hidden w-[260px] shrink-0 flex-col gap-2 border-r border-line bg-surface p-3 lg:flex">
          <Block className="h-8 w-full" />
          <div className="grid grid-cols-2 gap-2">
            {Array.from({ length: 6 }, (_, index) => (
              <Block key={index} className="aspect-square w-full" />
            ))}
          </div>
        </aside>

        <main className="grid min-w-0 flex-1 place-items-center bg-[linear-gradient(#e9e8e5,#cfcdc8)]">
          <div className="flex flex-col items-center gap-3">
            <span className="h-7 w-7 animate-spin rounded-full border-2 border-line-strong border-t-transparent" />
            <p className="text-[12.5px] text-ink-soft">편집기를 여는 중입니다</p>
          </div>
        </main>

        <aside className="hidden w-[220px] shrink-0 flex-col gap-2 border-l border-line bg-surface p-3 xl:flex">
          <Block className="h-6 w-full" />
          <Block className="h-24 w-full" />
        </aside>
      </div>
    </div>
  );
}
