/**
 * 관리자 판별.
 *
 * DB에 권한 컬럼을 두지 않고 환경변수 목록으로 정한다. 관리자 화면은 매출과 사고
 * 기록을 보여 주므로, 권한이 DB 안에 있으면 DB를 건드릴 수 있는 경로가 하나 늘어난다.
 * 배포 환경변수를 바꿀 수 있는 사람만 관리자가 되는 편이 좁고 분명하다.
 *
 * ADMIN_EMAILS=a@example.com,b@example.com
 */

/** 관리자로 등록된 이메일 목록 */
export function adminEmails(): string[] {
  return (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

/** 관리자 기능을 쓸 수 있는 사람이 한 명이라도 정해져 있는가 */
export function hasAdmins(): boolean {
  return adminEmails().length > 0;
}

/**
 * 이 이메일이 관리자인가.
 *
 * 목록이 비어 있으면 아무도 관리자가 아니다 — 설정을 잊었을 때 모두에게 열리는 것이
 * 아무도 못 들어가는 것보다 훨씬 위험하다.
 */
export function isAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return adminEmails().includes(email.trim().toLowerCase());
}
