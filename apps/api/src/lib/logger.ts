import pino, { type Logger } from 'pino';

export type { Logger };

export function createLogger(level: string = 'info', pretty = false): Logger {
  return pino({
    level,
    base: { service: 'chatpilot-api' },
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: {
      paths: [
        'authorization',
        'cookie',
        'apiKey',
        'token',
        'password',
        '*.authorization',
        '*.cookie',
        '*.apiKey',
        '*.token',
        '*.password',
        'req.headers.authorization',
        'req.headers.cookie',
        'headers.authorization',
        'headers.cookie',
        'headers["x-admin-token"]',
        'req.headers["x-admin-token"]',
        'req.headers["x-preview-token"]',
        'previewToken',
        'conversationToken',
        '*.previewToken',
        '*.conversationToken',
        'req.query',
        'req.body',
        'body',
        'query',
      ],
      censor: '[redacted]',
    },
    ...(pretty ? {} : {}),
  });
}
