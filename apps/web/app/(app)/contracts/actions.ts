'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import type { ContractTrigger } from '@finance-os/core';
import { createContract, transitionContract } from '@finance-os/db';
import { requireTenantContext } from '@/lib/session';

export async function createContractAction(formData: FormData): Promise<void> {
  const ctx = await requireTenantContext();
  const limitRaw = String(formData.get('limit') ?? '').replace(/\s/g, '');
  const endDate = String(formData.get('endDate') ?? '');
  const contract = await createContract(ctx, {
    number: String(formData.get('number') ?? ''),
    counterpartyType: 'VENDOR',
    vendorId: String(formData.get('vendorId') ?? ''),
    subject: String(formData.get('subject') ?? ''),
    startDate: new Date(String(formData.get('startDate'))),
    ...(endDate ? { endDate: new Date(endDate) } : {}),
    ...(limitRaw ? { limitMinor: BigInt(limitRaw) * 100n } : {}),
    registrationRequired: formData.get('registrationRequired') === 'on',
    paymentTerms: {
      type: String(formData.get('termsType') ?? 'POSTPAY_DAYS') as 'PREPAY_PCT' | 'POSTPAY_DAYS' | 'SCHEDULE',
      value: Number(formData.get('termsValue') ?? 0),
    },
  });
  redirect(`/contracts/${contract.id}`);
}

export async function transitionContractAction(formData: FormData): Promise<void> {
  const ctx = await requireTenantContext();
  const id = String(formData.get('id'));
  await transitionContract(ctx, id, String(formData.get('trigger')) as ContractTrigger);
  revalidatePath(`/contracts/${id}`);
}
