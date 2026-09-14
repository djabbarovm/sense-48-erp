import { GENESIS_HASH, computeDiffHash } from './hash.js';
import type { AuditChainRecord } from './types.js';

export interface ChainVerdict {
  valid: boolean;
  brokenAtIndex?: number;
  reason?: string;
}

/**
 * BR-071: проверка hash chain. records — записи одного tenant в порядке seq.
 * Первая запись ссылается на GENESIS.
 */
export function verifyChain(records: readonly AuditChainRecord[]): ChainVerdict {
  let prev = GENESIS_HASH;
  for (let i = 0; i < records.length; i++) {
    const r = records[i]!;
    if (r.prevHash !== prev) {
      return { valid: false, brokenAtIndex: i, reason: `prev_hash mismatch at ${i}` };
    }
    const expected = computeDiffHash(r.prevHash, r.before, r.after);
    if (r.diffHash !== expected) {
      return { valid: false, brokenAtIndex: i, reason: `diff_hash mismatch at ${i}` };
    }
    prev = r.diffHash;
  }
  return { valid: true };
}
