import { getTranslations } from 'next-intl/server';
import { requireSessionUser } from '@/lib/session';
import { Card } from '@/components/ui';

export default async function HomePage() {
  const user = await requireSessionUser();
  const t = await getTranslations('home');
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">{t('title')}</h1>
      <Card>
        <p>{t('welcome', { name: user.fullName })}</p>
      </Card>
    </div>
  );
}
