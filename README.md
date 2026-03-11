# Jira-auth React app (BFF)

## Архитектура (как это работает)

Схема для on-prem Jira, чтобы не упираться в CORS и не светить секреты во фронт:

- **Frontend (React)** вызывает наш **Backend (BFF)** по `/api/*`
- **Backend** проверяет авторизацию, обращаясь в Jira REST API:
  - основной "пинг авторизации": `GET /rest/api/2/myself`
  - если Jira вернула 200 — пользователь авторизован
  - если Jira вернула 401/403 — пользователь не авторизован (или нет прав)

### Авторизация (cookie-only)

Работаем **только через Jira cookies**:

- бэкенд **пробрасывает `Cookie`** пользователя в Jira при запросе `GET /rest/api/2/myself`
- это даёт **персональную** проверку — кто в Jira вошёл в браузере, тот и "авторизован" в приложении

Требование: приложение нужно отдавать **под тем же “сайтом”**, что и Jira (обычно тот же домен/поддомен и HTTPS), иначе браузер не будет отправлять Jira-сессионные cookies.

## Структура проекта

- `backend/` — Node.js (Express) BFF
  - `GET /api/health` — проверка, что бэкенд жив
  - `GET /api/me` — проверка авторизации через Jira `myself`
  - `GET /api/login` — редирект на Jira login page
- `frontend/` — React (Vite)
  - на старте дергает `/api/me`
  - если `authenticated=true` — показывает контент
  - если 401 — показывает кнопку "Войти" (ведёт на `/api/login` или `loginUrl`)

## Быстрый старт (локально)

### 1) Настройка переменных окружения бэка

В `backend` создайте файл `.env` на базе `.env.example`.

Обязательное:

- `JIRA_BASE_URL` — базовый URL Jira, пример: `https://jira.company.local`

Опционально:

- `PORT=3001` — порт бэкенда
- `APP_BASE_URL=http://localhost:5173` — используется для `os_destination` при редиректе на Jira login
- `CORS_ORIGINS=http://localhost:5173` — список origin’ов для CORS в dev (comma-separated)

Пример `.env`:

```env
PORT=3001
JIRA_BASE_URL=https://jira.company.local
APP_BASE_URL=https://apps.company.local
```

### 2) Запуск

```bash
cd backend
npm run dev
```

```bash
cd frontend
npm run dev
```

### 3) Проверка

- Откройте `http://localhost:5173/`
- Фронт вызовет `GET /api/me`
  - если `JIRA_BASE_URL` не выставлен — бэк вернёт 500 (это ожидаемо, пока не настроили `.env`)
  - если cookie валидны — увидите "Авторизация OK" и JSON пользователя Jira
  - если невалидно — увидите экран "Нужен вход через Jira"

## Важно для прод-сценария (cookie mode)

Чтобы проверка была **персональной (по пользователю)** через Jira-сессию, обычно нужно сделать reverse proxy так, чтобы:

- frontend и backend были доступны под одним "внешним" доменом приложения (например `apps.company.local`)
- Jira была доступна под доменом, который **совместим по cookie** с тем, как пользователи реально логинятся в Jira
- браузер реально отправлял Jira cookies в запросах к приложению (а приложение — пробрасывало их в Jira)

### Практический вариант развёртывания (рекомендуемый)

**Вариант A (самый простой):** отдавать приложение *на том же домене*, где живёт Jira, например:

- Jira: `https://jira.company.local/`
- Приложение (frontend): `https://jira.company.local/apps/`
- Приложение (backend API): `https://jira.company.local/apps-api/` (или `/api/` под тем же доменом)

Тогда cookies Jira (сессия) по умолчанию доступны в запросах к этому домену, и cookie-mode работает "из коробки".

**Вариант B (отдельный домен приложения):** `https://apps.company.local/`, Jira отдельно `https://jira.company.local/`.

Это сложнее, потому что Jira cookies обычно не уходят на другой домен. В таком варианте чаще делают:

- либо SSO/IdP интеграцию (чтобы у приложения была своя сессия)
- либо проксируют Jira под домен приложения (по сути приближаясь к варианту A)

### Пример Nginx конфигурации (эскиз)

Ниже пример, если хотим отдавать приложение под доменом Jira (вариант A). Подстройте пути под свою инфраструктуру.

```nginx
server {
  listen 443 ssl;
  server_name jira.company.local;

  # 1) Jira как была
  location / {
    proxy_pass http://jira-internal:8080;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  }

  # 2) Frontend приложения
  location /apps/ {
    proxy_pass http://frontend-internal:5173/; # в проде лучше на static hosting или vite build
    proxy_set_header Host $host;
  }

  # 3) Backend приложения (API)
  location /api/ {
    proxy_pass http://backend-internal:3001/api/;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;

    # если нужно прокидывать cookies без изменений:
    proxy_set_header Cookie $http_cookie;
  }
}
```

Важно:

- в проде фронт обычно собирают (`npm run build`) и отдают статикой (Nginx/S3/minio/…); Vite dev сервер — только для разработки
- если Jira использует `SameSite`/`Secure` cookies (часто так и есть), то всё должно быть по **HTTPS**

## Прод-сборка фронта (если отдаём не из корня домена)

Если фронт будет доступен, например, по `https://jira.company.local/apps/`, то Vite нужно собрать с base path.

Варианты:

- настроить `base` в `frontend/vite.config.ts`, например `base: '/apps/'`, и собрать `npm run build`
- либо проксировать так, чтобы внешне это был `/` (и тогда base не нужен)

После `npm run build` статика будет в `frontend/dist/`.

## API контракты (что ожидает фронт)

### `GET /api/me`

Успех:

```json
{
  "authenticated": true,
  "authType": "cookie",
  "user": { "... Jira /myself JSON ..." }
}
```

Не авторизован:

```json
{
  "authenticated": false,
  "loginUrl": "https://jira.company.local/login.jsp?os_destination=..."
}
```

### `GET /api/login`

Делает `302` редирект на Jira login page (с `os_destination`, если возможно).

## Безопасность и ограничения

- Cookie-режим требует правильной схемы доменов/HTTPS, иначе браузер не будет отправлять Jira cookies.

## Troubleshooting (частые проблемы)

- **`JIRA_BASE_URL is not set`**: не создан `.env` или не выставлена переменная `JIRA_BASE_URL`.
- **401/403 от Jira**:
  - cookie mode: браузер не шлёт Jira cookies (другой домен / нет HTTPS / пользователи не залогинены в Jira)
- **CORS в dev**:
  - в `frontend` уже есть proxy `/api -> http://localhost:3001`
  - если ходите напрямую на `http://localhost:3001` из браузера, включите `CORS_ORIGINS`

## Чеклист для команды, которая будет интегрировать дальше

- Для prod cookie-mode решить схему доменов/reverse proxy (вариант A предпочтительнее).
- В `frontend/src/App.tsx` заменить блок "Контент приложения" на реальный UI/роутинг.
- Если фронт отдаём из под-пути (`/apps/`), настроить Vite `base` и правильно настроить прокси/статику.


