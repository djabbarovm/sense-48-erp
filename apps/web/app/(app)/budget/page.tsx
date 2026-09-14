import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { can, formatMoney, money } from '@finance-os/core';
import { listBudgetMatrix, listCategories, listCostCenters } from '@finance-os/db';
import { requireTenantContext } from '@/lib/session';
import { Badge, Button, Card, Input, Label, Select, Table, Td, Th } from '@/components/ui';
import { upsertBudgetLineAction } from './actions';

export default async function BudgetPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}) {
  const ctx = await requireTenantContext();
  if (!can(ctx, 'budget.manage')) notFound();
  const t = await getTranslations('budget');
  const { period: rawPeriod } = await searchParams;
  const period = rawPeriod && /^\d{4}-\d{2}$/.test(rawPeriod) ? rawPeriod : new Date().toISOString().slice(0, 7);

  const [rows, costCenters, categories] = await Promise.all([
    listBudgetMatrix(ctx, period),
    listCostCenters(ctx),
    listCategories(ctx),
  ]);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4">
        <h1 className="text-xl font-semibold">{t('title')}</h1>
        <form className="flex items-center gap-2">
          <Input name="period" type="month" defaultValue={period} className="w-auto" />
          <Button type="submit" variant="outline">
            OK
          </Button>
        </form>
      </div>

      <Table>
        <thead>
          <tr>
            <Th>{t('costCenter')}</Th>
            <Th>{t('category')}</Th>
            <Th>{t('planned')}</Th>
            <Th>{t('committed')}</Th>
            <Th>{t('actual')}</Th>
            <Th>{t('remaining')}</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <Td>{row.costCenter.code}</Td>
              <Td>{row.category.name}</Td>
              <Td>{formatMoney(money(row.plannedMinor, 'UZS'))}</Td>
              <Td>{formatMoney(money(row.status.committedMinor, 'UZS'))}</Td>
              <Td>{formatMoney(money(row.status.actualMinor, 'UZS'))}</Td>
              <Td>
                {row.status.remainingMinor < 0n ? (
                  <Badge tone="red">{formatMoney(money(row.status.remainingMinor, 'UZS'))}</Badge>
                ) : (
                  formatMoney(money(row.status.remainingMinor, 'UZS'))
                )}
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>

      <Card>
        <form action={upsertBudgetLineAction} className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="period" value={period} />
          <div>
            <Label htmlFor="b-cc">{t('costCenter')}</Label>
            <Select id="b-cc" name="costCenterId">
              {costCenters.map((cc) => (
                <option key={cc.id} value={cc.id}>
                  {cc.code}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="b-cat">{t('category')}</Label>
            <Select id="b-cat" name="categoryId">
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="b-planned">{t('planAmount')}</Label>
            <Input id="b-planned" name="planned" type="number" required className="w-40" />
          </div>
          <Button type="submit">{t('save')}</Button>
        </form>
      </Card>
    </div>
  );
}
