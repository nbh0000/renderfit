# 배포 가이드 — Railway + Supabase + Gemini

구성: **Railway**(Next.js 서버) · **Supabase**(인증 · PostgreSQL · Storage) · **Gemini**(이미지 생성)

Railway는 상시 실행 서버라 이 앱의 백그라운드 잡(분석·생성·렌더)이 서버리스 타임아웃 없이 그대로 동작합니다.
대신 **파일시스템이 재배포마다 초기화**되므로, 업로드·생성 파일은 반드시 Supabase Storage에 저장해야 합니다
(`SUPABASE_SERVICE_ROLE_KEY`가 있으면 자동으로 그렇게 동작합니다).

---

## 1. Supabase 준비

### 1-1. 프로젝트 생성
[supabase.com](https://supabase.com) → New project → 리전은 `Northeast Asia (Seoul)` 권장.

### 1-2. SQL 실행 (SQL Editor에서 순서대로)
1. `supabase/schema.sql` — 프로필·크레딧·빠른 생성(job/결과)·`sources`/`results` 버킷
2. `supabase/design-schema.sql` — 에디터용 `design_projects` 등 + **`scene-files` 비공개 버킷**

실행 후 Storage 탭에서 버킷 3개(`sources`, `results`, `scene-files`)가 보이면 정상입니다.

### 1-3. 구글 로그인
Authentication → Providers → Google 활성화 후, Google Cloud Console에서 OAuth 클라이언트를 만들어
Client ID/Secret을 넣습니다. Authorized redirect URI에는 Supabase가 알려주는
`https://<프로젝트>.supabase.co/auth/v1/callback` 을 등록합니다.

Authentication → URL Configuration
- Site URL: `https://<railway-도메인>`
- Redirect URLs: `https://<railway-도메인>/auth/callback`, `http://localhost:3000/auth/callback`

### 1-4. 키 확인
Project Settings → API 에서
- `Project URL` → `NEXT_PUBLIC_SUPABASE_URL`
- `anon public` → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `service_role` → `SUPABASE_SERVICE_ROLE_KEY` (**서버 전용, 절대 클라이언트에 노출 금지**)

---

## 2. Gemini 키

[Google AI Studio](https://aistudio.google.com/apikey)에서 API 키를 발급받아 `GEMINI_API_KEY`에 넣습니다.
모델은 기본값 `gemini-2.5-flash-image`(Nano Banana)이며 `GEMINI_IMAGE_MODEL`로 바꿀 수 있습니다.

키를 넣는 즉시 Mock 대신 실제 생성이 동작합니다. 모델이 특정 옵션(`imageSize` 등)을 지원하지 않으면
자동으로 옵션을 낮춰 재시도하므로 모델 교체 시 코드 수정이 필요 없습니다.

---

## 3. Railway 배포

### 3-1. 코드 올리기
```bash
git init
git add .
git commit -m "AI Interior Design Studio"
git branch -M main
git remote add origin https://github.com/<계정>/<레포>.git
git push -u origin main
```

### 3-2. 서비스 생성
Railway → New Project → Deploy from GitHub repo → 이 레포 선택.
`railway.json`이 있어서 빌드/시작 명령과 헬스체크(`/api/health`)는 자동으로 잡힙니다.

- Build: `npm ci && npm run build`
- Start: `npm run start` (Next가 Railway의 `PORT`를 자동으로 사용합니다)

### 3-3. 환경변수 (Variables 탭)

| 변수 | 값 |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | anon public 키 |
| `SUPABASE_SERVICE_ROLE_KEY` | service_role 키 (필수 — Storage 저장·크레딧 환불에 사용) |
| `GEMINI_API_KEY` | Gemini API 키 |
| `NEXT_PUBLIC_SITE_URL` | `https://<railway-도메인>` |
| `NODE_ENV` | `production` |

선택: `GEMINI_IMAGE_MODEL`, `ANTHROPIC_API_KEY`(AI 명령 라우팅을 LLM으로 승격), `SUPABASE_SCENE_BUCKET`

> `NEXT_PUBLIC_*` 값은 **빌드 시점에 박히므로**, 도메인이 정해진 뒤 변수에 넣고 **재배포**해야 합니다.

### 3-4. 도메인
Settings → Networking → Generate Domain (또는 커스텀 도메인 연결) →
그 도메인을 `NEXT_PUBLIC_SITE_URL`과 Supabase Redirect URLs에 반영하고 재배포합니다.

---

## 4. 배포 후 점검

```bash
curl https://<도메인>/api/health
```

기대 응답:
```json
{
  "ok": true,
  "supabase": true,
  "serviceRole": true,
  "gemini": true,
  "providers": { "generation": "gemini", "storage": "supabase", "llm": "mock-llm", ... }
}
```

- `storage`가 `local`이면 → `SUPABASE_SERVICE_ROLE_KEY`가 빠진 것입니다(재배포 시 파일이 사라집니다).
- `generation`이 `mock-generation`이면 → `GEMINI_API_KEY`가 빠진 것입니다.

이어서 브라우저에서
1. `/login` → 구글 로그인
2. `/dashboard` → 새 프로젝트 → 방 사진 업로드 → 분석 완료 확인
3. 스타일 선택 → 생성(실제 Gemini 호출) → 결과 반영 확인
4. 객체 선택·이동 → `Ctrl+Z` → 렌더 → 내보내기

---

## 5. 비용·운영 메모

- 이미지 생성은 **호출당 과금**입니다. 동일 입력은 캐시되지만(프로세스 메모리), 재배포하면 초기화됩니다.
  과금이 걱정되면 `config/plans.ts`의 크레딧 정책으로 제한하세요.
- 백그라운드 잡은 **인스턴스 메모리**에 있습니다. 인스턴스를 여러 개로 늘리면 잡 상태 조회가 어긋날 수 있으니,
  스케일아웃 전에 `lib/queue`를 Redis 기반으로 교체하세요(인터페이스는 그대로).
- Scene 파일은 비공개 버킷에 있고 `/api/files/*`가 로그인 사용자에게만 중계합니다.
  프로젝트 소유자 단위 검사는 아직 TODO입니다.
- 무료 플랜 워터마크·배치도 고지는 클라이언트 canvas에서 굽습니다(다운로드 파일에 포함).
