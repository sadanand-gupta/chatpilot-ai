import { applicationDefault, cert, getApps, initializeApp, type App } from 'firebase-admin/app';
import type { Env } from '../config/env';

/** Initialises firebase-admin once (inline service account or ADC / GOOGLE_APPLICATION_CREDENTIALS). */
export function getFirebaseApp(env: Env): App {
  const existing = getApps()[0];
  if (existing) return existing;
  if (env.FIREBASE_PROJECT_ID && env.FIREBASE_CLIENT_EMAIL && env.FIREBASE_PRIVATE_KEY) {
    return initializeApp({
      credential: cert({ projectId: env.FIREBASE_PROJECT_ID, clientEmail: env.FIREBASE_CLIENT_EMAIL, privateKey: env.FIREBASE_PRIVATE_KEY }),
      projectId: env.FIREBASE_PROJECT_ID,
    });
  }
  return initializeApp({ credential: applicationDefault(), projectId: env.FIREBASE_PROJECT_ID });
}
