import path from 'node:path';
import { createApp } from './app';
import { EnvError, loadDotenv, loadEnv, type Env } from './config/env';
import type { Store } from './data/store';
import { createLogger } from './lib/logger';
import { devVerifier, firebaseVerifier, type TokenVerifier } from './middleware/auth';

async function main() {
  await loadDotenv();
  let env: Env;
  try {
    env = loadEnv();
  } catch (e) {
    if (e instanceof EnvError) {
      console.error(`\n[chatpilot-api] Refusing to start.\n${e.message}\n`);
      process.exit(1);
    }
    throw e;
  }
  const logger = createLogger(env.LOG_LEVEL);

  let store: Store;
  let verifier: TokenVerifier;
  let deleteAuthUser: ((uid: string) => Promise<void>) | undefined;

  const needsFirebase = env.DATA_STORE === 'firestore' || env.AUTH_MODE === 'firebase';
  const fbApp = needsFirebase ? (await import('./lib/firebase')).getFirebaseApp(env) : undefined;

  if (env.DATA_STORE === 'firestore') {
    const { createFirestoreStore } = await import('./data/firestoreStore');
    store = createFirestoreStore(fbApp!);
  } else {
    const { createFileStore } = await import('./data/fileStore');
    store = createFileStore({ dir: path.resolve(env.FILE_STORE_DIR) });
  }

  if (env.AUTH_MODE === 'firebase') {
    const { getAuth } = await import('firebase-admin/auth');
    const auth = getAuth(fbApp!);
    verifier = firebaseVerifier(auth);
    deleteAuthUser = (uid) => auth.deleteUser(uid);
  } else {
    verifier = devVerifier(env.DEV_JWT_SECRET);
  }

  if (env.devMode) {
    const flags = [
      env.AUTH_MODE === 'dev' && 'AUTH_MODE=dev (anyone can sign in with any email)',
      env.DATA_STORE === 'file' && `DATA_STORE=file (${path.resolve(env.FILE_STORE_DIR)})`,
      env.AI_PROVIDER === 'mock' && 'AI_PROVIDER=mock (replies end with a "Dev preview answer" note)',
    ].filter(Boolean);
    logger.warn({ devMode: true, flags }, '*** DEV MODE *** — never use these settings in production');
    console.warn(`\n  *** DEV MODE ***\n  ${flags.join('\n  ')}\n`);
  }

  const { app, ctx, shutdown } = createApp({ env, store, logger, verifier, deleteAuthUser });
  await ctx.crawls.recoverOnBoot().catch((e) => logger.error({ err: (e as Error).message }, 'crawl recovery failed'));
  ctx.cleanup.start(env.CLEANUP_INTERVAL_MS);

  const server = app.listen(env.PORT, () => {
    logger.info({ port: env.PORT, store: store.kind, authMode: env.AUTH_MODE, ai: ctx.ai.name }, `${env.PRODUCT_NAME} API listening on http://localhost:${env.PORT}`);
  });
  server.requestTimeout = 60_000;
  server.headersTimeout = 20_000;

  let stopping = false;
  const stop = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    logger.info({ signal }, 'shutting down');
    server.close();
    await shutdown().catch(() => undefined);
    await store.close().catch(() => undefined);
    process.exit(0);
  };
  process.on('SIGTERM', () => void stop('SIGTERM'));
  process.on('SIGINT', () => void stop('SIGINT'));
  process.on('unhandledRejection', (reason) => logger.error({ err: String(reason) }, 'unhandled rejection'));
}

main().catch((e) => {
  console.error('[chatpilot-api] fatal startup error:', e);
  process.exit(1);
});
