'use server';

import { revalidatePath } from 'next/cache';
import type { PayrollCheckResult } from '@finance-os/db';
import {
  approvePayrollRun,
  checkPayrollRun,
  createPayrollPayment,
  createPayrollRun,
  markPayrollPosted,
} from '@finance-os/db';
import { requireTenantContext } from '@/lib/session';

const soumToMinor = (value: FormDataEntryValue | null) => BigInt(String(value ?? '0').replace(/\s/g, '') || '0') * 100n;

export async function createPayrollAction(formData: FormData): Promise<void> {
  const ctx = await requireTenantContext();
  await createPayrollRun(ctx, {
    period: String(formData.get('period')),
    employeeCount: Number(formData.get('employeeCount') ?? 0),
    grossMinor: soumToMinor(formData.get('gross')),
    netMinor: soumToMinor(formData.get('net')),
    taxesMinor: soumToMinor(formData.get('taxes')),
  });
  revalidatePath('/payroll');
}

export interface CheckState {
  runId?: string;
  result?: PayrollCheckResult;
  error?: string;
}

/** BR-047: реестр — текстовый список ФИО (по строке) или CSV c колонкой ФИО. */
export async function checkPayrollAction(_prev: CheckState, formData: FormData): Promise<CheckState> {
  const ctx = await requireTenantContext();
  const runId = String(formData.get('id'));
  const file = formData.get('file');
  try {
    let names: string[] = [];
    if (file instanceof File && file.size > 0) {
      names = Buffer.from(await file.arrayBuffer())
        .toString('utf8')
        .split(/\r?\n/)
        .map((line) => line.split(';')[0]!.trim())
        .filter((line) => line && !/^фио|^full_name/i.test(line));
    }
    const result = await checkPayrollRun(ctx, runId, names);
    revalidatePath('/payroll');
    return { runId, result };
  } catch (error) {
    return { runId, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function approvePayrollAction(formData: FormData): Promise<void> {
  const ctx = await requireTenantContext();
  await approvePayrollRun(ctx, String(formData.get('id')));
  revalidatePath('/payroll');
}

export async function createPayrollPaymentAction(formData: FormData): Promise<void> {
  const ctx = await requireTenantContext();
  await createPayrollPayment(ctx, String(formData.get('id')));
  revalidatePath('/payroll');
  revalidatePath('/payments');
}

export async function markPostedAction(formData: FormData): Promise<void> {
  const ctx = await requireTenantContext();
  await markPayrollPosted(ctx, String(formData.get('id')));
  revalidatePath('/payroll');
}
