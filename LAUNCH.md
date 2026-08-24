# 유료 출시 체크리스트

코드 쪽은 준비돼 있다. 아래는 **사람이 해야 하는 일**이고, 다 하기 전에는 결제 경로가
스스로 막혀 있다(`config/business.ts`가 비어 있으면 `canSell()`이 false를 돌려준다).

---

## 1. 사업자 정보 — 가장 먼저

`config/business.ts`의 빈 칸을 채운다. 채우기 전에는 푸터에 "사업자 정보 준비 중"이
뜨고 결제 버튼이 동작하지 않는다.

| 항목 | 어디서 받나 |
| --- | --- |
| 상호·대표자·사업자등록번호 | 홈택스 사업자등록 |
| 통신판매업 신고번호 | 정부24 → 통신판매업 신고 (관할 구청) |
| 주소·전화·이메일 | 사업장 정보 |
| 개인정보 보호책임자 | 보통 대표자 본인 |

> 통신판매업 신고는 **구매안전서비스 이용확인증**을 요구한다. 결제대행사(토스페이먼츠)
> 계약이 끝나야 발급되므로, 2번을 먼저 시작해 두고 병행하는 편이 빠르다.

법적 문서 세 개는 이미 만들어져 있다 — `/legal/terms`, `/legal/privacy`, `/legal/refund`.
사업자 정보를 채우면 그 값이 문서와 푸터에 자동으로 들어간다. 내용은 이 서비스에 맞춰
써 두었으니, 실제 운영 방식과 다른 부분(환불 기간, 문의 처리 기한)만 확인해 고친다.

## 2. 토스페이먼츠 연동

1. [tosspayments.com](https://www.tosspayments.com) 가입 → 심사 (사업자등록증 필요)
2. 심사 통과 후 **정기결제(빌링)** 사용 신청 — 일반 결제와 별도 승인이 필요하다
3. 개발자센터에서 키 두 개를 받아 환경변수에 넣는다

   ```
   NEXT_PUBLIC_TOSS_CLIENT_KEY=   # 클라이언트 키 (브라우저에 노출돼도 되는 값)
   TOSS_SECRET_KEY=               # 시크릿 키 (절대 클라이언트에 넣지 말 것)
   ```

4. 상점 설정에서 리다이렉트 주소를 등록한다
   - 성공: `https://<도메인>/api/payments/confirm`
   - 실패: `https://<도메인>/pricing?payment=failed`

테스트 키로 먼저 결제 흐름을 끝까지 확인한 뒤 라이브 키로 바꾼다.

## 3. DB 마이그레이션

Supabase SQL Editor에서 `supabase/migrations-billing.sql`을 실행한다.
`subscriptions`·`payments` 테이블과 `apply_paid_plan`·`expire_plan` 함수가 생긴다.

## 4. 아직 만들지 않은 것 — 매월 자동결제

첫 결제는 `/api/payments/confirm`이 처리하지만, **둘째 달부터의 자동결제는 아직 없다.**
`subscriptions.period_end`가 지난 구독을 찾아 빌링키로 다시 승인하는 스케줄러가 필요하다.

선택지:
- Supabase `pg_cron` + Edge Function
- Railway cron + 내부 API 라우트 (`x-cron-secret` 헤더로 보호)

월 구독을 열기 전에 반드시 붙여야 한다. 붙이기 전이라면 **한 달치 단건 결제**로
운영하는 편이 안전하다.

## 5. 출시 전 마지막 확인

- [ ] `config/business.ts` 다 채웠다
- [ ] `/legal/terms`·`/legal/privacy`·`/legal/refund` 내용이 실제 운영과 맞다
- [ ] 토스 테스트 키로 결제 → 요금제 상승 → 크레딧 지급까지 확인했다
- [ ] 결제 실패·취소했을 때 크레딧이 안 나가는지 확인했다
- [ ] `supabase/migrations-billing.sql` 실행했다
- [ ] 자동결제 스케줄러를 붙였다 (또는 단건 결제로 운영하기로 정했다)
- [ ] Supabase Auth의 Site URL·Redirect URL이 실제 도메인으로 돼 있다

---

## 크레딧이 나가는 곳

편집기의 AI 기능은 이제 전부 크레딧을 쓴다 (`src/lib/credits.ts`).
실패하면 자동으로 돌려준다.

| 작업 | 크레딧 |
| --- | --- |
| 사진·도면 분석 | 1 |
| 미리보기 렌더 | 1 |
| 최종 실사 렌더 | 2 |
| 설명으로 가구 만들기 | 1 |
| AI 명령 | 1 |

값을 바꾸려면 `EDITOR_COST`만 고치면 된다. Supabase가 없는 로컬·데모 모드에서는
걷지 않는다 — 그때는 Mock provider라 비용도 들지 않는다.

---

## 자동결제 스케줄러 (붙였음)

`POST /api/cron/renew` 를 하루 한 번 부르면 된다. `x-cron-secret` 헤더로 보호한다.

```bash
# 환경변수
CRON_SECRET=<아무 긴 임의 문자열>

# 부르는 법
curl -X POST https://<도메인>/api/cron/renew -H "x-cron-secret: $CRON_SECRET"
```

### 거는 방법 두 가지

**Railway cron** — 프로젝트에 cron 서비스를 하나 더 만들고 위 curl을 매일 돌린다.
가장 간단하다.

**Supabase pg_cron** — DB에서 직접 부른다. 서버가 자다 깨는 일이 없다.

```sql
select cron.schedule(
  'renderfit-renew', '0 3 * * *',
  $$ select net.http_post(
       url := 'https://<도메인>/api/cron/renew',
       headers := '{"x-cron-secret": "<CRON_SECRET>"}'::jsonb
     ) $$
);
```

### 규칙

| 상황 | 어떻게 |
| --- | --- |
| 주기가 남음 | 건드리지 않는다 |
| 주기 끝 · 정상 | 빌링키로 청구 → 크레딧 채우고 주기 한 달 연장 |
| 주기 끝 · 해지 예약 | 청구하지 않고 무료로 되돌린다 |
| 청구 실패 | 1일 → 3일 → 5일 뒤 재시도, 3회 실패하면 구독 종료 |

같은 달을 두 번 걷지 않도록 주문번호를 `구독id + 주기끝` 으로 정해 두었고
`payments.order_id` 에 유니크 제약이 걸려 있다. 스케줄러가 겹쳐 돌아도 두 번째는
DB가 막는다.

규칙은 `src/lib/payments/renewal.ts` 에 결제대행사 호출과 떼어 두었고
`tests/renewal.test.ts` 16개로 검증한다 — 토스 키 없이도 확인된다.
