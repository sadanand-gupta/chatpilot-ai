/**
 * Firestore Security Rules unit tests (OUTLINE — not part of `npm test`).
 *
 * Why separate: these need the Firestore emulator, which needs a Java runtime
 * (JDK; see https://firebase.google.com/docs/emulator-suite/install_and_configure).
 * The default dev setup (DATA_STORE=file) does not need Java.
 *
 * How to run (from the repo root, once Java is installed):
 *   npm i -D --no-save @firebase/rules-unit-testing firebase vitest
 *   npx firebase emulators:exec --only firestore --project demo-chatpilot \
 *     "npx vitest run firebase/rules-tests"
 *
 * The `demo-` project prefix keeps the emulator fully offline (no real project).
 * CI: add a separate job with `actions/setup-java` + the command above.
 */
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import {
  assertFails,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { collection, doc, getDoc, getDocs, setDoc, deleteDoc, query, where } from 'firebase/firestore';

let env: RulesTestEnvironment;

// Every collection the API uses (see docs/DATA_MODEL.md).
const PATHS = [
  'users/alice',
  'plans/free',
  'chatbots/cb1',
  'chatbots/cb1/versions/1',
  'chatbots/cb1/sources/s1',
  'chatbots/cb1/chunks/c1',
  'chatbots/cb1/crawlJobs/j1',
  'publicConfigs/pub_abc',
  'conversations/conv1',
  'conversations/conv1/messages/m1',
  'leads/l1',
  'usage/alice_2026-10',
];

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-chatpilot',
    firestore: { rules: readFileSync('firebase/firestore.rules', 'utf8') },
  });
});

beforeEach(async () => {
  await env.clearFirestore();
  // Seed data as the Admin SDK would (rules bypassed).
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    for (const p of PATHS) {
      await setDoc(doc(db, p), { ownerId: 'alice', text: 'seed' });
    }
  });
});

afterAll(async () => {
  await env?.cleanup();
});

describe('deny-all client access', () => {
  for (const path of PATHS) {
    it(`unauthenticated cannot read/write ${path}`, async () => {
      const db = env.unauthenticatedContext().firestore();
      await assertFails(getDoc(doc(db, path)));
      await assertFails(setDoc(doc(db, path), { x: 1 }));
      await assertFails(deleteDoc(doc(db, path)));
    });

    it(`even the OWNER cannot read/write ${path} directly`, async () => {
      const db = env.authenticatedContext('alice').firestore();
      await assertFails(getDoc(doc(db, path)));
      await assertFails(setDoc(doc(db, path), { x: 1 }, { merge: true }));
    });
  }

  it('cannot list chatbots, even filtered by own ownerId', async () => {
    const db = env.authenticatedContext('alice').firestore();
    await assertFails(getDocs(query(collection(db, 'chatbots'), where('ownerId', '==', 'alice'))));
  });

  it('cannot create arbitrary new collections', async () => {
    const db = env.authenticatedContext('alice').firestore();
    await assertFails(setDoc(doc(db, 'anything/x'), { x: 1 }));
  });

  // When you relax rules (e.g. owner-read of users/{uid}), add BOTH directions:
  //   assertSucceeds(getDoc(doc(aliceDb, 'users/alice')))
  //   assertFails(getDoc(doc(bobDb, 'users/alice')))
});
