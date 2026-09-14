/**
 * ADR-005: локальное файловое хранилище для dev/CI-песочниц без MinIO.
 * Интерфейс идентичен S3Storage; в prod не используется.
 */
import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { dirname, join, normalize } from 'node:path';
import type { StorageAdapter } from './types.js';

export class LocalFsStorage implements StorageAdapter {
  constructor(private baseDir: string) {}

  private resolve(key: string): string {
    const path = normalize(join(this.baseDir, key));
    if (!path.startsWith(normalize(this.baseDir))) throw new Error('Invalid storage key');
    return path;
  }

  async put(key: string, body: Buffer): Promise<void> {
    const path = this.resolve(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, body);
  }

  async getSignedUrl(key: string): Promise<string> {
    // dev: отдаём file://-ссылку; web-слой проксирует через route handler
    return `file://${this.resolve(key)}`;
  }

  async exists(key: string): Promise<boolean> {
    try {
      await access(this.resolve(key));
      return true;
    } catch {
      return false;
    }
  }

  async read(key: string): Promise<Buffer> {
    return readFile(this.resolve(key));
  }
}
