import { promises as fs } from "node:fs";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminSupabase } from "@/lib/supabase/server";

/**
 * Storage 추상화.
 * 개발 환경은 로컬 파일시스템(.data/files), 운영은 S3 호환 스토리지를 쓴다.
 * Scene에는 항상 공개 URL만 저장하므로 provider를 바꿔도 데이터는 그대로 유효하다.
 */
export interface StorageProvider {
  readonly name: string;
  upload(key: string, data: Buffer | Uint8Array | string, contentType: string): Promise<string>;
  download(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
  getPublicUrl(key: string): string;
}

const DATA_ROOT = path.join(process.cwd(), ".data", "files");

export class LocalStorageProvider implements StorageProvider {
  readonly name = "local";

  private resolve(key: string): string {
    const safe = key.replace(/\.\./g, "").replace(/^\/+/, "");
    return path.join(DATA_ROOT, safe);
  }

  async upload(key: string, data: Buffer | Uint8Array | string, _contentType: string) {
    const filePath = this.resolve(key);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const buffer = typeof data === "string" ? Buffer.from(data, "utf8") : Buffer.from(data);
    await fs.writeFile(filePath, buffer);
    return this.getPublicUrl(key);
  }

  async download(key: string): Promise<Buffer> {
    return fs.readFile(this.resolve(key));
  }

  async delete(key: string): Promise<void> {
    await fs.rm(this.resolve(key), { force: true });
  }

  getPublicUrl(key: string): string {
    return `/api/files/${key.replace(/^\/+/, "")}`;
  }
}

/**
 * Supabase Storage 기반 저장소 (Railway 등 파일시스템이 휘발되는 환경의 기본값).
 *
 * 버킷은 비공개로 두고, 열람은 앱의 /api/files/* 라우트가 서비스 롤로 중계한다.
 * 사용자가 올린 방 사진이 URL만으로 외부에 공개되지 않도록 하기 위한 선택이다.
 */
export class SupabaseStorageProvider implements StorageProvider {
  readonly name = "supabase";

  constructor(
    private client: SupabaseClient,
    private bucket: string
  ) {}

  async upload(key: string, data: Buffer | Uint8Array | string, contentType: string) {
    const body = typeof data === "string" ? Buffer.from(data, "utf8") : Buffer.from(data);

    const { error } = await this.client.storage
      .from(this.bucket)
      .upload(key, body, { contentType, upsert: true });

    if (error) throw new Error(`스토리지 업로드 실패: ${error.message}`);
    return this.getPublicUrl(key);
  }

  async download(key: string): Promise<Buffer> {
    const { data, error } = await this.client.storage.from(this.bucket).download(key);
    if (error || !data) throw new Error(`스토리지 다운로드 실패: ${error?.message ?? key}`);
    return Buffer.from(await data.arrayBuffer());
  }

  async delete(key: string): Promise<void> {
    await this.client.storage.from(this.bucket).remove([key]);
  }

  getPublicUrl(key: string): string {
    // 비공개 버킷이므로 앱 라우트를 통해 서빙한다.
    return `/api/files/${key.replace(/^\/+/, "")}`;
  }
}

/**
 * S3 호환 스토리지.
 * TODO: 실제 배포 시 @aws-sdk/client-s3로 교체한다. 자격증명이 없으면 팩토리가 local로 폴백한다.
 */
export class S3StorageProvider implements StorageProvider {
  readonly name = "s3";

  constructor(
    private config: { endpoint: string; bucket: string; accessKey: string; secretKey: string }
  ) {}

  async upload(): Promise<string> {
    throw new Error("S3StorageProvider가 아직 연결되지 않았습니다. S3 자격증명을 확인하세요.");
  }

  async download(): Promise<Buffer> {
    throw new Error("S3StorageProvider가 아직 연결되지 않았습니다.");
  }

  async delete(): Promise<void> {
    throw new Error("S3StorageProvider가 아직 연결되지 않았습니다.");
  }

  getPublicUrl(key: string): string {
    return `${this.config.endpoint.replace(/\/+$/, "")}/${this.config.bucket}/${key}`;
  }
}

/** Scene 파일(원본·생성물·마스크·렌더)이 들어가는 Supabase 버킷 */
export const SCENE_BUCKET = process.env.SUPABASE_SCENE_BUCKET || "scene-files";

let cached: StorageProvider | null = null;

/**
 * 저장소 선택 우선순위
 *  1. STORAGE_PROVIDER 로 명시한 값
 *  2. Supabase 서비스 롤 키가 있으면 Supabase Storage (Railway 배포 기본값)
 *  3. S3 자격증명이 있으면 S3
 *  4. 로컬 파일시스템 (개발/데모)
 */
export function getStorage(): StorageProvider {
  if (cached) return cached;

  const provider = (process.env.STORAGE_PROVIDER ?? "").toLowerCase();
  const hasS3 = Boolean(
    process.env.S3_ENDPOINT &&
      process.env.S3_BUCKET &&
      process.env.S3_ACCESS_KEY &&
      process.env.S3_SECRET_KEY
  );

  const admin = provider === "local" ? null : createAdminSupabase();

  if (provider === "s3" && hasS3) {
    cached = new S3StorageProvider({
      endpoint: process.env.S3_ENDPOINT!,
      bucket: process.env.S3_BUCKET!,
      accessKey: process.env.S3_ACCESS_KEY!,
      secretKey: process.env.S3_SECRET_KEY!,
    });
  } else if (admin && provider !== "local") {
    cached = new SupabaseStorageProvider(admin, SCENE_BUCKET);
  } else if (hasS3) {
    cached = new S3StorageProvider({
      endpoint: process.env.S3_ENDPOINT!,
      bucket: process.env.S3_BUCKET!,
      accessKey: process.env.S3_ACCESS_KEY!,
      secretKey: process.env.S3_SECRET_KEY!,
    });
  } else {
    cached = new LocalStorageProvider();
  }

  return cached;
}
