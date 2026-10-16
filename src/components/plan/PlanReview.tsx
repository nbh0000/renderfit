"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { FloorPlanDoc, Point } from "@renderfit/plan-schema";
import {
  addWall,
  deleteFixture,
  deleteOpening,
  deleteWall,
  flagPosition,
  mergeRooms,
  moveFixture,
  moveOpening,
  moveWallEnd,
  readyToConfirm,
  renameRoom,
  rescale,
  rotateFixture,
  setFixtureKind,
  setOpeningWidth,
  setWallThickness,
  splitRoom,
  type FlagVerdict,
  type PlanEdit,
} from "@/scene/planEdit";
import { PlanCanvas, type DragIntent, type Selection, type Tool } from "./PlanCanvas";
import { centerOn, fitView, reasonText, squareMetres, targetLabel, type View } from "./planView";

/**
 * 도면 검수 화면.
 *
 * ── 왜 이 화면이 있나 ──
 *
 * 자동으로 읽은 도면은 **절대 확정하지 않는다.** 파서가 아무리 잘 읽어도 도면마다
 * 사정이 다르고, 틀린 채로 3D 가 서면 사용자는 그것이 자기 도면인 줄 안다. 그래서
 * 여기를 지나야만 편집기·3D 로 넘어간다.
 *
 * 목표는 자동 완성이 아니라 **검수 시간을 줄이는 것**이다. 그래서 화면이 하는 일은
 * 세 가지다 — 원본과 겹쳐 보여 주고, 의심스러운 곳을 먼저 짚어 주고, 그 자리를
 * 바로 고치게 한다.
 */

/** 설비 종류 — 플레이스홀더의 종류를 바꿀 때 고른다 */
const FIXTURE_KINDS: [string, string][] = [
  ["refrigerator", "냉장고"],
  ["sink", "싱크대"],
  ["worktable", "작업대"],
  ["range", "가스레인지"],
  ["hood", "후드"],
  ["toilet", "변기"],
  ["basin", "세면대"],
  ["urinal", "소변기"],
  ["bathtub", "욕조"],
  ["shower", "샤워부스"],
  ["washer", "세탁기"],
  ["wardrobe", "붙박이장"],
  ["shoe-cabinet", "신발장"],
  ["table", "테이블"],
  ["counter", "카운터"],
  ["custom", "기타"],
];

interface Loaded {
  job: {
    id: string;
    projectId: string | null;
    route: string;
    fileName: string;
    imageUrl: string | null;
    reviewStatus: string;
  };
  doc: FloorPlanDoc;
}

