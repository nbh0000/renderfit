"use client";

import { useEffect, useState } from "react";
import { isCoarsePointer } from "./coarsePointer";

/**
 * 걷기 모드의 화면 위 안내.
 *
 * Canvas 바깥의 평범한 DOM 이다. 3D 안에 그리면 매 프레임 다시 그려지는데, 여기 있는
 * 것들은 잠금 상태와 실 이름이 바뀔 때만 달라진다 — 그 둘만 props 로 받는다.
 * 카메라 좌표 같은 매 프레임 값은 절대 여기로 올리지 않는다.
 */

export interface WalkOverlayProps {
  /** 마우스가 잠겨 있는지 */
  locked: boolean;
  /** 잠금을 못 걸어 드래그로 둘러봐야 하는 상황 */
  fallbackDrag: boolean;
  /** 지금 서 있는 실 이름 */
  roomName: string | null;
  /**
   * 손가락으로 한 번이라도 조작했는지.
   *
   * 터치에는 잠금이라는 개념이 없어서 locked 로는 안내를 접을 시점을 알 수 없다.
   * 첫 손가락이 닿으면 접는다 — 조작법을 알았다는 뜻이다.
   */
  touched: boolean;
  /** 브라우저가 잠금 재요청을 잠깐 막고 있는 상태 */
  cooldown: boolean;
  onExit: () => void;
}

