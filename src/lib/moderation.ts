/**
 * 갤러리 대화·댓글 필터.
 *
 * 전부 순수 함수다 — 서버 라우트는 결과만 받아 저장할지 말지를 정한다.
 * 목록은 "이건 확실히 안 된다"는 것만 담는다. 애매한 말을 막기 시작하면
 * 인테리어 얘기("변기 교체", "죽은 공간")까지 걸려서 대화가 끊긴다.
 */

export type ViolationKind = "ad" | "profanity" | "sexual" | "abuse";

export type Verdict = { ok: true } | { ok: false; kind: ViolationKind; label: string };

export const VIOLATION_LABEL: Record<ViolationKind, string> = {
  ad: "광고·홍보",
  profanity: "욕설·비속어",
  sexual: "음란한 표현",
  abuse: "비방·모욕",
};

/* ───────────────────────────── 차단 규칙 ───────────────────────────── */

/** 이 시간 안에 */
export const STRIKE_WINDOW_HOURS = 24;
/** 이만큼 걸리면 */
export const STRIKE_LIMIT = 3;
/** 이 기간 동안 계정과 IP 를 막는다 */
export const AUTO_BAN_DAYS = 7;

/**
 * 위반이 쌓였을 때 자동 차단할지.
 * 광고는 한 번 걸려도 세 번으로 친다 — 봇이 첫 글부터 링크를 뿌리는데
 * 두 번 더 봐줄 이유가 없다.
 */
export function strikeWeight(kind: ViolationKind): number {
  return kind === "ad" ? STRIKE_LIMIT : 1;
}

export function shouldAutoBan(strikes: number): boolean {
  return strikes >= STRIKE_LIMIT;
}

/* ───────────────────────────── 정규화 ───────────────────────────── */

/**
 * 글자 사이에 끼운 것을 걷어 낸다.
 *
 * "시 발", "시1발", "씨.발" 처럼 사이에 공백·숫자·기호를 넣어 피해 가는 것이
 * 가장 흔하다. 한글·영문만 남겨 붙이면 그 변형이 전부 같은 문자열이 된다.
 * 링크·전화번호는 원문에서 따로 본다 (숫자와 점이 곧 단서라 지우면 안 된다).
 */
export function collapse(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{Script=Hangul}\p{Script=Latin}]/gu, "");
}

/* ───────────────────────────── 목록 ───────────────────────────── */

/*
 * 아래 단어는 붙여 쓴 형태(collapse 결과)와 비교한다.
 * 짧은 자모("ㅅㅂ")는 다른 말의 일부가 되기 어려워 그대로 두고,
 * 한 글자짜리("씹")나 지명·물건과 겹치는 말("한남", "고추", "텔레", "대출")은
 * 오탐이 커서 뺐다. 인테리어 얘기에서 나올 법한 말은 막지 않는다.
 */

const PROFANITY = [
  "시발",
  "씨발",
  "씨발",
  "씨빨",
  "시빨",
  "쉬발",
  "쓰발",
  "ㅅㅂ",
  "ㅆㅂ",
  "시벌",
  "씨벌",
  "병신",
  "븅신",
  "빙신",
  "ㅂㅅ",
  "지랄",
  "ㅈㄹ",
  "존나",
  "졸라",
  "ㅈㄴ",
  "좆",
  "좃",
  "씹새",
  "씹할",
  "씹년",
  "씹놈",
  "개새끼",
  "개세끼",
  "개색",
  "새끼",
  "새키",
  "쌔끼",
  "미친놈",
  "미친년",
  "미친새",
  "개년",
  "썅",
  "쌍놈",
  "쌍년",
  "느금마",
  "느검",
  "니미",
  "니애미",
  "니애비",
  "엠창",
  "앰창",
  "애미",
  "애비",
  "꺼져",
  "닥쳐",
  "엿먹",
  "뒤져",
  "뒈져",
  "fuck",
  "shit",
  "bitch",
  "asshole",
];

