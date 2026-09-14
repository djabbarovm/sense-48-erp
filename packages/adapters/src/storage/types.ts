/** Файловое хранилище (D-04): S3-compatible, signed URLs 15 мин, sha256 в Document. */

export interface StorageAdapter {
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  /** Signed URL на скачивание, TTL 15 минут (docs/11). */
  getSignedUrl(key: string): Promise<string>;
  exists(key: string): Promise<boolean>;
}
