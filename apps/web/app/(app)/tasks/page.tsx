import { getTranslations } from 'next-intl/server';
import { ListTodo } from 'lucide-react';
import { listTasks } from '@finance-os/db';
import { requireTenantContext } from '@/lib/session';
import { Badge, Button, Card, EmptyState, Input, PageHeader } from '@/components/ui';
import { setTaskStatusAction } from './actions';

const TONE = { OPEN: 'blue', IN_PROGRESS: 'yellow', DONE: 'green', CANCELLED: 'gray', OVERDUE: 'red' } as const;

export default async function TasksPage() {
  const ctx = await requireTenantContext();
  const t = await getTranslations('tasks');
  const tasks = await listTasks(ctx, { status: ['OPEN', 'IN_PROGRESS', 'OVERDUE'] });

  return (
    <div className="space-y-4">
      <PageHeader title={t('title')} meta={<Badge tone="gray">{tasks.length}</Badge>} />
      {tasks.length === 0 ? <EmptyState icon={<ListTodo />} text={t('empty')} /> : null}
      <div className="space-y-3">
        {tasks.map((task) => (
          <Card key={task.id}>
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={TONE[task.status]} dot>
                {t(`status.${task.status}`)}
              </Badge>
              <Badge tone="gray">{task.type}</Badge>
              {task.dueAt ? (
                <span className="text-xs text-gray-400">
                  {t('due')}: {task.dueAt.toISOString().slice(0, 10)}
                </span>
              ) : null}
            </div>
            <p className="mt-2 text-sm font-medium">{task.nextAction}</p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {task.status === 'OPEN' || task.status === 'OVERDUE' ? (
                <form action={setTaskStatusAction}>
                  <input type="hidden" name="taskId" value={task.id} />
                  <input type="hidden" name="status" value="IN_PROGRESS" />
                  <Button type="submit" variant="outline" size="sm">
                    {t('take')}
                  </Button>
                </form>
              ) : null}
              <form action={setTaskStatusAction}>
                <input type="hidden" name="taskId" value={task.id} />
                <input type="hidden" name="status" value="DONE" />
                <Button type="submit" size="sm">
                  {t('done')}
                </Button>
              </form>
              <form action={setTaskStatusAction} className="flex items-center gap-1">
                <input type="hidden" name="taskId" value={task.id} />
                <input type="hidden" name="status" value="CANCELLED" />
                <Input name="reason" placeholder={t('cancelReason')} className="w-48" required />
                <Button type="submit" variant="ghost" size="sm">
                  {t('cancel')}
                </Button>
              </form>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
