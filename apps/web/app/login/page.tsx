'use client';

import { useActionState } from 'react';
import { useTranslations } from 'next-intl';
import { loginAction, type LoginState } from '@/lib/auth-actions';

export default function LoginPage() {
  const t = useTranslations('auth');
  const [state, formAction, pending] = useActionState<LoginState, FormData>(loginAction, {});
  return (
    <main style={{ maxWidth: 360, margin: '10vh auto', padding: 16 }}>
      <h1>{t('title')}</h1>
      <form action={formAction}>
        <label>
          {t('email')}
          <input name="email" type="email" autoComplete="username" required style={{ width: '100%' }} />
        </label>
        <label>
          {t('password')}
          <input
            name="password"
            type="password"
            autoComplete="current-password"
            required
            style={{ width: '100%' }}
          />
        </label>
        {state.error ? <p role="alert">{t('invalidCredentials')}</p> : null}
        <button type="submit" disabled={pending}>
          {t('signIn')}
        </button>
      </form>
    </main>
  );
}
