export const ACCEPTED_MIME = ["image/jpeg", "image/png", "image/webp"] as const;
export const ACCEPTED_EXT_LABEL = "JPG · PNG · WEBP";
export const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10MB

export interface FileValidationResult {
  ok: boolean;
  message?: string;
}

export function validateImageFile(file: { type: string; size: number }): FileValidationResult {
  if (!ACCEPTED_MIME.includes(file.type as (typeof ACCEPTED_MIME)[number])) {
    return { ok: false, message: `${ACCEPTED_EXT_LABEL} 형식만 업로드할 수 있습니다.` };
  }
  if (file.size > MAX_FILE_BYTES) {
    return { ok: false, message: "이미지 용량은 10MB 이하여야 합니다." };
  }
  return { ok: true };
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}