export function WalkOverlay({
  locked,
  fallbackDrag,
  roomName,
  touched,
  cooldown,
  onExit,
}: WalkOverlayProps) {
  /*
   * 손가락 기기인지는 그린 뒤에 정한다.
   *
   * matchMedia 와 "손가락이 닿은 적 있는지"는 서버에서 알 수 없다. 그리는 도중에
   * 읽으면 서버가 그린 것과 브라우저가 그린 것이 달라 하이드레이션이 어긋난다.
   */
  const [coarse, setCoarse] = useState(false);
  useEffect(() => setCoarse(isCoarsePointer()), [touched]);

  /* 터치에는 잠금이 없다 — 안내를 접는 신호가 다르다 */
  const guideOpen = coarse ? !touched : !locked;

  return (
    <div className="pointer-events-none absolute inset-0">
      {/* 현재 실 — 문을 지날 때 바뀐다. 평면도의 이름표와 같은 모양으로 둔다 */}
      {roomName && (
        <div className="absolute right-3 top-3 rounded bg-white/85 px-1.5 py-0.5 text-[11px] font-medium text-ink shadow-sm">
          {roomName}
        </div>
      )}

      {/*
        손가락 기기의 나가기.

        데스크톱은 Esc 로 마우스를 풀면 카드가 다시 떠서 거기서 나가면 된다. 터치에는
        그 카드가 다시 뜰 계기가 없어서, 나갈 방법을 늘 열어 둬야 한다.
      */}
      {coarse && (
        <button
          type="button"
          onClick={onExit}
          className="pointer-events-auto absolute left-3 top-3 rounded-md border border-line bg-surface/90 px-2.5 py-1 text-[11.5px] text-ink-soft shadow-sm"
        >
          나가기
        </button>
      )}

      {!guideOpen ? (
        <>
          {/*
            조준점.

            1인칭에서 화면 한가운데에 아무 표시가 없으면 어디를 보고 있는지 감이 안 잡힌다.
            배경 색을 반전시켜 밝은 벽에서도 어두운 바닥에서도 보이게 한다.
          */}
          {/* 터치에서는 조준점을 안 띄운다 — 겨눌 것이 없고 화면만 지저분해진다 */}
          {!coarse && (
            <span className="absolute left-1/2 top-1/2 h-1 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/70 mix-blend-difference" />
          )}

          <KeyLegend coarse={coarse} />
        </>
      ) : (
        /*
          카드는 클릭을 받지 않는다.

          카드를 눌러도 그 아래 캔버스가 클릭을 받아 마우스가 잠겨야 한다. 카드가
          클릭을 삼키면 "화면을 클릭하세요"라고 써 놓고 정작 그 자리를 누르면 아무 일도
          안 일어난다. 나가기 버튼만 예외로 클릭을 받는다.
        */
        <div className="absolute inset-0 flex items-center justify-center transition-opacity duration-150">
          <div className="pointer-events-none rounded-[var(--radius-card)] border border-line bg-surface/90 px-5 py-4 text-center shadow-lg">
            <p className="text-[13px] font-semibold text-ink">둘러보기</p>

            <p className="mt-1.5 text-[11.5px] leading-relaxed text-muted">
              {cooldown ? (
                /*
                 * 잠금을 푼 직후에는 브라우저가 재요청을 잠깐 막는다. 그때 클릭하면
                 * 아무 일도 안 일어나는데, 안내가 없으면 고장으로 보인다.
                 */
                <>잠시 후 다시 클릭해 주세요</>
              ) : coarse ? (
                <>
                  왼쪽을 누른 채 움직여 걷기
                  <br />오른쪽을 쓸어 둘러보기
                </>
              ) : fallbackDrag ? (
                <>
                  마우스를 누른 채 움직여 둘러보기
                  <br />W A S D 이동 · Space 떠오르기 · Shift 달리기
                </>
              ) : (
                <>
                  화면을 클릭하면 마우스로 둘러볼 수 있습니다
                  <br />W A S D 이동 · Space 떠오르기 · Shift 달리기 · Esc 마우스 풀기
                </>
              )}
            </p>

            {!coarse && (
              <button
                type="button"
                onClick={onExit}
                className="pointer-events-auto mt-3 rounded-md border border-line px-2.5 py-1 text-[11.5px] text-ink-soft transition-colors hover:bg-sunken"
              >
                나가기
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * 키 안내 — 걷는 내내 띄워 둔다.
 *
 * 처음에는 잠근 직후 5초만 띄우고 지웠다. 화면을 깨끗이 두려는 것이었는데, 정작
 * 쓰는 사람은 5초 안에 다 외우지 못한다. 떠오르기(Space)나 내려오기(C)처럼 자주 안
 * 쓰는 것은 필요할 때가 돼서야 찾게 되는데 그때는 안내가 이미 사라져 있다.
 *
 * 그래서 계속 둔다. 대신 아주 작고 반투명하게 두어 시야를 가리지 않게 한다 —
 * 화면 아래 구석은 걷는 동안 볼 일이 거의 없는 자리다.
 */
function KeyLegend({ coarse }: { coarse: boolean }) {
  /* 손가락 기기에는 누를 키가 없다 — 조작법만 한 줄 */
  if (coarse) {
    return (
      <div className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-md bg-black/45 px-2.5 py-1 text-[10.5px] text-white/75 backdrop-blur-sm">
        왼쪽 이동 · 오른쪽 쓸어 둘러보기
      </div>
    );
  }

  return (
    <div className="absolute bottom-3 left-3 rounded-md bg-black/45 px-2.5 py-1.5 backdrop-blur-sm">
      <ul className="flex flex-col gap-1 text-[10.5px] leading-none text-white/75">
        <Row keys={["W", "A", "S", "D"]} label="이동" />
        <Row keys={["Shift"]} label="달리기" />
        <Row keys={["Space"]} label="떠오르기" />
        <Row keys={["C"]} label="내려오기" />
        <Row keys={["Esc"]} label="마우스 풀기" />
      </ul>
    </div>
  );
}

/** 키 하나(또는 여러 개) + 무엇을 하는지 */
function Row({ keys, label }: { keys: string[]; label: string }) {
  return (
    <li className="flex items-center gap-1.5">
      <span className="flex gap-0.5">
        {keys.map((key) => (
          <kbd
            key={key}
            className="rounded border border-white/25 bg-white/15 px-1 py-0.5 font-sans text-[9.5px] text-white/90"
          >
            {key}
          </kbd>
        ))}
      </span>
      <span>{label}</span>
    </li>
  );
}
