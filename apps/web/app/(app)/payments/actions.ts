'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import type { PaymentExceptionType, PaymentSourceType } from '@finance-os/db';
import {
  addToBatch,
  approvePaymentException,
  cancelPaymentRequest,
  createBatch,
  createPaymentRequest,
  listPayments,
  previewPaymentControls,
  prisma,
  resolvePaymentHold,
  submitPaymentRequest,
} from '@finance-os/db';
import { requireTenantContext } from '@/lib/session';

export interface WizardControl {
  code: string;
  result: 'PASS' | 'WARN' | 'FAIL';
  detail?: string;
}

export interface WizardState {
  error?: string;
  preview?: {
    grossMinor: string;
    outstandingMinor: string;
    wouldBeReady: boolean;
    controls: WizardControl[];
  };
  values: {
    sourceType: string;
    sourceId: string;
    amount: string;
    purpose: string;
    dueDate: string;
    isPrepayment: boolean;
  };
}

function readWizardInput(formData: FormData) {
  const soum = String(formData.get('amount') ?? '0').replace(/\s/g, '');
  const dueDate = String(formData.get('dueDate') ?? '');
  return {
    sourceType: String(formData.get('sourceType') ?? 'INVOICE') as PaymentSourceType,
    sourceId: String(formData.get('sourceId') ?? ''),
    requestedMinor: BigInt(soum || '0') * 100n,
    purposeNote: String(formData.get('purpose') ?? ''),
    ...(dueDate ? { dueDate: new Date(dueDate) } : {}),
    isPrepayment: formData.get('isPrepayment') === 'on',
  };
}

export async function previewPaymentAction(_prev: WizardState, formData: FormData): Promise<WizardState> {
  const ctx = await requireTenantContext();
  const input = readWizardInput(formData);
  const values: WizardState['values'] = {
    sourceType: input.sourceType,
    sourceId: input.sourceId,
    amount: String(formData.get('amount') ?? ''),
    purpose: input.purposeNote,
    dueDate: String(formData.get('dueDate') ?? ''),
    isPrepayment: input.isPrepayment,
  };
  try {
    const preview = await previewPaymentControls(ctx, input);
    return {
      values,
      preview: {
        grossMinor: preview.grossMinor.toString(),
        outstandingMinor: preview.outstandingMinor.toString(),
        wouldBeReady: preview.wouldBeReady,
        controls: preview.controls.map((c) => ({
          code: c.code,
          result: c.result,
          ...(c.detail ? { detail: c.detail } : {}),
        })),
      },
    };
  } catch (error) {
    return { values, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function createPaymentAction(_prev: WizardState, formData: FormData): Promise<WizardState> {
  const ctx = await requireTenantContext();
  const input = readWizardInput(formData);
  try {
    const created = await createPaymentRequest(ctx, input);
    await submitPaymentRequest(ctx, created.id);
  } catch (error) {
    return {
      values: {
        sourceType: input.sourceType,
        sourceId: input.sourceId,
        amount: String(formData.get('amount') ?? ''),
        purpose: input.purposeNote,
        dueDate: String(formData.get('dueDate') ?? ''),
        isPrepayment: input.isPrepayment,
      },
      error: error instanceof Error ? error.message : String(error),
    };
  }
  revalidatePath('/payments');
  redirect('/payments');
}

export async function approveExceptionAction(formData: FormData): Promise<void> {
  const ctx = await requireTenantContext();
  await approvePaymentException(
    ctx,
    String(formData.get('id')),
    String(formData.get('exceptionType')) as PaymentExceptionType,
    String(formData.get('reason') ?? ''),
  );
  revalidatePath('/payments');
}

export async function resolveHoldAction(formData: FormData): Promise<void> {
  const ctx = await requireTenantContext();
  await resolvePaymentHold(ctx, String(formData.get('id')));
  revalidatePath('/payments');
}

export async function cancelPaymentAction(formData: FormData): Promise<void> {
  const ctx = await requireTenantContext();
  await cancelPaymentRequest(ctx, String(formData.get('id')), String(formData.get('comment') ?? '—'));
  revalidatePath('/payments');
}

export async function submitDraftAction(formData: FormData): Promise<void> {
  const ctx = await requireTenantContext();
  await submitPaymentRequest(ctx, String(formData.get('id')));
  revalidatePath('/payments');
}

/** «Собрать batch»: все READY_FOR_BATCH → сегодняшний OPEN STANDARD batch на выбранном счёте. */
export async function collectBatchAction(formData: FormData): Promise<void> {
  const ctx = await requireTenantContext();
  const bankAccountId = String(formData.get('bankAccountId') ?? '');
  const ready = (await listPayments(ctx, { status: ['READY_FOR_BATCH'] })).filter((p) => !p.isUrgent);
  let batchId: string;
  const existing = await prisma.paymentBatch.findFirst({
    where: { tenantId: ctx.tenantId, bankAccountId, type: 'STANDARD', status: 'OPEN' },
    orderBy: { batchDate: 'desc' },
  });
  if (existing) {
    batchId = existing.id;
  } else {
    const created = await createBatch(ctx, { bankAccountId });
    batchId = created.id;
  }
  for (const payment of ready) {
    await addToBatch(ctx, batchId, payment.id);
  }
  revalidatePath('/payments');
  redirect(`/batches/${batchId}`);
}
