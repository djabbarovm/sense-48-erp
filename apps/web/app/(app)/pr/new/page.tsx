import { getTranslations } from 'next-intl/server';
import { listCategories, listCostCenters, listVendors } from '@finance-os/db';
import { requireTenantContext } from '@/lib/session';
import { Button, Card, Input, Label, Select } from '@/components/ui';
import { createPrAction } from '../actions';

export default async function NewPrPage() {
  const ctx = await requireTenantContext();
  const t = await getTranslations('pr');
  const [costCenters, categories, vendors] = await Promise.all([
    listCostCenters(ctx),
    listCategories(ctx),
    listVendors(ctx),
  ]);
  return (
    <div className="mx-auto max-w-lg space-y-4">
      <h1 className="text-xl font-semibold">{t('new')}</h1>
      <Card>
        <form action={createPrAction} className="space-y-3">
          <div>
            <Label htmlFor="pr-what">{t('what')}</Label>
            <Input id="pr-what" name="what" required />
          </div>
          <div>
            <Label htmlFor="pr-purpose">{t('purpose')}</Label>
            <Input id="pr-purpose" name="purpose" required />
          </div>
          <div>
            <Label htmlFor="pr-amount">{t('amount')}</Label>
            <Input id="pr-amount" name="amount" type="number" min="1" required />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="pr-cc">{t('costCenter')}</Label>
              <Select id="pr-cc" name="costCenterId" required>
                {costCenters.filter((c) => c.isActive).map((cc) => (
                  <option key={cc.id} value={cc.id}>
                    {cc.code}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="pr-cat">{t('category')}</Label>
              <Select id="pr-cat" name="categoryId" required>
                {categories.filter((c) => c.isActive).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </div>
          </div>
          <div>
            <Label htmlFor="pr-vendor">{t('vendorLabel')}</Label>
            <Select id="pr-vendor" name="vendorId">
              <option value="">{t('noVendor')}</option>
              {vendors.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.displayName}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="pr-needed">{t('neededBy')}</Label>
            <Input id="pr-needed" name="neededBy" type="date" />
          </div>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-1 text-sm">
              <input type="checkbox" name="isUrgent" /> {t('urgent')}
            </label>
            <Select name="urgencyReason" className="w-auto">
              <option value="">—</option>
              <option value="EVENT_72H">EVENT_72H</option>
              <option value="TAX_DEADLINE">TAX_DEADLINE</option>
              <option value="SUPPLIER_STOP">SUPPLIER_STOP</option>
              <option value="SAFETY">SAFETY</option>
              <option value="OTHER">OTHER</option>
            </Select>
          </div>
          <div>
            <Label htmlFor="pr-var">{t('varianceReason')}</Label>
            <Input id="pr-var" name="varianceReason" />
          </div>
          <Button type="submit" className="w-full">
            {t('create')}
          </Button>
        </form>
      </Card>
    </div>
  );
}
