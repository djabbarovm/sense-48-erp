import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { formatMoney, money } from '@finance-os/core';
import { listMyPendingApprovals } from '@finance-os/db';
import { requireTenantContext } from '@/lib/session';
import { Badge, Button, Card, Input } from '@/components/ui';
import { decideApprovalAction } from '../pr/actions';

export default async function ApprovalsPage() {
  const ctx = await requireTenantContext();
  const t = await getTranslations('approvals');
  const tPr = await getTranslations('pr');
  const pending = await listMyPendingApprovals(ctx);

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <h1 className="text-xl font-semibold">{t('title')}</h1>
      {pending.length === 0 ? <p className="text-gray-500">{t('empty')}</p> : null}
      {pending.map(({ pr, slot }) => (
        <Card key={slot.id}>
          <div className="flex flex-wrap items-center gap-2">
            <Link href={`/pr/${pr.id}`} className="font-medium text-brand hover:underline">
              {pr.number}
            </Link>
            <Badge tone="blue">{slot.role}</Badge>
            {pr.budgetStatus ? (
              <Badge tone={pr.budgetStatus === 'WITHIN' ? 'green' : 'yellow'}>
                {tPr(`budgetBadge.${pr.budgetStatus}`)}
              </Badge>
            ) : null}
          </div>
          <p className="mt-1 text-sm">
            {pr.what} — <b>{formatMoney(money(pr.totalMinor, pr.currency))}</b>
          </p>
          <p className="text-sm text-gray-500">{pr.purpose}</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <form action={decideApprovalAction}>
              <input type="hidden" name="id" value={pr.id} />
              <input type="hidden" name="role" value={slot.role} />
              <input type="hidden" name="decision" value="APPROVED" />
              <Button type="submit">{t('approve')}</Button>
            </form>
            <form action={decideApprovalAction} className="flex items-center gap-1">
              <input type="hidden" name="id" value={pr.id} />
              <input type="hidden" name="role" value={slot.role} />
              <input type="hidden" name="decision" value="REJECTED" />
              <Input name="comment" placeholder={tPr('rejectComment')} className="w-56" />
              <Button type="submit" variant="danger">
                {t('reject')}
              </Button>
            </form>
          </div>
        </Card>
      ))}
    </div>
  );
}
