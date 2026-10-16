# 렌더핏 (RENDERFIT) — AI Interior Design Studio

도면을 올리면 **편집 가능한 Scene**(평면도·3D·둘러보기)을 만들고, 그 위에서 객체를 선택·이동·교체하거나
자연어로 명령해 디자인을 완성하는 웹 기반 인테리어 디자인 스튜디오입니다.

> 결과물은 이미지 파일 하나가 아니라
> `Walls + Openings + Rooms + Fixtures + Objects + Materials + Camera + Lighting`
> 을 담은 **Scene Graph**입니다.

## 도면이 들어오는 세 경로

**기하(벽·문·창·방 폴리곤)는 LLM 이 만들지 않는다.** 비전 모델은 좌표를 측정하지 못하고
추측한다 — 방이 빠지고, 면적이 뒤바뀌고, 벽이 끊긴다. 그래서 좌표는 DXF 파서와 전용
벡터화 모델만 만들고, LLM 은 **이미 확정된 기하 위에 이름만** 붙인다.

세 경로 모두 하나의 스키마([`FloorPlanDoc`](packages/plan-schema/index.ts))로 수렴하고,
사람이 검수 화면에서 확인을 누르기 전에는 편집기·3D 로 넘어가지 않는다.

```
                          POST /api/plan/ingest
                                    │
                     매직바이트로 갈래를 정한다
                       (services/planIngest.ts)
                                    │
        ┌───────────────────┬───────┴───────────┬───────────────────┐
        │                   │                   │                   │
    ① cad               ② cad-pdf           ③ raster            (알 수 없음)
    DXF · DWG           벡터 PDF        스캔 · 캡처 이미지          415 거절
        │                   │                   │
  DWG 는 ODA 로            (미구현)      사용자가 도면 영역 크롭
  DXF 를 거친다             501            ↓
        │                                전처리 (업스케일 · 이진화)
  ezdxf 로 좌표를                              ↓
  그대로 읽는다                          벡터화 모델 (RasterScan)
        │                                      ↓
        │                                치수 글자 OCR → mm 배율
        │                                      │
        └───────────────────────┬──────────────┘
                                │
                         FloorPlanDoc
                  mm · x→오른쪽 · y→위쪽
                  원점 = 도면 외곽 좌하단
                                │
                    LLM 라벨러 (raster/label.py)
                 방 이름과 설비 종류만. 좌표는 묻지 않는다
                                │
                                ▼
                     /plan/[jobId]/review
                    ← 사람이 반드시 지나는 곳 →
        원본 겹쳐 보기 · 벽/방/개구부/설비 수정 · 축척 재지정
        지적(review.flags)을 전부 해결하거나 무시해야 확인 가능
                                │
                   review.status = "confirmed"
                                ▼
              Scene — 평면도 · 3D · 둘러보기 · 도면 내보내기
```

| | 정확도 | 사람이 할 일 |
|---|---|---|
| ① DXF · DWG | 가장 높다 (파일에 좌표가 그대로 있다) | 실 이름 확인 |
| ② 벡터 PDF | ①과 같아질 예정 | — (아직 501) |
| ③ 이미지 · PDF 캡처 | 추정이 섞인다 | 크롭 → 검수에서 교정 |

사진(방 사진)은 이 경로에 들어가지 않는다. 시안 이미지를 만드는 바탕으로만 쓴다.

## 빠르게 실행하기

```bash
npm install
npm run dev          # http://localhost:3000
npm run seed         # (다른 터미널) 데모 프로젝트 "Japandi Living Room" 생성
```

환경변수가 **하나도 없어도** 전체 기능이 동작합니다(Demo Mode). Mock provider가 실제 provider와 동일한
인터페이스로 붙고, 데이터는 `.data/`에 저장됩니다.

```bash
npm run build        # 프로덕션 빌드
npm run lint         # ESLint (flat config)
npm run typecheck    # tsc --noEmit
npm test             # vitest (Scene Engine · AI Router)
```

## 화면

| 경로 | 설명 |
| --- | --- |
| `/dashboard` | 프로젝트 목록, 새 프로젝트, 데모 프로젝트, 현재 연결된 provider 상태 |
| `/editor/[id]` | 메인 에디터 — 툴바 / 좌측(에셋·재질·스타일·조명·AI) / 캔버스 / 우측(속성·레이어) / 하단 AI Command Bar |
| `/studio` | 빠른 생성 (사진 → 시안 4장, 마스킹·배치도 포함) |
| `/projects` | 빠른 생성 결과를 모아 두는 폴더 |
| `/gallery` | 공개 동의한 시안의 SEO 페이지 |
| `/pricing` | 요금제 (토스페이먼츠 실연동은 TODO) |

## 아키텍처

