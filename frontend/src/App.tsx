import { useEffect, useMemo, useState } from 'react';
import AgentComponent from './components/AgentComponent';

type AuthState =
  | { status: 'loading' }
  | { status: 'authed'; user: unknown; authType?: string }
  | { status: 'not_authed'; loginUrl?: string; error?: string };

async function fetchMe(): Promise<AuthState> {
  const res = await fetch('/api/me', { credentials: 'include' });
  const data = (await res.json()) as any;

  if (res.ok && data?.authenticated) {
    return { status: 'authed', user: data.user, authType: data.authType };
  }

  if (res.status === 401) {
    return { status: 'not_authed', loginUrl: data?.loginUrl };
  }

  return { status: 'not_authed', error: data?.error || 'Не удалось проверить авторизацию' };
}

export default function App() {
  const [state, setState] = useState<AuthState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    fetchMe()
      .then((s) => {
        if (!cancelled) setState(s);
      })
      .catch((e) => {
        if (!cancelled) setState({ status: 'not_authed', error: e?.message || 'Ошибка сети' });
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const content = useMemo(() => {
    if (state.status === 'loading') {
      return (
        <div className="card">
          <h1>Загрузка…</h1>
          <p>Проверяем авторизацию в Jira.</p>
        </div>
      );
    }

    if (state.status === 'not_authed') {
      return (
        <div className="card">
          <h1>Нужен вход через Jira</h1>
          <p>
            {state.error ? state.error : 'Сессия Jira не найдена или нет доступа.'}
          </p>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <a className="button" href={state.loginUrl || '/api/login'}>
              Войти
            </a>
            <button className="button secondary" onClick={() => setState({ status: 'loading' })}>
              Повторить
            </button>
          </div>
          <p className="hint">
            Для on-prem Jira самый простой прод-сценарий — отдавать это приложение под тем же сайтом,
            что и Jira, чтобы Jira-cookie доходили до бэка.
          </p>
        </div>
      );
    }

    return (
      <div className="card">
        <h1>Авторизация OK</h1>
        <p className="hint">Источник: {state.authType || 'неизвестно'}</p>
        <div className="content">
          <h2>Контент приложения</h2>
          <p>Ниже просто отладочный вывод пользователя Jira (endpoint `myself`).</p>
          <pre>{JSON.stringify(state.user, null, 2)}</pre>
          <AgentComponent/>
        </div>
      </div>
    );
  }, [state]);

  return (
    <div className="page">
      <div className="container">{content}</div>
    </div>
  );
}

