@AGENTS.md

# 렌더핏 (RENDERFIT)

사진이나 평면도 한 장을 넣으면 도면·3D·인테리어 시안을 만들어 주는 서비스.
Next.js 16 + Supabase + Gemini, Railway에 `main` 푸시로 배포된다.

## 어디에 무엇이 있나

```
packages/plan-schema/   FloorPlanDoc — 도면이 들어오는 세 경로가 모두 수렴하는 스키마
services/plan-ingest/   도면 파싱 (Python). ezdxf 파서·벡터화·라벨러가 여기 있다
scene/            도면·3D의 자료 구조와 계산 (순수 함수 — 여기가 시험 대상이다)
  engine/         SceneEngine — 모든 편집이 지나가는 곳. operation으로 기록돼 되돌리기가 된다
  planDoc.ts      FloorPlanDoc ↔ Scene 어댑터
  planPolygonize.ts  벽 → 방 폴리곤·면적 (파이썬 shapely 와 답이 같아야 한다)
  planEdit.ts     검수 화면의 편집 도구 (전부 순수 함수)
  placement.ts    좌표 규칙. 평면 좌표 ↔ 3D 좌표 변환이 전부 여기 모여 있다
ai/providers/     Gemini 호출 (이미지 생성·렌더·가구 규격). 도면 좌표는 여기서 나오지 않는다
ai/tools/         편집 도구 목록. 편집기와 AI 명령이 같은 도구를 쓴다
services/         프로젝트 불러오기·저장·백그라운드 잡, 도면 들여오기
src/components/editor/  편집기 화면 (평면도·3D·속성·에셋)
src/components/plan/    도면 검수 화면 (/plan/[jobId]/review)
src/lib/          클라이언트 상태(store.ts), 크레딧, 결제
supabase/         스키마와 마이그레이션 (사람이 SQL Editor에서 실행한다)
```

## 반드시 지키는 것

**좌표 규칙을 새로 만들지 않는다.** 평면 좌표와 3D 좌표를 오가는 계산은 전부
`scene/placement.ts`에 있다. 회전 0도는 가구의 정면이 y가 작아지는 쪽(도면 아래)을
보는 상태다. 이 규칙이 흩어지면 3D에서 소파가 벽을 보고 앉는다.

**편집은 SceneEngine을 지난다.** Scene을 직접 고치면 되돌리기가 깨진다. 방과 가구가
함께 바뀌는 조작은 `RESIZE_ROOM` 하나로 커밋해 되돌리기 한 번에 원래대로 오게 한다.

**드래그는 손을 뗄 때 한 번만 보낸다.** 예전에 pointermove마다 서버로 보내 되돌리기가
스무 칸씩 쌓였다. `runTool`의 `{ send: false }`로 끄는 동안은 화면만 바꾼다.

**기하는 LLM 이 만들지 않는다.** 그림을 비전 모델에 넣어 좌표 JSON 을 받던 구조는
폐기했다 — 모델은 좌표를 측정하지 못하고 추측한다. 벽·문·창·방 폴리곤은 DXF 파서와
전용 벡터화 모델만 만들고, LLM 은 확정된 기하 위에 방 이름과 설비 종류만 붙인다.

**자동 결과는 확정하지 않는다.** 들여온 도면은 `review.status`가 `"confirmed"`가 되기
전에는 편집기·3D 로 넘어가지 않는다. 사람이 `/plan/[jobId]/review` 를 지나야 한다.

**유료 API를 검증에 쓰지 않는다.** 호출 하나하나가 사용자 돈이다. 후처리는 고정
자료로 시험하고, 화면 확인은 이미 만들어 둔 프로젝트를 연다.

**AI 기능은 크레딧을 쓴다.** 편집기에서 Gemini를 부르는 경로를 새로 만들면
`src/lib/credits.ts`의 `chargeCredits`를 반드시 붙인다. 안 붙이면 공짜로 돌아간다.

## 개발 서버

```bash
npm run dev
curl -s localhost:3000/api/health   # supabase: true 인지 확인
```

환경변수를 지우고 띄우면 갤러리·보관함이 통째로 비어 보인다. 사용자가 이걸 "기능이
삭제됐다"고 받아들이므로, 확인이 끝나면 반드시 정상 모드로 되돌려 놓는다.

## 자주 쓰는 스킬

- `/ship` — 커밋·푸시 전 검사 절차
- `/scan-check` — 도면 스캔 품질 확인
- `/write-korean` — 주석·커밋·문구 쓰는 방식

## 출시 관련

`LAUNCH.md`에 유료 출시까지 남은 일이 정리돼 있다. 사업자 정보(`config/business.ts`)가
비어 있으면 결제 경로가 스스로 막히도록 돼 있다 — 일부러 그렇게 한 것이니 풀지 않는다.
