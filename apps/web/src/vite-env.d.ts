/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
  readonly VITE_WIDGET_URL?: string;
  readonly VITE_PUBLIC_APP_URL?: string;
  readonly VITE_PRODUCT_NAME?: string;
  readonly VITE_AUTH_MODE?: 'firebase' | 'dev';
  readonly VITE_FIREBASE_API_KEY?: string;
  readonly VITE_FIREBASE_AUTH_DOMAIN?: string;
  readonly VITE_FIREBASE_PROJECT_ID?: string;
  readonly VITE_FIREBASE_APP_ID?: string;
  readonly VITE_LANDING_CHATBOT_ID?: string;
  readonly VITE_CONTACT_EMAIL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
