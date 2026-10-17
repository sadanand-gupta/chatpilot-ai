import { PRODUCT_NAME_DEFAULT } from '@chatpilot/shared';

const env = import.meta.env;

const apiUrl = String(env.VITE_API_URL || 'http://localhost:8787').replace(/\/$/, '');

const firebaseConfig = {
  apiKey: env.VITE_FIREBASE_API_KEY as string | undefined,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN as string | undefined,
  projectId: env.VITE_FIREBASE_PROJECT_ID as string | undefined,
  appId: env.VITE_FIREBASE_APP_ID as string | undefined,
};

const firebaseConfigured = Boolean(firebaseConfig.apiKey && firebaseConfig.authDomain && firebaseConfig.projectId);

function resolveAuthMode(): 'firebase' | 'dev' {
  const explicit = String(env.VITE_AUTH_MODE || '').toLowerCase();
  if (explicit === 'dev') return 'dev';
  if (explicit === 'firebase') return firebaseConfigured ? 'firebase' : 'dev';
  return firebaseConfigured ? 'firebase' : 'dev';
}

export const appConfig = {
  apiUrl,
  widgetUrl: String(env.VITE_WIDGET_URL || `${apiUrl}/widget.js`),
  appUrl: String(env.VITE_PUBLIC_APP_URL || (typeof window !== 'undefined' ? window.location.origin : '')).replace(/\/$/, ''),
  productName: String(env.VITE_PRODUCT_NAME || PRODUCT_NAME_DEFAULT),
  authMode: resolveAuthMode(),
  contactEmail: String(env.VITE_CONTACT_EMAIL || ''),
  landingChatbotId: String(env.VITE_LANDING_CHATBOT_ID || ''),
  firebase: firebaseConfig,
};

export type AppConfig = typeof appConfig;
