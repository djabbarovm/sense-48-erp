export * from './types.js';
export * from './s3.js';
export * from './localFs.js';

import { S3Storage } from './s3.js';
import { LocalFsStorage } from './localFs.js';
import type { StorageAdapter } from './types.js';

/** Фабрика по env: S3/MinIO если сконфигурирован, иначе локальный каталог (dev). */
export function createStorageFromEnv(env: Record<string, string | undefined> = process.env): StorageAdapter {
  if (env.S3_ENDPOINT && env.S3_ACCESS_KEY && env.S3_SECRET_KEY && env.S3_BUCKET) {
    return new S3Storage({
      endpoint: env.S3_ENDPOINT,
      accessKey: env.S3_ACCESS_KEY,
      secretKey: env.S3_SECRET_KEY,
      bucket: env.S3_BUCKET,
    });
  }
  return new LocalFsStorage(env.LOCAL_STORAGE_DIR ?? '/var/lib/finance-os-files');
}
