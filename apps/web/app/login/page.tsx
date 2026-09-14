'use client';

import { useActionState } from 'react';
import { loginAction, type LoginState } from '@/lib/auth-actions';

export default function LoginPage() {
  const [state, formAction, pending] = useActionState<LoginState, FormData>(loginAction, {});
  return (
    <main style={{ maxWidth: 360, margin: '10vh auto', padding: 16 }}>
      <h1>Finance OS</h1>
      <form action={formAction}>
        <label>
          Email
          <input name="email" type="email" autoComplete="username" required style={{ width: '100%' }} />
        </label>
        <label>
          Пароль
          <input
            name="password"
            type="password"
            autoComplete="current-password"
            required
            style={{ width: '100%' }}
          />
        </label>
        {state.error ? <p role="alert">Неверный email или пароль</p> : null}
        <button type="submit" disabled={pending}>
          Войти
        </button>
      </form>
    </main>
  );
}
