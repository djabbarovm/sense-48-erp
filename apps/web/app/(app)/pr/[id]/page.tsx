import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { NotFoundError, formatMoney, money } from '@finance-os/core';
import { getPr } from '@finance-os/db';
import { requireTenantContext } from '@/lib/session';
import { Badge, Button, Card, Input, Table, Td, Th } from '@/components/ui';
import { cancelPrAction, decideApprovalAction, submitPrAction } from '../actions';

export default async function PrPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireTenantContext();
  const { id } = await params;
  const t = await getTranslations('pr');

  let dto: Awaited<ReturnType<typeof getPr>>;
  try {
    dto = await getPr(ctx, id);
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }
  const { pr, approvals, audit, vendor, category, costCenter } = dto;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">{pr.number}</h1>
        <Badge tone={pr.status === 'APPROVED' ? 'green' : pr.status === 'REJECTED' ? 'red' : 'blue'}>
          {t(`status.${pr.status}`)}
        </Badge>
        {pr.budgetStatus ? (
          <Badge tone={pr.budgetStatus === 'WITHIN' ? 'green' : 'yellow'}>{t(`budgetBadge.${pr.budgetStatus}`)}</Badge>
        ) : null}
        {pr.tier ? <Badge tone="gray">{`${t('tier')} ${pr.tier}`}</Badge> : null}
        {pr.isFastLane ? <Badge tone="blue">{t('fastLane')}</Badge> : null}
      </div>

      <Card>
        <dl className="grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
          <div>
            <dt className="text-gray-500">{t('what')}</dt>
            <dd className="font-medium">{pr.what}</dd>
          </div>
          <div>
            <dt className="text-gray-500">{t('amount')}</dt>
            <dd className="font-medium">{formatMoney(money(pr.totalMinor, pr.currency))}</dd>
          </div>
          <div>
            <dt className="text-gray-500">{t('costCenter')}</dt>
            <dd>{costCenter?.code}</dd>
          </div>
          <div>
            <dt className="text-gray-500">{t('category')}</dt>
            <dd>{category?.name}</dd>
          </div>
          <div>
            <dt className="text-gray-500">{t('vendorLabel')}</dt>
            <dd>{vendor?.displayName ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-gray-500">{t('purpose')}</dt>
            <dd>{pr.purpose}</dd>
          </div>
        </dl>
        <div className="mt-3 flex flex-wrap gap-2">
          {pr.status === 'DRAFT' ? (
            <form action={submitPrAction}>
              <input type="hidden" name="id" value={pr.id} />
              <Button type="submit">{t('submit')}</Button>
            </form>
          ) : null}
          {['DRAFT', 'SUBMITTED', 'APPROVED'].includes(pr.status) ? (
            <form action={cancelPrAction} className="flex items-end gap-2">
              <input type="hidden" name="id" value={pr.id} />
              <Input name="comment" placeholder={t('cancelComment')} required className="w-56" />
              <Button type="submit" variant="danger">
                {t('cancel')}
              </Button>
            </form>
          ) : null}
        </div>
      </Card>

      <Card>
        <h2 className="mb-2 font-medium">{t('approvals')}</h2>
        <Table>
          <thead>
            <tr>
              <Th>{t('tier')}</Th>
              <Th>{t('statusLabel')}</Th>
              <Th>{t('approve')}</Th>
            </tr>
          </thead>
          <tbody>
            {approvals.map((a) => (
              <tr key={a.id}>
                <Td>{a.role}</Td>
                <Td>
                  {a.decision ? (
                    <Badge tone={a.decision === 'APPROVED' ? 'green' : 'red'}>{a.decision}</Badge>
                  ) : (
                    <Badge tone="yellow">…</Badge>
                  )}
                  {a.comment ? <span className="ml-2 text-gray-500">{a.comment}</span> : null}
                </Td>
                <Td>
                  {!a.decision && pr.status === 'SUBMITTED' ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <form action={decideApprovalAction}>
                        <input type="hidden" name="id" value={pr.id} />
                        <input type="hidden" name="role" value={a.role} />
                        <input type="hidden" name="decision" value="APPROVED" />
                        <Button type="submit" variant="outline">
                          {t('approve')}
                        </Button>
                      </form>
                      <form action={decideApprovalAction} className="flex items-center gap-1">
                        <input type="hidden" name="id" value={pr.id} />
                        <input type="hidden" name="role" value={a.role} />
                        <input type="hidden" name="decision" value="REJECTED" />
                        <Input name="comment" placeholder={t('rejectComment')} className="w-64" />
                        <Button type="submit" variant="danger">
                          {t('reject')}
                        </Button>
                      </form>
                    </div>
                  ) : null}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>

      <Card>
        <h2 className="mb-2 font-medium">{t('timeline')}</h2>
        <ul className="space-y-1 text-sm">
          {audit.map((a) => (
            <li key={a.id} className="flex gap-2">
              <span className="text-gray-400">{a.at.toISOString().slice(0, 16).replace('T', ' ')}</span>
              <span>{a.action}</span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