const SEXUAL = [
  "섹스",
  "쎅스",
  "sex",
  "성교",
  "자위",
  "딸딸이",
  "보지",
  "자지",
  "잦이",
  "야동",
  "야사",
  "포르노",
  "porn",
  "조건만남",
  "원나잇",
  "애널",
  "정액",
  "사까시",
  "강간",
  "성기",
  "음부",
  "유두",
  "떡치",
  "쌕쓰",
  "야한사진",
  "몸캠",
  "출장안마",
];

const ABUSE = [
  "사기꾼",
  "사기업체",
  "사기치",
  "먹튀",
  "쓰레기업체",
  "쓰레기같",
  "죽어라",
  "죽어버려",
  "꺼지라",
  "돌았냐",
  "돌았나",
  "정신병",
  "장애냐",
  "장애인이냐",
  "찐따",
  "김치녀",
  "틀딱",
  "급식충",
  "맘충",
  "일베충",
  "벌레같",
];

/* 광고는 붙여 쓴 단어와 원문 패턴을 함께 본다 */
const AD_WORDS = [
  "대출상담",
  "대출문의",
  "당일대출",
  "무이자대출",
  "카지노",
  "토토",
  "바카라",
  "슬롯머신",
  "먹튀검증",
  "수익보장",
  "리딩방",
  "재택알바",
  "고수익",
  "성인용품",
  "텔레그램",
  "오픈채팅",
  "오픈챗",
  "카톡아이디",
  "카톡id",
  "라인아이디",
  "홍보문의",
  "광고문의",
  "무료상담",
  "상담문의",
  "지금바로연락",
  "비트코인리딩",
  "코인리딩",
  "선물투자",
  "주식리딩",
];

/* 링크·전화번호·아이디 — 원문에서 본다 */
const AD_PATTERNS: RegExp[] = [
  /https?:\/\//i,
  /www\./i,
  /[a-z0-9-]+\.(com|net|kr|co|io|me|xyz|shop|site|link|top|vip|club|biz|info)\b/i,
  /(?:^|\D)0\d{1,2}[-.\s]?\d{3,4}[-.\s]?\d{4}(?:\D|$)/,
  /(?:^|\D)1[5-9]\d{2}[-.\s]?\d{4}(?:\D|$)/,
  /(카톡|카카오톡|kakao|라인|line|텔레그램|telegram)\s*(아이디|id|:|→|->)/i,
  /@[a-z0-9_]{4,}/i,
];

/* ───────────────────────────── 판정 ───────────────────────────── */

function hit(collapsed: string, words: string[]): boolean {
  return words.some((word) => collapsed.includes(collapse(word)));
}

/**
 * 글을 보낼 수 있는지 판정한다.
 * 광고를 먼저 본다 — 광고 봇이 욕까지 섞어 오는 일은 드물고,
 * 광고는 가중치가 커서 먼저 잡아야 자동 차단이 맞게 돈다.
 */
export function screenMessage(text: string): Verdict {
  const collapsed = collapse(text);

  if (AD_PATTERNS.some((pattern) => pattern.test(text)) || hit(collapsed, AD_WORDS)) {
    return { ok: false, kind: "ad", label: VIOLATION_LABEL.ad };
  }
  if (hit(collapsed, SEXUAL)) return { ok: false, kind: "sexual", label: VIOLATION_LABEL.sexual };
  if (hit(collapsed, PROFANITY)) {
    return { ok: false, kind: "profanity", label: VIOLATION_LABEL.profanity };
  }
  if (hit(collapsed, ABUSE)) return { ok: false, kind: "abuse", label: VIOLATION_LABEL.abuse };

  return { ok: true };
}

/**
 * 프록시 뒤에서 실제 접속 IP 를 읽는다.
 * Railway 는 x-forwarded-for 첫 항목에 원래 주소를 싣는다. 없으면 null — 그때는
 * 계정으로만 막는다.
 */
export function clientIp(headers: Headers): string | null {
  const forwarded = headers.get("x-forwarded-for");
  const first = forwarded?.split(",")[0]?.trim();
  if (first) return first;
  const real = headers.get("x-real-ip")?.trim();
  return real || null;
}
