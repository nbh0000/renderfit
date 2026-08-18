# 렌더핏 (RENDERFIT) — AI Interior Design Studio

사진 한 장을 올리면 AI가 공간을 분석해 **편집 가능한 Scene**을 만들고, 그 위에서 객체를 선택·이동·교체하거나
자연어로 명령해 디자인을 완성하는 웹 기반 인테리어 디자인 스튜디오입니다.

> 결과물은 이미지 파일 하나가 아니라
> `Image + Segmentation + Depth + Objects + Transforms + Materials + Assets + Camera + Lighting`
> 을 담은 **Scene Graph**입니다.

```
User Image → AI Vision Analysis → Scene Graph → AI Generation → Editable Scene → Professional Editor → Final Render
```

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
scene/                 Scene Engine (React 비의존 순수 모듈)
  types/               Scene · SceneObject · Operation 데이터 모델
  engine/              SceneEngine — 모든 편집의 단일 진입점, undo/redo
  operations/          operation 적용/역적용 (patch 기반)
  validation/          zod 스키마 + operation 검증
  serialization/       Scene 생성 · JSON 직렬화 · 버전 스냅샷

ai/
  providers/           Vision·Segmentation·Depth·Generation·Embedding·LLM·Rendering 인터페이스
  providers/mock/      API key 없이 전체 흐름을 돌리는 Mock 구현
  router/              자연어 → intent + target 판별 (규칙 기반)
  tools/               Agent tool 정의 + Scene Engine 실행기

models/                에셋 26종 · 재질 17종 · 스타일 9종 카탈로그
services/              프로젝트 서비스 (저장·AI 파이프라인·AI 커맨드), 데모 시드
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
| 방 분석 · 객체 인식 | `VisionProvider` | Mock (방 종류별 배치 청사진) |
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

## 실환경 연결

1. `.env.example` → `.env.local` 복사 후 값 입력
2. Supabase SQL Editor에서 `supabase/schema.sql`(빠른 생성용)과 `supabase/design-schema.sql`(에디터용) 실행
3. Authentication → Providers → Google 활성화, Redirect URL에 `/auth/callback` 등록
4. `GEMINI_API_KEY`를 넣으면 실제 이미지 생성이, `ANTHROPIC_API_KEY`를 넣으면 LLM 라우팅이 켜집니다

## 주의 사항

- 생성물은 참고용 시안이며 시공용 도면이 아닙니다.
- 참고용 배치도에는 치수를 넣지 않으며, 화면·다운로드 파일 모두에 고지가 고정으로 들어갑니다.
- 무료 플랜 결과물에는 화면과 다운로드 파일 양쪽에 워터마크가 들어갑니다.
