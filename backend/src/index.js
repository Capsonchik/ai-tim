import 'dotenv/config';
import cors from 'cors';
import express from 'express';

const app = express();

const PORT = Number(process.env.PORT || 3001);
const JIRA_BASE_URL = (process.env.JIRA_BASE_URL || '').replace(/\/+$/, '');
const APP_BASE_URL = (process.env.APP_BASE_URL || '').replace(/\/+$/, '');

const corsOrigins = (process.env.CORS_ORIGINS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

if (corsOrigins.length > 0) {
  app.use(
    cors({
      origin(origin, cb) {
        if (!origin) return cb(null, true);
        if (corsOrigins.includes(origin)) return cb(null, true);
        return cb(new Error(`CORS blocked for origin: ${origin}`));
      },
      credentials: true,
    }),
  );
}

app.use(express.json());

function requireJiraBaseUrl() {
  if (!JIRA_BASE_URL) {
    const err = new Error('JIRA_BASE_URL is not set');
    err.statusCode = 500;
    throw err;
  }
}

function buildJiraRequestInit(req) {
  const headers = new Headers();
  headers.set('Accept', 'application/json');

  const cookie = req.headers.cookie;
  if (cookie) headers.set('Cookie', cookie);

  return { headers };
}

async function jiraGetJson(req, jiraPath) {
  requireJiraBaseUrl();

  const url = `${JIRA_BASE_URL}${jiraPath.startsWith('/') ? '' : '/'}${jiraPath}`;
  const res = await fetch(url, {
    method: 'GET',
    redirect: 'manual',
    ...buildJiraRequestInit(req),
  });

  const text = await res.text();
  const contentType = res.headers.get('content-type') || '';
  const isJson = contentType.includes('application/json');
  const body = isJson && text ? JSON.parse(text) : text;

  return { status: res.status, body };
}

app.get('/api/health', (_req, res) => res.json({ ok: true }));

app.get('/api/me', async (req, res, next) => {
  try {
    const result = await jiraGetJson(req, '/rest/api/2/myself');

    if (result.status === 200) {
      return res.json({
        authenticated: true,
        authType: req.headers.cookie ? 'cookie' : 'none',
        user: result.body,
      });
    }

    if (result.status === 401 || result.status === 403) {
      const origin = req.headers.origin || '';
      const destination = APP_BASE_URL || origin || '';
      const loginUrl = destination
        ? `${JIRA_BASE_URL}/login.jsp?os_destination=${encodeURIComponent(destination)}`
        : `${JIRA_BASE_URL}/login.jsp`;

      return res.status(401).json({
        authenticated: false,
        loginUrl,
      });
    }

    return res.status(502).json({
      authenticated: false,
      error: 'Unexpected Jira response',
      jiraStatus: result.status,
      jiraBody: result.body,
    });
  } catch (e) {
    return next(e);
  }
});

app.get('/api/login', (req, res) => {
  requireJiraBaseUrl();

  const origin = req.headers.origin || '';
  const destination = APP_BASE_URL || origin || '';
  const loginUrl = destination
    ? `${JIRA_BASE_URL}/login.jsp?os_destination=${encodeURIComponent(destination)}`
    : `${JIRA_BASE_URL}/login.jsp`;

  res.redirect(302, loginUrl);
});

app.use((err, _req, res, _next) => {
  const status = Number(err?.statusCode || 500);
  res.status(status).json({
    error: err?.message || 'Internal Server Error',
  });
});

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Backend listening on http://localhost:${PORT}`);
});

