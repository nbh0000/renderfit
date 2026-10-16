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

이미 운영 중인 DB라면 `schema.sql`을 다시 돌리는 대신 변경분만 적용합니다.
- `supabase/migrations-gallery.sql` — 갤러리 작성자·조회수·전후 비교용 컬럼과 조회수 함수
- `supabase/migrations-gallery-community.sql` — 갤러리 댓글·실시간 대화·필터 위반 기록·차단
  (실시간 대화는 `gallery_chat_messages` 를 Realtime 발행 목록에 넣는다 — 파일 안에서 처리)
- `supabase/migrations-admin-cs.sql` — API 호출 기록·문의·정산/고객 집계 함수
  (`migrations-admin.sql`, `migrations-admin-usage.sql`, `migrations-billing.sql` 다음에)

> 이 마이그레이션 전에도 갤러리는 동작합니다(작성자·조회수·비교 슬라이더만 비어 보입니다).

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
| `PLAN_INGEST_URL` | 도면 파싱 서비스 주소 (아래 3-5). **없으면 도면 기능이 통째로 죽습니다** |
| `POLY_PIZZA_API_KEY` | (선택) 편집기의 무료 모델 검색 — poly.pizza/api 에서 무료 발급. 카탈로그(`models/polypizza.generated.ts`)는 이미 구워 커밋돼 있어 배포에는 없어도 된다 |
| `GEMINI_VISION_MODEL` | (선택) 공간 분석 모델 (기본 gemini-3.1-flash) |
| `NEXT_PUBLIC_SITE_URL` | `https://<railway-도메인>` |
| `NODE_ENV` | `production` |

선택: `GEMINI_IMAGE_MODEL`, `ANTHROPIC_API_KEY`(AI 명령 라우팅을 LLM으로 승격), `SUPABASE_SCENE_BUCKET`

> `NEXT_PUBLIC_*` 값은 **빌드 시점에 박히므로**, 도메인이 정해진 뒤 변수에 넣고 **재배포**해야 합니다.

### 3-4. 도메인
Settings → Networking → Generate Domain (또는 커스텀 도메인 연결) →
그 도메인을 `NEXT_PUBLIC_SITE_URL`과 Supabase Redirect URLs에 반영하고 재배포합니다.

### 3-5. 도면 파싱 서비스 (두 번째 서비스)

도면(DXF·DWG·스캔 이미지)을 읽는 일은 Python 마이크로서비스가 맡습니다 —
ezdxf·shapely·opencv 가 전부 Python 생태계라 Next.js 와 한 이미지에 합치지 않았습니다.

**이 서비스를 올리지 않으면 배포본에서 도면 기능이 통째로 죽습니다.** Next.js 는
`PLAN_INGEST_URL` 이 없으면 `127.0.0.1:8001` 로 붙으러 가는데, 컨테이너 안에는 아무것도
없어서 DXF 조차 읽히지 않습니다.

1. Railway → **New Service** → 같은 GitHub 저장소 선택
2. Settings
   - **Root Directory**: `services/plan-ingest`
   - **Builder**: Dockerfile / **Dockerfile Path**: `Dockerfile`
3. 이 서비스에는 환경변수를 넣지 않아도 됩니다 (외부 API 를 쓰지 않습니다).
4. Next.js 서비스의 변수에 이 서비스 주소를 넣습니다.
   같은 프로젝트 안이면 내부 주소를 씁니다 — 공개 도메인을 열 필요가 없습니다.

   ```
   PLAN_INGEST_URL=http://plan-ingest.railway.internal:8001
   ```

   (서비스 이름이 `plan-ingest` 가 아니면 그 이름으로 바꿉니다.)
5. 확인

   ```bash
   curl https://<도면서비스도메인>/health
   # {"ok":true,"raster":true,"rasterBackend":"opencv","rasterOcr":true,"dwgConverter":false}
   ```

   `raster: false` 면 이미지 도면이 501 로 떨어집니다. `dwgConverter: false` 는 DWG 만
   못 받는다는 뜻이고, DXF·이미지는 정상입니다 (아래 3-6).

### 3-6. DWG (선택)

ezdxf 는 DWG 를 못 읽습니다. 받으려면 [ODA File Converter](https://www.opendesign.com/guestfiles/oda_file_converter)(무료)를
이미지에 넣고 `ODA_FILE_CONVERTER` 에 실행 파일 경로를 지정해야 합니다. 없으면
`/parse/dwg` 가 501 과 함께 무엇이 없는지 알려 줍니다 — 사용자에게는 "DXF 로 내보내
올려 주세요" 로 안내됩니다.

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

---

## 부록 — Railway 빌드가 실패할 때

### 1) 로그부터 확인
Railway 배포 화면 → **View logs** → *Build* 탭. 아래는 자주 나오는 원인입니다.

| 로그에 보이는 문구 | 원인 | 조치 |
| --- | --- | --- |
| `Unsupported engine` / `node: not found` / nix 설치 실패 | 빌더가 요구한 Node 버전을 못 맞춤 | `.nvmrc`·`package.json engines`가 **22**인지 확인 |
| `npm ci` ... `EUSAGE` / lock file mismatch | 락파일과 package.json 불일치 | 로컬에서 `npm install` 후 `package-lock.json` 커밋 |
| `Cannot find module` | 빌드 캐시 꼬임 | Railway → Deployments → **Redeploy without cache** |
| `Killed` / exit 137 | 빌드 메모리 부족 | 서비스 플랜 상향 또는 Dockerfile 경로 사용 |

### 2) 그래도 안 되면 Dockerfile로 전환 (결정적 빌드)

레포에 `deploy/Dockerfile`이 들어 있습니다. Railway에서:

**Settings → Build**
- Builder: **Dockerfile**
- Dockerfile Path: `deploy/Dockerfile`

이 경로는 Node 22 이미지를 고정해서 쓰기 때문에 빌더 환경 차이를 없앱니다.

> `NEXT_PUBLIC_*` 값은 빌드 시점에 번들에 박힙니다. Dockerfile 빌드에서는 build arg로 전달되므로,
> Variables에 값이 **먼저** 들어 있어야 하고 값을 바꾸면 반드시 재배포해야 합니다.

### 3) 배포 후 클라이언트 확인
`/api/health`는 서버 환경변수만 봅니다. 브라우저 번들에 값이 들어갔는지는 **로그인 버튼**으로 확인하세요.
"Supabase 설정이 없어 로그인할 수 없습니다" 토스트가 뜨면 `NEXT_PUBLIC_*`이 빌드에 안 들어간 것입니다.
