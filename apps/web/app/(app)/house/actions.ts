'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { NotFoundError, PermissionDeniedError, ValidationError, type HouseBudgetCategory, type HouseFundKind, type ManagementContractStatus } from '@finance-os/core';
import { addHouseExpense, createHouseFund, matchHouseReceipt, setManagementContractStatus, setUnitCadastre, updateHouseFund, upsertHouseBudgetLine } from '@finance-os/db';
import { requireTenantContext } from '@/lib/session';

const str = (fd: FormData, k: string): string | undefined => { const v = fd.get(k); return typeof v === 'string' && v.trim() ? v.trim() : undefined; };
/** Суммы в UZS вводятся в сумах (целые) → тийины. */
const uzsMinor = (v: string | undefined): bigint | null => {
  if (v === undefined) return null;
  if (!/^\d+(\.\d{1,2})?$/.test(v)) throw new ValidationError('AMOUNT_INVALID');
  const [whole, frac = ''] = v.split('.');
  return BigInt(whole!) * 100n + BigInt(frac.padEnd(2, '0'));
};
const pctBp = (v: string | undefined): number | null => (v === undefined ? null : Math.round(Number(v) * 100));
const date = (v: string | undefined): Date | null => (v ? new Date(`${v}T00:00:00Z`) : null);

async function run(back: string, fn: () => Promise<unknown>): Promise<never> {
  let error: string | null = null;
  try { await fn(); } catch (e) {
    if (e instanceof ValidationError || e instanceof PermissionDeniedError) error = e.code;
    else if (e instanceof NotFoundError) error = 'NOT_FOUND';
    else throw e;
  }
  revalidatePath('/house'); revalidatePath('/owner'); revalidatePath('/property'); revalidatePath('/property/owners'); revalidatePath(back);
  redirect(`${back}${error ? `${back.includes('?') ? '&' : '?'}error=${encodeURIComponent(error)}` : ''}`);
}

export async function createHouseFundAction(formData: FormData): Promise<void> {
  const ctx = await requireTenantContext();
  await run(str(formData, 'back') ?? '/house', () => createHouseFund(ctx, { name: str(formData, 'name') ?? '', kind: (str(formData, 'kind') ?? 'OPERATIONS') as HouseFundKind, buildingId: str(formData, 'buildingId') ?? null, bankAccountId: str(formData, 'bankAccountId') ?? null, tariffPerM2Minor: uzsMinor(str(formData, 'tariff')) ?? 0n, dueDay: str(formData, 'dueDay') ? Number(str(formData, 'dueDay')) : 15, managementFeeBp: pctBp(str(formData, 'feePct')), tariffApprovedAt: date(str(formData, 'tariffApprovedAt')) }));
}

export async function updateHouseFundAction(formData: FormData): Promise<void> {
  const ctx = await requireTenantContext();
  const id = str(formData, 'fundId') ?? '';
  const back = str(formData, 'back') ?? `/house?fund=${id}`;
  const tariff = str(formData, 'tariff'); const fee = str(formData, 'feePct'); const dueDay = str(formData, 'dueDay'); const approved = str(formData, 'tariffApprovedAt');
  await run(back, () => updateHouseFund(ctx, id, { ...(tariff ? { tariffPerM2Minor: uzsMinor(tariff)! } : {}), ...(fee !== undefined ? { managementFeeBp: pctBp(fee) } : formData.get('feeOpen') === '1' ? { managementFeeBp: null } : {}), ...(dueDay ? { dueDay: Number(dueDay) } : {}), ...(approved ? { tariffApprovedAt: date(approved) } : {}), ...(str(formData, 'bankAccountId') ? { bankAccountId: str(formData, 'bankAccountId')! } : {}) }));
}

export async function upsertHouseBudgetLineAction(formData: FormData): Promise<void> {
  const ctx = await requireTenantContext();
  const fundId = str(formData, 'fundId') ?? '';
  await run(str(formData, 'back') ?? `/house?view=budget&fund=${fundId}`, () => upsertHouseBudgetLine(ctx, { fundId, year: Number(str(formData, 'year')), category: (str(formData, 'category') ?? 'OTHER') as HouseBudgetCategory, plannedMinor: uzsMinor(str(formData, 'planned')) ?? 0n, note: str(formData, 'note') ?? null }));
}

export async function addHouseExpenseAction(formData: FormData): Promise<void> {
  const ctx = await requireTenantContext();
  const fundId = str(formData, 'fundId') ?? '';
  await run(str(formData, 'back') ?? `/house?view=budget&fund=${fundId}`, () => addHouseExpense(ctx, { fundId, date: date(str(formData, 'date')) ?? new Date(), category: (str(formData, 'category') ?? 'OTHER') as HouseBudgetCategory, amountMinor: uzsMinor(str(formData, 'amount')) ?? 0n, contractorName: str(formData, 'contractorName') ?? '', description: str(formData, 'description') ?? '', documentId: str(formData, 'documentId') ?? null, paymentRequestId: str(formData, 'paymentRequestId') ?? null }));
}

/** BR-P53: зачёт поступления на счёт дома — единственный путь к PAID. */
export async function matchHouseReceiptAction(formData: FormData): Promise<void> {
  const ctx = await requireTenantContext();
  await run(str(formData, 'back') ?? '/house?view=charges', () => matchHouseReceipt(ctx, { bankTransactionId: str(formData, 'bankTransactionId') ?? '', houseChargeId: str(formData, 'houseChargeId') ?? '', amountMinor: uzsMinor(str(formData, 'amount')) }));
}

export async function setManagementContractStatusAction(formData: FormData): Promise<void> {
  const ctx = await requireTenantContext();
  await run(str(formData, 'back') ?? '/property/owners', () => setManagementContractStatus(ctx, str(formData, 'ownerId') ?? '', (str(formData, 'status') ?? 'NONE') as ManagementContractStatus, date(str(formData, 'signedAt'))));
}

export async function setUnitCadastreAction(formData: FormData): Promise<void> {
  const ctx = await requireTenantContext();
  const unitId = str(formData, 'unitId') ?? '';
  const area = str(formData, 'cadastralAreaM2');
  await run(str(formData, 'back') ?? `/property/units/${unitId}`, () => setUnitCadastre(ctx, unitId, { cadastralNumber: str(formData, 'cadastralNumber') ?? null, cadastralAreaM2: area ? Number(area) : null }));
}
