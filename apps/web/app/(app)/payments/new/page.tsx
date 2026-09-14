import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { can, formatMoney, money } from '@finance-os/core';
import { prisma } from '@finance-os/db';
import { requireTenantContext } from '@/lib/session';
import { PageHeader } from '@/components/ui';
import { PaymentWizard, type SourceOption } from './wizard-form';

export default async function NewPaymentPage() {
  const ctx = await requireTenantContext();
  if (!can(ctx, 'payment.create')) notFound();
  const t = await getTranslations('payments');

  const [invoices, prs, contracts] = await Promise.all([
    prisma.invoice.findMany({
      where: { tenantId: ctx.tenantId, status: { in: ['RECEIVED', 'MATCHED', 'PARTIALLY_PAID', 'CORRECTED'] } },
      orderBy: { date: 'desc' },
      take: 100,
    }),
    prisma.purchaseRequest.findMany({
      where: { tenantId: ctx.tenantId, status: { in: ['APPROVED', 'ORDERED', 'RECEIVED', 'INVOICED'] } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    }),
    prisma.contract.findMany({
      where: { tenantId: ctx.tenantId, status: { in: ['ACTIVE', 'EXPIRING', 'AMENDING'] } },
      orderBy: { number: 'asc' },
      take: 100,
    }),
  ]);
  const vendorIds = [
    ...new Set(
      [...invoices.map((i) => i.vendorId), ...prs.map((p) => p.vendorId), ...contracts.map((c) => c.vendorId)].filter(
        (v): v is string => !!v,
      ),
    ),
  ];
  const vendors = new Map(
    (
      await prisma.vendor.findMany({ where: { tenantId: ctx.tenantId, id: { in: vendorIds } }, select: { id: true, displayName: true } })
    ).map((v) => [v.id, v.displayName]),
  );
  const name = (id: string | null) => (id ? (vendors.get(id) ?? '') : '');

  const sources: SourceOption[] = [
    ...invoices.map((i) => ({
      type: 'INVOICE' as const,
      id: i.id,
      label: `${i.number} · ${name(i.vendorId)} · ${formatMoney(money(i.amountGrossMinor, i.currency))}`,
    })),
    ...prs.map((p) => ({
      type: 'PR' as const,
      id: p.id,
      label: `${p.number} · ${p.what} · ${formatMoney(money(p.totalMinor, 'UZS'))}`,
    })),
    ...contracts.map((c) => ({
      type: 'CONTRACT' as const,
      id: c.id,
      label: `${c.number} · ${name(c.vendorId)}`,
    })),
  ];

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <PageHeader title={t('newPayment')} />
      <PaymentWizard sources={sources} />
    </div>
  );
}
