'use client';

import { useActionState } from 'react';
import { useTranslations } from 'next-intl';
import { loginAction, type LoginState } from '@/lib/auth-actions';
import { Button, Input, Label } from '@/components/ui';

export default function LoginPage() {
  const t = useTranslations('auth');
  const [state, formAction, pending] = useActionState<LoginState, FormData>(loginAction, {});
  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-ink-900 px-4">
      {/* фоновые свечения */}
      <div className="pointer-events-none absolute -top-40 -left-40 h-[480px] w-[480px] rounded-full bg-brand-600/30 blur-[120px]" />
      <div className="pointer-events-none absolute -right-40 -bottom-40 h-[480px] w-[480px] rounded-full bg-brand-400/20 blur-[120px]" />

      <div className="relative w-full max-w-sm">
        <div className="mb-8 flex items-center justify-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-brand-400 to-brand-700 text-lg font-bold text-white shadow-pop">
            F
          </div>
          <span className="text-2xl font-semibold tracking-tight text-white">
            Finance<span className="text-brand-400">OS</span>
          </span>
        </div>

        <div className="rounded-2xl border border-white/10 bg-white/[0.06] p-6 shadow-pop backdrop-blur-xl">
          <h1 className="mb-5 text-center text-[15px] font-medium text-slate-300">{t('title')}</h1>
          <form action={formAction} className="space-y-4">
            <div>
              <Label htmlFor="email" className="text-slate-300">
                {t('email')}
              </Label>
              <Input
                id="email"
                name="email"
                type="email"
                autoComplete="username"
                required
                className="border-white/10 bg-white/10 text-white placeholder:text-slate-500 hover:border-white/20 focus:border-brand-400 focus:ring-brand-500/30"
              />
            </div>
            <div>
              <Label htmlFor="password" className="text-slate-300">
                {t('password')}
              </Label>
              <Input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
                className="border-white/10 bg-white/10 text-white placeholder:text-slate-500 hover:border-white/20 focus:border-brand-400 focus:ring-brand-500/30"
              />
            </div>
            {state.error ? (
              <p role="alert" className="rounded-lg bg-red-500/15 px-3 py-2 text-sm text-red-300">
                {t('invalidCredentials')}
              </p>
            ) : null}
            <Button type="submit" disabled={pending} className="w-full">
              {t('signIn')}
            </Button>
          </form>
        </div>
        <p className="mt-6 text-center text-xs text-slate-500">Finance Operations as a Service</p>
      </div>
    </main>
  );
}