```
packages/plan-schema/  FloorPlanDoc — 세 경로가 수렴하는 하나의 도면 문서
services/plan-ingest/  도면 파싱 마이크로서비스 (Python · ezdxf · shapely · opencv)

scene/                 Scene Engine (React 비의존 순수 모듈)
  types/               Scene · SceneObject · Operation 데이터 모델
  engine/              SceneEngine — 모든 편집의 단일 진입점, undo/redo
  operations/          operation 적용/역적용 (patch 기반)
  validation/          zod 스키마 + operation 검증
  serialization/       Scene 생성 · JSON 직렬화 · 버전 스냅샷

ai/
  providers/           Generation·LLM·Rendering·Embedding 인터페이스 (Vision 은 폐기)
  providers/mock/      API key 없이 전체 흐름을 돌리는 Mock 구현
  router/              자연어 → intent + target 판별 (규칙 기반)
  tools/               Agent tool 정의 + Scene Engine 실행기

models/                에셋 26종 · 재질 17종 · 스타일 9종 카탈로그
services/              프로젝트 서비스 (저장·AI 커맨드), 도면 들여오기, 데모 시드
src/components/plan/   도면 검수 화면 (/plan/[jobId]/review)
lib/                   storage(local/S3) · db(local/Supabase) · queue(job)
src/components/editor/ Toolbar · Canvas(2.5D/3D) · Layers · Properties · Assets · AICommandBar
```

### 핵심 원칙

- **Scene 조작 로직은 React 밖에 있다.** UI는 `SceneEngine`을 호출하고 결과만 렌더링합니다.
- **모든 변경은 operation이다.** 드래그도, AI 명령도 같은 경로를 지나므로 undo/redo가 항상 동작합니다.
- **LLM은 Scene JSON을 직접 수정하지 않는다.** 반드시 tool call을 만들고, 엔진이 검증 후 실행합니다.
- **잘못된 operation은 Scene에 닿지 않는다.** 존재하지 않는 객체, 잠긴 객체, 음수 스케일 등은 거부됩니다.

## AI 파이프라인

| 단계 | Provider | 현재 구현 |
| --- | --- | --- |
| 도면 → 기하 | (provider 아님) | `services/plan-ingest` — ezdxf 파서 · 벡터화 모델 |
| 확정된 기하 → 이름 | (provider 아님) | `services/plan-ingest/raster/label.py` — Gemini, 좌표는 묻지 않는다 |
| 세그멘테이션 | `SegmentationProvider` | Mock (SVG 맵) |
| 깊이 추정 | `DepthProvider` | Mock (SVG 맵) |
| 이미지 생성 · 인페인팅 | `GenerationProvider` | **Gemini 실연동** (키 없으면 Mock) |
| 자연어 명령 | `LLMProvider` | 규칙 기반 라우터 / `ANTHROPIC_API_KEY` 있으면 Messages API |
| 렌더 | `RenderingProvider` | Mock (Scene을 실제로 반영한 SVG 렌더) |
| 임베딩 검색 | `EmbeddingProvider` | Mock (키워드 검색이 실동작) |

Mock을 실제 모델로 바꾸려면 `ai/providers/index.ts`의 팩토리에서 해당 줄만 교체하면 됩니다.

## AI Command 예시

```
"소파를 베이지색으로 바꿔줘"          → change_color
"소파 삭제"                          → delete_object
"소파를 왼쪽으로 옮겨줘"              → move_object
"테이블을 조금 작게"                  → scale_object
"이 공간을 Japandi로"                → change_style + 생성 job
"조명을 더 밝게"                      → change_lighting
"소파를 삭제하고 라운지체어 두 개를 추가해줘"  → 복합 명령 (3개 tool call)
```

## 단축키

`V` 선택 · `M` 이동 · `R` 회전 · `S` 크기 · `G` 그리드 · `1/2/3` 뷰 전환 ·
`Delete` 삭제 · `D` 복제 · `Esc` 선택 해제 · `Ctrl+Z` / `Ctrl+Shift+Z` 실행 취소·재실행 · `Ctrl+C/V` 복사·붙여넣기

## 배포

| 항목 | 값 |
| --- | --- |
| 레포 | https://github.com/nbh0000/renderfit (private) |
| 서버 | Railway (main 브랜치 push → 자동 배포) |
| DB · 인증 · 스토리지 | Supabase |
| 이미지 생성 | Gemini |
| CI | GitHub Actions — typecheck · lint · test · build |

배포 절차와 환경변수는 **[DEPLOY.md](./DEPLOY.md)** 를 따르세요. 배포 후 `/api/health`로 연결 상태를 확인할 수 있습니다.

## 실환경 연결

1. `.env.example` → `.env.local` 복사 후 값 입력
2. Supabase SQL Editor에서 `supabase/schema.sql`(빠른 생성용)과 `supabase/design-schema.sql`(에디터용) 실행
3. Authentication → Providers → Google 활성화, Redirect URL에 `/auth/callback` 등록
4. `GEMINI_API_KEY`를 넣으면 실제 이미지 생성이, `ANTHROPIC_API_KEY`를 넣으면 LLM 라우팅이 켜집니다

## 주의 사항

- 생성물은 참고용 시안이며 시공용 도면이 아닙니다.
- 참고용 배치도에는 치수를 넣지 않으며, 화면·다운로드 파일 모두에 고지가 고정으로 들어갑니다.
- 무료 플랜 결과물에는 화면과 다운로드 파일 양쪽에 워터마크가 들어갑니다.
