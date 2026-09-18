import type { Prisma } from '@prisma/client';

/**
 * D-24: человекочитаемые номера per tenant без пропусков.
 * Выделение номера происходит в ТОЙ ЖЕ транзакции, что и создание объекта:
 * rollback отменяет и инкремент — поэтому последовательность без gaps.
 * Конкурентные транзакции сериализуются блокировкой строки sequence
 * (INSERT .. ON CONFLICT DO UPDATE берёт row lock).
 */

export type SequenceKey = 'PR' | 'PAY' | 'INV' | 'EVT' | 'PO' | 'CINV' | 'DEAL';

const PAD: Record<SequenceKey, number> = {
  PR: 6, // PR-2026-000123
  PAY: 6, // PAY-2026-000045
  INV: 6,
  PO: 6,
  CINV: 6,
  EVT: 4, // EVT-2026-0012
  DEAL: 6, // DEAL-2026-000001 (MDS Property)
};

export async function nextSequenceValue(
  tx: Prisma.TransactionClient,
  tenantId: string,
  key: SequenceKey,
  year: number,
): Promise<number> {
  const rows = await tx.$queryRaw<{ value: bigint | number }[]>`
    INSERT INTO "sequence" (id, tenant_id, key, year, next_value)
    VALUES (gen_random_uuid(), ${tenantId}::uuid, ${key}, ${year}, 2)
    ON CONFLICT (tenant_id, key, year)
    DO UPDATE SET next_value = "sequence".next_value + 1
    RETURNING next_value - 1 AS value
  `;
  return Number(rows[0]!.value);
}

/** `PR-2026-000123` и т.п. Дата определяет год серии (Asia/Tashkent — год из календарной даты). */
export async function nextNumber(
  tx: Prisma.TransactionClient,
  tenantId: string,
  key: SequenceKey,
  date: Date = new Date(),
): Promise<string> {
  const year = date.getFullYear();
  const value = await nextSequenceValue(tx, tenantId, key, year);
  return `${key}-${year}-${String(value).padStart(PAD[key], '0')}`;
}

/** D-24/D-13: batch-номер детерминирован по дате: BATCH-2026-09-14 (+ суффикс для URGENT). */
export function batchNumber(batchDate: Date, urgentSeq?: number): string {
  const iso = batchDate.toISOString().slice(0, 10);
  return urgentSeq ? `BATCH-${iso}-U${urgentSeq}` : `BATCH-${iso}`;
}
