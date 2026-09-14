import { createHash } from 'node:crypto';
import { canonicalJson } from './canonical.js';

export const GENESIS_HASH = 'GENESIS';

/** BR-071: diff_hash = sha256(prev_hash + canonical(before) + canonical(after)) */
export function computeDiffHash(prevHash: string, before: unknown, after: unknown): string {
  return createHash('sha256')
    .update(prevHash)
    .update(before == null ? 'null' : canonicalJson(before))
    .update(after == null ? 'null' : canonicalJson(after))
    .digest('hex');
}
