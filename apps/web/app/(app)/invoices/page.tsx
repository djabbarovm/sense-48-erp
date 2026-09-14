import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { can, formatMoney, money } from '@finance-os/core';
import { listInvoices, matchSuggestions, prisma } from '@finance-os/db';
import { requireTenantContext } from '@/lib/session';
import { Badge, Button, Card, Input, PageHeader, Table, Td, Th } from '@/components/ui';
import { ImportRegistryForm } from './import-form';
import { disputeInvoiceAction, matchInvoiceAction, resolveDuplicateAction } from './actions';

const TONE = {
  RECEIVED: 'blue',
  DUPLICATE_SUSPECT: 'red',
  MATCHED: 'green',
  DISPUTED: 'yellow',
  PARTIALLY_PAID: 'blue',
  PAID: 'green',
  CORRECTED: 'yellow',
  CANCELLED: 'gray',
} as const;

export default async function InvoicesPage() {
  const ctx = await requireTenantContext();
  if (!can(ctx, 'invoice.create')) notFound();
  const t = await getTranslations('invoices');

  const invoices = await listInvoices(ctx, {
    status: ['RECEIVED', 'DUPLICATE_SUSPECT', 'DISPUTED', 'MATCHED', 'CORRECTED'],
  });
  const vendors = new Map(
    (
      await prisma.vendor.findMany({
        where: { tenantId: ctx.tenantId, id: { in: [...new Set(invoices.map((i) => i.vendorId))] } },
        select: { id: true, displayName: true },
      })
    ).map((v) => [v.id, v.displayName]),
  );
  const suggestionsByInvoice = new Map<
    string,
    Awaited<ReturnType<typeof matchSuggestions>>
  >();
  for (const inv of invoices.filter((i) => i.status === 'RECEIVED').slice(0, 20)) {
    suggestionsByInvoice.set(inv.id, await matchSuggestions(ctx, inv.id));
  }
  const canResolveDup = can(ctx, 'invoice.resolve_duplicate');

  return (
    <div className="space-y-4">
      <PageHeader title={t('title')} />
      <ImportRegistryForm />

      <Table>
        <thead>
          <tr>
            <Th>{t('numberCol')}</Th>
            <Th>{t('vendorCol')}</Th>
            <Th>{t('date')}</Th>
            <Th className="text-right">{t('amount')}</Th>
            <Th>{t('typeCol')}</Th>
            <Th>{t('edo')}</Th>
            <Th>{t('statusLabel')}</Th>
            <Th />
          </tr>
        </thead>
        <tbody>
          {invoices.map((inv) => {
            const suggestions = suggestionsByInvoice.get(inv.id);
            return (
              <tr key={inv.id}>
                <Td className="font-medium">{inv.number}</Td>
                <Td>{vendors.get(inv.vendorId)}</Td>
                <Td>{inv.date.toISOString().slice(0, 10)}</Td>
                <Td className="money text-right">{formatMoney(money(inv.amountGrossMinor, inv.currency))}</Td>
                <Td>{inv.type}</Td>
                <Td>{inv.edoStatus !== 'NONE' ? <Badge tone="gray">{inv.edoStatus}</Badge> : '—'}</Td>
                <Td>
                  <Badge tone={TONE[inv.status]}>{t(`status.${inv.status}`)}</Badge>
                </Td>
                <Td>
                  <div className="flex flex-col gap-1.5">
                    {inv.status === 'RECEIVED' && suggestions
                      ? suggestions.prs.slice(0, 2).map(({ pr }) => (
                          <form key={pr.id} action={matchInvoiceAction}>
                            <input type="hidden" name="id" value={inv.id} />
                            <input type="hidden" name="prId" value={pr.id} />
                            <Button type="submit" variant="outline" size="sm">
                              {t('match')} → {pr.number}
                            </Button>
                          </form>
                        ))
                      : null}
                    {inv.status === 'RECEIVED' ? (
                      <form action={disputeInvoiceAction} className="flex items-center gap-1">
                        <input type="hidden" name="id" value={inv.id} />
                        <Input name="reason" placeholder={t('disputeReason')} className="w-44" required />
                        <Button type="submit" variant="ghost" size="sm">
                          {t('dispute')}
                        </Button>
                      </form>
                    ) : null}
                    {inv.status === 'DUPLICATE_SUSPECT' && canResolveDup ? (
                      <div className="flex items-center gap-1">
                        <form action={resolveDuplicateAction} className="flex items-center gap-1">
                          <input type="hidden" name="id" value={inv.id} />
                          <input type="hidden" name="resolution" value="NOT_DUPLICATE" />
                          <Input name="reason" placeholder={t('reason')} className="w-36" required />
                          <Button type="submit" variant="outline" size="sm">
                            {t('notDuplicate')}
                          </Button>
                        </form>
                        <form action={resolveDuplicateAction}>
                          <input type="hidden" name="id" value={inv.id} />
                          <input type="hidden" name="resolution" value="CONFIRM_DUPLICATE" />
                          <Button type="submit" variant="danger" size="sm">
                            {t('confirmDuplicate')}
                          </Button>
                        </form>
                      </div>
                    ) : null}
                  </div>
                </Td>
              </tr>
            );
          })}
        </tbody>
      </Table>

      {invoices.length === 0 ? (
        <Card>
          <p className="text-sm text-gray-500">—</p>
        </Card>
      ) : null}
    </div>
  );
}
