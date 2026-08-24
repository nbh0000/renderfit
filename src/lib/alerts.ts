/**
 * 사고가 났을 때 사람에게 알린다.
 *
 * 보내는 곳은 환경변수로 고른다. 여러 개를 동시에 켤 수 있고, 하나도 안 켜져 있으면
 * 로그만 남긴다 — 알림 설정이 없다고 서비스가 멈추면 안 된다.
 *
 * 알림 자체가 실패해도 부르는 쪽을 막지 않는다. 사고를 알리려다 또 사고가 나면
 * 곤란하다.
 */

export type AlertLevel = "info" | "warn" | "error";

export interface Alert {
  level: AlertLevel;
  title: string;
  body: string;
  /** 눌러서 바로 볼 수 있는 주소 (관리자 화면 등) */
  url?: string;
}

const MARK: Record<AlertLevel, string> = {
  info: "ℹ️",
  warn: "⚠️",
  error: "🚨",
};

/** 어디로 보낼지 정해져 있는가 */
export function alertsConfigured(): boolean {
  return Boolean(
    process.env.ALERT_WEBHOOK_URL || process.env.KAKAO_ACCESS_TOKEN || process.env.TELEGRAM_BOT_TOKEN
  );
}

/** 사람이 읽을 한 덩어리로 만든다 */
export function formatAlert(alert: Alert): string {
  const lines = [`${MARK[alert.level]} [렌더핏] ${alert.title}`, alert.body];
  if (alert.url) lines.push(alert.url);
  return lines.join("\n");
}

/**
 * 디스코드·슬랙 웹훅.
 *
 * 가장 손이 안 가는 방법이다. 주소 하나만 넣으면 되고 만료되지 않는다.
 * 슬랙과 디스코드 모두 { text } 또는 { content } 를 받으므로 둘 다 넣어 보낸다.
 */
async function sendWebhook(text: string): Promise<boolean> {
  const url = process.env.ALERT_WEBHOOK_URL;
  if (!url) return false;

  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text, content: text }),
  });

  return response.ok;
}

/**
 * 텔레그램 봇.
 *
 * 봇을 하나 만들고(@BotFather) 자기 채팅 id만 알면 된다. 토큰이 만료되지 않아
 * 카카오보다 손이 덜 간다.
 */
async function sendTelegram(text: string): Promise<boolean> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return false;

  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
  });

  return response.ok;
}

/**
 * 카카오톡 "나에게 보내기".
 *
 * 카카오 개발자 앱을 만들고 talk_message 권한으로 받은 토큰을 넣으면 자기 카톡으로
 * 온다. 고객에게 보내는 알림톡과 달리 사업자등록이나 템플릿 심사가 필요 없다.
 *
 * ★ 다만 access token 이 6시간, refresh token 이 2개월이면 만료된다. 갱신을 잊으면
 *   알림이 조용히 죽는데, 알림이 죽은 줄 모르는 것이 알림이 없는 것보다 위험하다.
 *   그래서 refresh token 이 있으면 만료 시 스스로 한 번 갱신해 보고, 그래도 실패하면
 *   다른 경로로 보낸 뒤 로그에 크게 남긴다.
 */
async function sendKakao(text: string, url?: string): Promise<boolean> {
  const token = await kakaoAccessToken();
  if (!token) return false;

  const template = {
    object_type: "text",
    text: text.slice(0, 200),
    link: { web_url: url ?? "", mobile_web_url: url ?? "" },
  };

  const response = await fetch("https://kapi.kakao.com/v2/api/talk/memo/default/send", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ template_object: JSON.stringify(template) }),
  });

  if (response.ok) return true;

  console.error("[alert] 카카오 전송 실패 — 토큰이 만료됐을 수 있습니다:", response.status);
  return false;
}

/** 메모리에 들고 있는 카카오 토큰 (만료되면 refresh 로 다시 받는다) */
let kakaoToken: { value: string; until: number } | null = null;

async function kakaoAccessToken(): Promise<string | null> {
  const fixed = process.env.KAKAO_ACCESS_TOKEN;
  const refresh = process.env.KAKAO_REFRESH_TOKEN;
  const key = process.env.KAKAO_REST_API_KEY;

  if (kakaoToken && kakaoToken.until > Date.now()) return kakaoToken.value;
  if (!refresh || !key) return fixed ?? null;

  try {
    const response = await fetch("https://kauth.kakao.com/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        client_id: key,
        refresh_token: refresh,
      }),
    });

    const data = (await response.json()) as { access_token?: string; expires_in?: number };
    if (!response.ok || !data.access_token) return fixed ?? null;

    // 만료 5분 전에 다시 받도록 여유를 둔다
    kakaoToken = {
      value: data.access_token,
      until: Date.now() + Math.max(60, (data.expires_in ?? 21600) - 300) * 1000,
    };
    return kakaoToken.value;
  } catch {
    return fixed ?? null;
  }
}

/**
 * 알린다.
 *
 * 켜진 경로 전부로 보낸다. 하나가 죽어도 나머지로는 간다 — 알림은 이중으로 걸어 두는
 * 편이 낫다.
 */
export async function notify(alert: Alert): Promise<void> {
  const text = formatAlert(alert);

  // 어디로 보내든 로그에는 항상 남긴다
  const log = alert.level === "error" ? console.error : console.warn;
  log(`[alert] ${text.replace(/\n/g, " | ")}`);

  if (!alertsConfigured()) return;

  const results = await Promise.allSettled([
    sendWebhook(text),
    sendTelegram(text),
    sendKakao(text, alert.url),
  ]);

  const sent = results.some((result) => result.status === "fulfilled" && result.value);
  if (!sent) console.error("[alert] 어느 경로로도 보내지 못했습니다.");
}
