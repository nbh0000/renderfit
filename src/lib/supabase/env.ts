/**
 * Supabase 환경변수 상태.
 * 값이 없으면 앱은 Phase 1의 로컬 mock 모드(인메모리 job + localStorage 계정)로 동작한다.
 */
export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
export const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

export function isSupabaseConfigured(): boolean {
  return Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
}

/** 서버 전용 (서비스 롤). 결과 이미지 업로드처럼 RLS를 우회해야 하는 작업에만 쓴다. */
export function serviceRoleKey(): string {
  return process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
}

export const SOURCES_BUCKET = "sources";
export const RESULTS_BUCKET = "results";