export function PlanReview({ jobId }: { jobId: string }) {
  const router = useRouter();

  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [doc, setDoc] = useState<FloorPlanDoc | null>(null);
  const [history, setHistory] = useState<FloorPlanDoc[]>([]);
  const [edits, setEdits] = useState<PlanEdit[]>([]);
  const [verdicts, setVerdicts] = useState<Record<string, FlagVerdict>>({});

  const [view, setView] = useState<View>({ scale: 0.02, originX: 0, originY: 0 });
  /**
   * 사용자가 화면을 옮기거나 확대했는가.
   *
   * 그 전까지는 화면 크기가 바뀔 때마다 도면을 다시 맞춘다. 한 번만 맞추면 처음
   * 그려질 때 잰 크기(오른쪽 패널이 아직 없는 상태)로 굳어, 도면이 화면 밖으로
   * 삐져나간 채 뜬다. 실제로 그랬다.
   */
  const [touched, setTouched] = useState(false);
  const [tool, setTool] = useState<Tool>("select");
  const [pending, setPending] = useState<Point[]>([]);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [markedRooms, setMarkedRooms] = useState<string[]>([]);

  const [showOriginal, setShowOriginal] = useState(false);
  const [opacity, setOpacity] = useState(0.5);
  const [realLength, setRealLength] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const stage = useRef<HTMLDivElement>(null);
  /* 끌기가 시작될 때의 문서와 잡은 자리. 끄는 동안 기록을 쌓지 않으려고 들고 있는다 */
  const grabbed = useRef<{ doc: FloorPlanDoc; offset: Point } | null>(null);

  useEffect(() => {
    let alive = true;

    void fetch(`/api/plan/jobs/${jobId}`)
      .then(async (response) => {
        const data = await response.json();
        if (!alive) return;

        if (!response.ok) {
          setLoadError(data.error ?? "도면을 불러오지 못했습니다.");
          return;
        }

        setLoaded(data as Loaded);
        setDoc(data.doc as FloorPlanDoc);
      })
      .catch((error) => {
        if (alive) setLoadError(error instanceof Error ? error.message : "불러오지 못했습니다.");
      });

    return () => {
      alive = false;
    };
  }, [jobId]);

  /*
   * 도면 칸의 크기가 정해질 때마다 화면에 맞춘다.
   *
   * 문서를 받아 오는 콜백 안에서 재면 도면 칸이 아직 그려지기 전이라 엉뚱한 값이
   * 나온다. 그려진 뒤에 한 번 재도 오른쪽 패널이 붙기 전이면 또 어긋난다. 그래서
   * 크기가 바뀔 때마다 다시 맞추되, **사용자가 한 번이라도 화면을 옮겼으면 그만둔다** —
   * 보던 자리를 마음대로 되돌리면 그게 더 성가시다.
   */
  useEffect(() => {
    const node = stage.current;
    if (!node || !doc || touched) return;

    const fit = () => {
      const box = node.getBoundingClientRect();
      if (box.width > 10 && box.height > 10) setView(fitView(doc, box.width, box.height));
    };

    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(node);
    return () => observer.disconnect();
  }, [doc, touched]);

  if (loadError) {
    return (
      <div className="flex h-dvh items-center justify-center bg-canvas p-6 text-center">
        <div>
          <p className="text-[14px] text-danger">{loadError}</p>
          <button
            type="button"
            onClick={() => router.push("/projects")}
            className="mt-4 rounded-lg border border-line px-4 py-2 text-[13px] hover:bg-sunken"
          >
            프로젝트로 돌아가기
          </button>
        </div>
      </div>
    );
  }

  if (!loaded || !doc) {
    return (
      <div className="flex h-dvh items-center justify-center bg-canvas text-[13px] text-muted">
        도면을 불러오고 있습니다…
      </div>
    );
  }

  /* ── 문서를 고친다 ── */
  const apply = (result: { doc: FloorPlanDoc; edit: PlanEdit }, record = true) => {
    setHistory((stack) => [...stack.slice(-49), doc]);
    setDoc(result.doc);
    if (record && result.edit.target) setEdits((list) => [...list, result.edit]);
  };

  const undo = () => {
    const previous = history[history.length - 1];
    if (!previous) return;
    setHistory((stack) => stack.slice(0, -1));
    setDoc(previous);
    setEdits((list) => list.slice(0, -1));
  };

  /* ── 끌기 ── */
  const onDrag = (intent: DragIntent, point: Point, phase: "move" | "end") => {
    const base = grabbed.current?.doc ?? doc;
    const offset = grabbed.current?.offset ?? grabOffset(base, intent, point);
    if (!grabbed.current) grabbed.current = { doc: base, offset };

    const next = dragged(base, intent, point, offset);
    if (!next) return;

    if (phase === "move") {
      /* 끄는 동안에는 화면만 바꾼다 — 손을 떼기 전에는 기록하지 않는다 */
      setDoc(next.doc);
      return;
    }

    grabbed.current = null;
    setHistory((stack) => [...stack.slice(-49), base]);
    setDoc(next.doc);
    setEdits((list) => [...list, next.edit]);
  };

  /* ── 도구가 점을 찍었다 ── */
  const onToolPoint = (point: Point, roomId: string | null) => {
    const points = [...pending, point];

    if (tool === "wall" && points.length === 2) {
      apply(addWall(doc, points[0], points[1]));
      setPending([]);
      return;
    }

    if (tool === "split" && points.length === 2) {
      /* 첫 점이 놓인 방을 나눈다 */
      const target = roomAtPoint(doc, points[0]) ?? roomId;
      if (target) apply(splitRoom(doc, target, points[0], points[1]));
      setPending([]);
      return;
    }

    if (tool === "scale" && points.length === 2) {
      /* 실제 길이를 받아야 하므로 점만 들고 기다린다 */
      setPending(points);
      return;
    }

    setPending(points.slice(-2));
  };

  const flags = doc.review.flags;
  const canConfirm = readyToConfirm(doc, verdicts);
  const remaining = flags.filter((_, index) => !verdicts[String(index)]).length;

  const goTo = (target: string) => {
    const point = flagPosition(doc, target);
    const box = stage.current?.getBoundingClientRect();
    if (point && box) {
      setTouched(true);
      setView(centerOn(view, point, box.width, box.height));
    }

    if (doc.walls.some((item) => item.id === target)) setSelection({ kind: "wall", id: target });
    else if (doc.rooms.some((item) => item.id === target)) setSelection({ kind: "room", id: target });
    else if (doc.openings.some((item) => item.id === target)) {
      setSelection({ kind: "opening", id: target });
    } else if (doc.fixtures.some((item) => item.id === target)) {
      setSelection({ kind: "fixture", id: target });
    }
  };

  const confirm = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      const response = await fetch(`/api/plan/jobs/${jobId}/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ doc, edits, verdicts }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "확정하지 못했습니다.");

      /* 확정됐으니 이제 편집기로 넘어간다 */
      if (data.appliedTo) router.push(`/editor/${data.appliedTo}`);
      else router.push("/projects");
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "확정하지 못했습니다.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex h-dvh flex-col bg-canvas text-ink">
      {/* ── 도구 막대 ── */}
      <header className="flex shrink-0 flex-wrap items-center gap-3 border-b border-line bg-surface px-4 py-2">
        <span className="text-[13px] font-medium">도면 검수</span>
        <span className="truncate text-[12px] text-muted">{loaded.job.fileName}</span>

        <div className="flex gap-1">
          {(
            [
              ["select", "선택"],
              ["wall", "벽 그리기"],
              ["split", "방 나누기"],
              ["scale", "축척 재기"],
            ] as [Tool, string][]
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => {
                setTool(id);
                setPending([]);
              }}
              className={[
                "rounded-md px-2.5 py-1 text-[12px] transition-colors",
                tool === id ? "bg-ink text-white" : "bg-sunken text-muted hover:text-ink",
              ].join(" ")}
            >
              {label}
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={undo}
          disabled={history.length === 0}
          className="rounded-md bg-sunken px-2.5 py-1 text-[12px] text-muted hover:text-ink disabled:opacity-40"
        >
          되돌리기
        </button>

        <label className="flex items-center gap-1.5 text-[12px] text-muted">
          <input
            type="checkbox"
            checked={showOriginal}
            onChange={(event) => setShowOriginal(event.target.checked)}
          />
          처음 읽은 도면 겹쳐 보기
        </label>

        {loaded.job.imageUrl && (
          <label className="flex items-center gap-1.5 text-[12px] text-muted">
            원본 진하기
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={opacity}
              onChange={(event) => setOpacity(Number(event.target.value))}
              className="w-28"
            />
          </label>
        )}

        <div className="ml-auto flex items-center gap-2">
          <span className="text-[12px] text-muted">
            {remaining > 0 ? `확인할 곳 ${remaining}군데 남음` : "모두 확인했습니다"}
          </span>
          <button
            type="button"
            disabled={!canConfirm || saving}
            onClick={() => void confirm()}
            className="rounded-lg bg-accent px-4 py-1.5 text-[13px] font-medium text-white hover:bg-accent-hover disabled:opacity-40"
          >
            {saving ? "저장 중…" : "확인하고 편집기로"}
          </button>
        </div>
      </header>

      {saveError && (
        <p className="shrink-0 bg-sunken px-4 py-2 text-[12px] text-danger">{saveError}</p>
      )}

      <div className="flex min-h-0 flex-1">
        {/* ── 도면 ── */}
        <div ref={stage} className="relative min-w-0 flex-1">
          <PlanCanvas
            doc={doc}
            original={loaded.doc}
            imageUrl={loaded.job.imageUrl}
            showOriginal={showOriginal}
            opacity={opacity}
            view={view}
            onView={(next) => {
              setTouched(true);
              setView(next);
            }}
            tool={tool}
            selection={selection}
            markedRooms={markedRooms}
            onSelect={setSelection}
            onToolPoint={onToolPoint}
            onDrag={onDrag}
            pending={pending}
          />

          {tool !== "select" && (
            <p className="pointer-events-none absolute left-1/2 top-3 -translate-x-1/2 rounded-md bg-[#0b0d10]/90 px-3 py-1.5 text-[12px] text-white">
              {tool === "wall" && "벽이 될 두 점을 찍어 주세요."}
              {tool === "split" && "나눌 방을 가로지르는 두 점을 찍어 주세요."}
              {tool === "scale" && "길이를 아는 두 점을 찍고, 오른쪽에 실제 길이를 적어 주세요."}
            </p>
          )}
        </div>

        {/* ── 오른쪽 패널 ── */}
        <aside className="flex w-[320px] shrink-0 flex-col border-l border-line bg-surface">
          <div className="min-h-0 flex-1 overflow-auto">
            {/* 지적 목록 */}
            <section className="border-b border-line p-3">
              <h2 className="text-[12px] font-medium text-ink">
                확인할 곳 {flags.length}건
              </h2>

              {flags.length === 0 && (
                <p className="mt-2 text-[12px] text-muted">지적된 곳이 없습니다.</p>
              )}

              <ul className="mt-2 space-y-1.5">
                {flags.map((flag, index) => {
                  const verdict = verdicts[String(index)];

                  return (
                    <li
                      key={`${flag.target}-${index}`}
                      className={[
                        "rounded-md border p-2 text-[12px] transition-colors",
                        verdict
                          ? "border-line bg-sunken text-muted"
                          : "border-line-strong bg-canvas text-ink-soft",
                      ].join(" ")}
                    >
                      <button
                        type="button"
                        onClick={() => goTo(flag.target)}
                        className="block w-full text-left"
                      >
                        <span className="font-medium">{targetLabel(doc, flag.target)}</span>
                        <span className="mt-0.5 block leading-relaxed">
                          {reasonText(flag.reason)}
                        </span>
                      </button>

                      <div className="mt-1.5 flex gap-1">
                        {(
                          [
                            ["resolved", "해결"],
                            ["ignored", "무시"],
                          ] as [FlagVerdict, string][]
                        ).map(([id, label]) => (
                          <button
                            key={id}
                            type="button"
                            onClick={() =>
                              setVerdicts((current) =>
                                current[String(index)] === id
                                  ? omit(current, String(index))
                                  : { ...current, [String(index)]: id }
                              )
                            }
                            className={[
                              "rounded px-2 py-0.5 text-[11px]",
                              verdict === id
                                ? "bg-ink text-white"
                                : "bg-sunken text-muted hover:text-ink",
                            ].join(" ")}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>

            {/* 축척 */}
            <section className="border-b border-line p-3">
              <h2 className="text-[12px] font-medium">축척</h2>
              <p className="mt-1 text-[11.5px] leading-relaxed text-muted">
                {doc.scale.source === "user"
                  ? "직접 재서 넣은 값입니다."
                  : doc.scale.confidence >= 0.8
                    ? "도면의 치수 글자에서 얻었습니다."
                    : "확실하지 않습니다. 두 점을 찍어 재 주세요."}
              </p>

              {tool === "scale" && pending.length === 2 && (
                <div className="mt-2 flex gap-1.5">
                  <input
                    value={realLength}
                    onChange={(event) => setRealLength(event.target.value)}
                    placeholder="실제 길이 (mm)"
                    inputMode="numeric"
                    className="min-w-0 flex-1 rounded-md border border-line bg-canvas px-2 py-1 text-[12px]"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      const value = Number(realLength.replace(/,/g, ""));
                      if (!Number.isFinite(value) || value <= 0) return;
                      apply(rescale(doc, pending[0], pending[1], value));
                      setPending([]);
                      setRealLength("");
                      setTool("select");
                    }}
                    className="rounded-md bg-accent px-2.5 py-1 text-[12px] text-white"
                  >
                    적용
                  </button>
                </div>
              )}
            </section>

            {/* 고른 항목 */}
            <section className="p-3">
              <h2 className="text-[12px] font-medium">
                {selection ? "고른 항목" : "항목을 고르면 여기서 고칩니다"}
              </h2>

              {selection?.kind === "wall" &&
                (() => {
                  const wall = doc.walls.find((item) => item.id === selection.id);
                  if (!wall) return null;

                  return (
                    <div className="mt-2 space-y-2">
                      <label className="block text-[12px] text-muted">
                        두께 (mm)
                        <input
                          type="number"
                          value={wall.thickness}
                          onChange={(event) =>
                            apply(setWallThickness(doc, wall.id, Number(event.target.value)))
                          }
                          className="mt-1 w-full rounded-md border border-line bg-canvas px-2 py-1 text-[12px] text-ink"
                        />
                      </label>
                      <p className="text-[11px] text-muted">
                        끝점을 끌어 옮깁니다. 방과 면적이 바로 다시 계산됩니다.
                      </p>
                      <button
                        type="button"
                        onClick={() => {
                          apply(deleteWall(doc, wall.id));
                          setSelection(null);
                        }}
                        className="w-full rounded-md border border-line py-1.5 text-[12px] text-danger hover:bg-sunken"
                      >
                        벽 삭제
                      </button>
                    </div>
                  );
                })()}

              {selection?.kind === "room" &&
                (() => {
                  const room = doc.rooms.find((item) => item.id === selection.id);
                  if (!room) return null;

                  return (
                    <div className="mt-2 space-y-2">
                      <label className="block text-[12px] text-muted">
                        이름
                        <input
                          value={room.name ?? ""}
                          onChange={(event) => apply(renameRoom(doc, room.id, event.target.value))}
                          placeholder="예: 주방"
                          className="mt-1 w-full rounded-md border border-line bg-canvas px-2 py-1 text-[12px] text-ink"
                        />
                      </label>
                      <p className="text-[12px] text-muted">면적 {squareMetres(room.areaMm2)}</p>

                      <button
                        type="button"
                        onClick={() => {
                          /*
                           * 상태 갱신 함수 안에서 문서를 고치지 않는다. React 가 그
                           * 함수를 두 번 부를 수 있어서, 벽이 두 번 지워진다.
                           */
                          const next = markedRooms.includes(room.id)
                            ? markedRooms.filter((id) => id !== room.id)
                            : [...markedRooms, room.id];

                          if (next.length === 2) {
                            apply(mergeRooms(doc, next[0], next[1]));
                            setMarkedRooms([]);
                            setSelection(null);
                            return;
                          }
                          setMarkedRooms(next);
                        }}
                        className="w-full rounded-md border border-line py-1.5 text-[12px] hover:bg-sunken"
                      >
                        {markedRooms.includes(room.id)
                          ? "합치기 대상에서 빼기"
                          : markedRooms.length === 1
                            ? "이 방과 합치기"
                            : "합칠 방으로 표시"}
                      </button>
                    </div>
                  );
                })()}

              {selection?.kind === "opening" &&
                (() => {
                  const opening = doc.openings.find((item) => item.id === selection.id);
                  if (!opening) return null;

                  return (
                    <div className="mt-2 space-y-2">
                      <p className="text-[12px] text-muted">
                        {opening.kind === "window" ? "창" : "문"}
                      </p>
                      <label className="block text-[12px] text-muted">
                        폭 (mm)
                        <input
                          type="number"
                          value={opening.width}
                          onChange={(event) =>
                            apply(setOpeningWidth(doc, opening.id, Number(event.target.value)))
                          }
                          className="mt-1 w-full rounded-md border border-line bg-canvas px-2 py-1 text-[12px] text-ink"
                        />
                      </label>
                      <p className="text-[11px] text-muted">
                        가운데를 끌면 자리가, 양 끝을 끌면 폭이 바뀝니다.
                      </p>
                      <button
                        type="button"
                        onClick={() => {
                          apply(deleteOpening(doc, opening.id));
                          setSelection(null);
                        }}
                        className="w-full rounded-md border border-line py-1.5 text-[12px] text-danger hover:bg-sunken"
                      >
                        삭제
                      </button>
                    </div>
                  );
                })()}

              {selection?.kind === "fixture" &&
                (() => {
                  const fixture = doc.fixtures.find((item) => item.id === selection.id);
                  if (!fixture) return null;

                  return (
                    <div className="mt-2 space-y-2">
                      <label className="block text-[12px] text-muted">
                        종류
                        <select
                          value={FIXTURE_KINDS.some(([id]) => id === fixture.kind) ? fixture.kind : "custom"}
                          onChange={(event) => {
                            const found = FIXTURE_KINDS.find(([id]) => id === event.target.value);
                            apply(setFixtureKind(doc, fixture.id, event.target.value, found?.[1]));
                          }}
                          className="mt-1 w-full rounded-md border border-line bg-canvas px-2 py-1 text-[12px] text-ink"
                        >
                          {FIXTURE_KINDS.map(([id, label]) => (
                            <option key={id} value={id}>
                              {label}
                            </option>
                          ))}
                        </select>
                      </label>

                      <p className="text-[11px] leading-relaxed text-muted">
                        {fixture.source === "user"
                          ? "직접 놓은 자리입니다."
                          : "도면에서 잰 크기가 아니라 표준 규격입니다."}
                      </p>

                      <div className="flex gap-1.5">
                        <button
                          type="button"
                          onClick={() => apply(rotateFixture(doc, fixture.id, fixture.rotation + 90))}
                          className="flex-1 rounded-md border border-line py-1.5 text-[12px] hover:bg-sunken"
                        >
                          90° 회전
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            apply(deleteFixture(doc, fixture.id));
                            setSelection(null);
                          }}
                          className="flex-1 rounded-md border border-line py-1.5 text-[12px] text-danger hover:bg-sunken"
                        >
                          삭제
                        </button>
                      </div>
                    </div>
                  );
                })()}
            </section>
          </div>

          <p className="shrink-0 border-t border-line px-3 py-2 text-[11px] leading-relaxed text-muted">
            확인을 눌러야 편집기·3D 로 넘어갑니다. 지금까지 고친 {edits.length}건이 함께
            기록됩니다.
          </p>
        </aside>
      </div>
    </div>
  );
}

/* ───────────────────────── 끌기 계산 ───────────────────────── */

/** 벽 시작점에서 이 자리까지의 거리 (mm) */
function along(doc: FloorPlanDoc, wallId: string, point: Point): number {
  const wall = doc.walls.find((item) => item.id === wallId);
  if (!wall) return 0;

  const dx = wall.b[0] - wall.a[0];
  const dy = wall.b[1] - wall.a[1];
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq < 1e-6) return 0;

  const t = ((point[0] - wall.a[0]) * dx + (point[1] - wall.a[1]) * dy) / lengthSq;
  return t * Math.sqrt(lengthSq);
}

/** 잡은 자리와 항목 사이의 거리 — 끌 때 항목이 커서로 튀지 않게 한다 */
function grabOffset(doc: FloorPlanDoc, intent: DragIntent, point: Point): Point {
  if (intent.type === "fixture") {
    const fixture = doc.fixtures.find((item) => item.id === intent.id);
    return fixture ? [point[0] - fixture.bbox[0], point[1] - fixture.bbox[1]] : [0, 0];
  }

  if (intent.type === "opening-move") {
    const opening = doc.openings.find((item) => item.id === intent.id);
    return opening ? [along(doc, opening.wallId, point) - opening.offset, 0] : [0, 0];
  }

  return [0, 0];
}

function dragged(
  doc: FloorPlanDoc,
  intent: DragIntent,
  point: Point,
  offset: Point
): { doc: FloorPlanDoc; edit: PlanEdit } | null {
  if (intent.type === "wall-end") {
    return moveWallEnd(doc, intent.id, intent.end, point);
  }

  if (intent.type === "fixture") {
    return moveFixture(doc, intent.id, [point[0] - offset[0], point[1] - offset[1]]);
  }

  const opening = doc.openings.find((item) => item.id === intent.id);
  if (!opening) return null;

  const distance = along(doc, opening.wallId, point);

  if (intent.type === "opening-move") {
    return moveOpening(doc, intent.id, distance - offset[0]);
  }

  if (intent.side === "end") {
    return setOpeningWidth(doc, intent.id, distance - opening.offset);
  }

  /* 시작 손잡이를 끌면 끝을 붙잡아 둔 채 폭과 자리가 함께 바뀐다 */
  const far = opening.offset + opening.width;
  const moved = moveOpening(doc, intent.id, distance);
  return setOpeningWidth(moved.doc, intent.id, far - distance);
}

function roomAtPoint(doc: FloorPlanDoc, point: Point): string | null {
  for (const room of doc.rooms) {
    if (room.polygon.length < 3) continue;

    let inside = false;
    for (let index = 0; index < room.polygon.length; index += 1) {
      const [x1, y1] = room.polygon[index];
      const [x2, y2] = room.polygon[(index + 1) % room.polygon.length];

      if (y1 > point[1] !== y2 > point[1]) {
        const cross = x1 + ((point[1] - y1) / (y2 - y1)) * (x2 - x1);
        if (cross > point[0]) inside = !inside;
      }
    }

    if (inside) return room.id;
  }

  return null;
}

function omit(record: Record<string, FlagVerdict>, key: string): Record<string, FlagVerdict> {
  const copy = { ...record };
  delete copy[key];
  return copy;
}
