'use client';

import { useActionState, useState } from 'react';
import { useTranslations } from 'next-intl';
import { AlertTriangle, CheckCircle2, ShieldCheck, XCircle } from 'lucide-react';
import { Badge, Button, Card, Input, Label, Select, cn } from '@/components/ui';
import { createPaymentAction, previewPaymentAction, type WizardState } from '../actions';

export interface SourceOption {
  type: 'INVOICE' | 'PR' | 'CONTRACT';
  id: string;
  label: string;
  ref: string; // готовое назначение платежа — подставляется в «Назначение», чтобы не печатать вручную
}

const EMPTY: WizardState = {
  values: { sourceType: 'INVOICE', sourceId: '', amount: '', purpose: '', dueDate: '', isPrepayment: false },
};

function formatSoum(minorStr: string): string {
  const minor = BigInt(minorStr);
  const soum = minor / 100n;
  return `${soum.toLocaleString('ru-RU')} UZS`;
}

export function PaymentWizard({ sources }: { sources: SourceOption[] }) {
  const t = useTranslations('payments');
  const [previewState, previewFormAction, previewPending] = useActionState(previewPaymentAction, EMPTY);
  const [createState, createFormAction, createPending] = useActionState(createPaymentAction, EMPTY);
  const [sourceType, setSourceType] = useState(previewState.values.sourceType);

  const state = createState.error ? createState : previewState;
  const values = state.values;
  const options = sources.filter((s) => s.type === sourceType);
  const preview = previewState.preview;

  return (
    <Card>
      <form className="space-y-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="pw-type">{t('sourceType')}</Label>
            <Select
              id="pw-type"
              name="sourceType"
              value={sourceType}
              onChange={(e) => setSourceType(e.target.value as SourceOption['type'])}
            >
              <option value="INVOICE">{t('source.INVOICE')}</option>
              <option value="PR">{t('source.PR')}</option>
              <option value="CONTRACT">{t('source.CONTRACT')}</option>
            </Select>
          </div>
          <div>
            <Label htmlFor="pw-source">{t('sourceObject')}</Label>
            <Select
              id="pw-source"
              name="sourceId"
              required
              defaultValue={values.sourceId}
              onChange={(e) => {
                // Автоподстановка назначения из выбранного объекта, если поле пустое (без перезаписи ручного ввода)
                const opt = options.find((s) => s.id === e.target.value);
                const purposeEl = document.getElementById('pw-purpose') as HTMLInputElement | null;
                if (opt && purposeEl && !purposeEl.value) purposeEl.value = opt.ref;
              }}
            >
              <option value="">—</option>
              {options.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </Select>
          </div>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="pw-amount">{t('amountSoum')}</Label>
            <Input id="pw-amount" name="amount" type="number" min="1" required defaultValue={values.amount} />
          </div>
          <div>
            <Label htmlFor="pw-due">{t('dueDate')}</Label>
            <Input id="pw-due" name="dueDate" type="date" defaultValue={values.dueDate} />
          </div>
        </div>
        <div>
          <Label htmlFor="pw-purpose">{t('purpose')}</Label>
          <Input id="pw-purpose" name="purpose" required defaultValue={values.purpose} />
        </div>
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input type="checkbox" name="isPrepayment" defaultChecked={values.isPrepayment} className="h-4 w-4 accent-volt-600" />
          {t('isPrepayment')}
        </label>

        {state.error ? (
          <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>
        ) : null}

        {preview ? (
          <div className="animate-rise space-y-2 rounded-md border border-gray-200 bg-gray-50/70 p-3">
            <div className="flex items-center justify-between text-sm">
              <span className="text-gray-600">{t('outstanding')}</span>
              <span className="money font-semibold">{formatSoum(preview.outstandingMinor)}</span>
            </div>
            <ul className="space-y-1">
              {preview.controls.map((c) => (
                <li key={c.code} className="flex items-start gap-1.5 text-xs">
                  {c.result === 'PASS' ? (
                    <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-volt-600" />
                  ) : c.result === 'WARN' ? (
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
                  ) : (
                    <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-500" />
                  )}
                  <span className={cn('font-mono font-semibold', c.result === 'FAIL' && 'text-red-700')}>{c.code}</span>
                  {c.detail ? <span className="text-gray-500">{c.detail}</span> : null}
                </li>
              ))}
            </ul>
            <div className="pt-1">
              {preview.wouldBeReady ? (
                <Badge tone="green">
                  <ShieldCheck className="h-3 w-3" /> {t('willBeReady')}
                </Badge>
              ) : (
                <Badge tone="red">{t('willBeBlocked')}</Badge>
              )}
            </div>
          </div>
        ) : null}

        <div className="flex items-center gap-2 pt-1">
          <Button type="submit" variant="outline" formAction={previewFormAction} disabled={previewPending}>
            {previewPending ? t('checking') : t('checkControls')}
          </Button>
          <Button type="submit" formAction={createFormAction} disabled={createPending}>
            {createPending ? t('creating') : t('createAndSubmit')}
          </Button>
        </div>
      </form>
    </Card>
  );
}
