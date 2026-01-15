const axios = require('axios');

const { getTraceId } = require('../../runtime/trace_context');
const { sanitizeErrorForLog } = require('../../runtime/log_sanitize');

function createNotionHttpClient({ notionToken, eventLogRepo = null, component = 'notion' }) {
  const baseURL = process.env.NOTION_BASE_URL || 'https://api.notion.com/v1/';
  const http = axios.create({
    baseURL,
    headers: {
      Authorization: `Bearer ${notionToken}`,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json',
    },
    timeout: 60_000,
  });

  if (eventLogRepo) {
    http.interceptors.request.use((config) => {
      config.__tgMeta = { startMs: Date.now() };
      eventLogRepo
        .appendEvent({
          traceId: getTraceId() || 'no-trace',
          component,
          event: 'notion_request',
          level: 'info',
          payload: {
            method: String(config.method || 'get').toUpperCase(),
            path: String(config.url || ''),
          },
        })
        .catch(() => {});
      return config;
    });

    http.interceptors.response.use(
      (resp) => {
        const startMs = resp?.config?.__tgMeta?.startMs || null;
        const durationMs = startMs ? Date.now() - startMs : null;
        eventLogRepo
          .appendEvent({
            traceId: getTraceId() || 'no-trace',
            component,
            event: 'notion_response',
            level: 'info',
            durationMs,
            payload: {
              status: resp.status,
              method: String(resp?.config?.method || 'get').toUpperCase(),
              path: String(resp?.config?.url || ''),
            },
          })
          .catch(() => {});
        return resp;
      },
      (err) => {
        const startMs = err?.config?.__tgMeta?.startMs || null;
        const durationMs = startMs ? Date.now() - startMs : null;
        eventLogRepo
          .appendEvent({
            traceId: getTraceId() || 'no-trace',
            component,
            event: 'notion_error',
            level: 'error',
            durationMs,
            payload: {
              method: String(err?.config?.method || 'get').toUpperCase(),
              path: String(err?.config?.url || ''),
              error: sanitizeErrorForLog(err),
            },
          })
          .catch(() => {});
        return Promise.reject(err);
      }
    );
  }

  return http;
}

module.exports = { createNotionHttpClient };



