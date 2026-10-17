import { describe, expect, it } from 'vitest';
import { EnvError, loadEnv } from '../../src/config/env';

const PROD_OK = {
  NODE_ENV: 'production',
  AUTH_MODE: 'firebase',
  DATA_STORE: 'firestore',
  AI_PROVIDER: 'openai',
  AI_API_KEY: 'sk-test',
  AI_MODEL: 'gpt-4o-mini',
  FIREBASE_PROJECT_ID: 'demo-project',
  FIREBASE_CLIENT_EMAIL: 'svc@demo-project.iam.gserviceaccount.com',
  FIREBASE_PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----\\n',
  CONVERSATION_SECRET: 'a'.repeat(48),
  ADMIN_TOKEN: 'b'.repeat(32),
  FRONTEND_URLS: 'https://app.chatpilot.example',
  PUBLIC_APP_URL: 'https://app.chatpilot.example',
  PUBLIC_API_URL: 'https://api.chatpilot.example',
};

describe('env / production guard', () => {
  it('accepts a complete production config and unescapes the private key', () => {
    const env = loadEnv(PROD_OK);
    expect(env.devMode).toBe(false);
    expect(env.FIREBASE_PRIVATE_KEY).toContain('\nabc\n');
    expect(env.PUBLIC_WIDGET_URL).toBe('https://api.chatpilot.example/widget.js');
  });

  it.each([
    ['AUTH_MODE', 'dev', /AUTH_MODE=dev/],
    ['DATA_STORE', 'file', /DATA_STORE=file/],
    ['AI_PROVIDER', 'mock', /AI_PROVIDER=mock/],
    ['CONVERSATION_SECRET', 'dev-conversation-secret-change-me', /CONVERSATION_SECRET/],
    ['ADMIN_TOKEN', 'change-me-admin-token-at-least-32-characters', /ADMIN_TOKEN/],
    ['CONVERSATION_SECRET', 'change-me-hmac-secret-at-least-32-characters', /CONVERSATION_SECRET/],
    ['ADMIN_TOKEN', 'short', /ADMIN_TOKEN/],
    ['FRONTEND_URLS', 'http://localhost:5173', /localhost/],
  ])('refuses production with %s=%s', (key, value, re) => {
    expect(() => loadEnv({ ...PROD_OK, [key]: value })).toThrow(EnvError);
    expect(() => loadEnv({ ...PROD_OK, [key]: value })).toThrow(re);
  });

  it('requires AI credentials for the openai provider', () => {
    expect(() => loadEnv({ ...PROD_OK, AI_API_KEY: '' })).toThrow(/AI_API_KEY/);
  });

  it('allows dev shortcuts outside production and flags devMode', () => {
    const env = loadEnv({ NODE_ENV: 'development', AUTH_MODE: 'dev', DATA_STORE: 'file', AI_PROVIDER: 'mock' });
    expect(env.devMode).toBe(true);
    expect(env.DEV_JWT_SECRET.length).toBeGreaterThanOrEqual(16);
  });

  it('merges PLANS_JSON overrides onto defaults', () => {
    const env = loadEnv({ NODE_ENV: 'test', AUTH_MODE: 'dev', DATA_STORE: 'file', AI_PROVIDER: 'mock', PLANS_JSON: JSON.stringify([{ id: 'free', limits: { messagesPerMonth: 3 } }]) });
    const free = env.plansOverride!.find((p) => p.id === 'free')!;
    expect(free.limits.messagesPerMonth).toBe(3);
    expect(free.limits.chatbots).toBe(1);
  });
});
