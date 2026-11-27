import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createCloudRunApp, verifyRouterSecret } from '../server/app';
import {
  buildKvDocId,
  FirestoreKvAdapter,
  MemoryKvAdapter,
  type FirestoreCollectionLike,
  type FirestoreKvDoc
} from '../server/kvAdapter';
import { resolvePublicOrigin } from '../server/origin';

const TEST_ROUTER_SECRET = 'test-router-secret-value-0123456789';

function createMockFirestoreCollection(): {
  collection: FirestoreCollectionLike;
  store: Map<string, FirestoreKvDoc>;
} {
  const store = new Map<string, FirestoreKvDoc>();
  const collection: FirestoreCollectionLike = {
    doc(id: string) {
      return {
        async get() {
          const data = store.get(id);
          return {
            exists: Boolean(data),
            data: () => data
          };
        },
        async set(data: FirestoreKvDoc) {
          store.set(id, data);
        },
        async delete() {
          store.delete(id);
        }
      };
    }
  };
  return { collection, store };
}

describe('Lab 9 (Resilience Tabletop) Cloud Run Adapter — Security & /api/resilience/* Invariants', () => {
  it('blocks direct *.run.app /api/* requests without or with invalid X-Lab-Router-Secret (fail-closed 403)', async () => {
    const app = createCloudRunApp({
      env: {
        ENVIRONMENT: 'production',
        LAB_SLUG: 'resilience-tabletop',
        LAB_ROUTER_SECRET: TEST_ROUTER_SECRET
      },
      kv: new MemoryKvAdapter({ labSlug: 'resilience-tabletop' })
    });

    const payload = JSON.stringify({
      attempted_action: 'DELETE',
      object_lock_mode: 'GOVERNANCE'
    });

    // Missing header
    const resMissing = await app.request(
      'https://0trust-lab-resilience-tabletop-abc.run.app/api/resilience/probe-delete',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload
      }
    );
    assert.equal(resMissing.status, 403);
    assert.deepEqual(await resMissing.json(), { error: 'FORBIDDEN_DIRECT_ORIGIN' });

    // Wrong secret (same length & different length)
    const resWrongSameLen = await app.request(
      'https://0trust-lab-resilience-tabletop-abc.run.app/api/resilience/probe-delete',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-lab-router-secret': 'wrong-router-secret-value-987654321'
        },
        body: payload
      }
    );
    assert.equal(resWrongSameLen.status, 403);
    assert.deepEqual(await resWrongSameLen.json(), { error: 'FORBIDDEN_DIRECT_ORIGIN' });

    const resWrongDiffLen = await app.request(
      'https://0trust-lab-resilience-tabletop-abc.run.app/api/resilience/probe-delete',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-lab-router-secret': 'short'
        },
        body: payload
      }
    );
    assert.equal(resWrongDiffLen.status, 403);

    // Fail-closed when LAB_ROUTER_SECRET is unset in production
    const appUnconfigured = createCloudRunApp({
      env: {
        ENVIRONMENT: 'production',
        LAB_SLUG: 'resilience-tabletop'
      },
      kv: new MemoryKvAdapter({ labSlug: 'resilience-tabletop' })
    });
    const resUnconfigured = await appUnconfigured.request(
      'https://0trust-lab-resilience-tabletop-abc.run.app/api/resilience/probe-delete',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-lab-router-secret': TEST_ROUTER_SECRET
        },
        body: payload
      }
    );
    assert.equal(resUnconfigured.status, 403);
    assert.deepEqual(await resUnconfigured.json(), { error: 'FORBIDDEN_DIRECT_ORIGIN' });

    // Valid secret succeeds on /api/resilience/probe-delete
    const resValid = await app.request(
      'https://0trust-lab-resilience-tabletop-abc.run.app/api/resilience/probe-delete',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-lab-router-secret': TEST_ROUTER_SECRET
        },
        body: payload
      }
    );
    assert.equal(resValid.status, 200);
    const json = (await resValid.json()) as { status: string };
    assert.equal(json.status, 'R2_UNLOCKED_RISK');
    assert.equal(verifyRouterSecret(TEST_ROUTER_SECRET, TEST_ROUTER_SECRET), true);
  });

  it('serves GET /healthz without X-Lab-Router-Secret (Cloud Run probe)', async () => {
    const app = createCloudRunApp({
      env: {
        ENVIRONMENT: 'production',
        LAB_SLUG: 'resilience-tabletop',
        LAB_ROUTER_SECRET: TEST_ROUTER_SECRET
      },
      kv: new MemoryKvAdapter({ labSlug: 'resilience-tabletop' })
    });

    const res = await app.request(
      'https://0trust-lab-resilience-tabletop-abc.run.app/healthz'
    );
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true, lab: 'resilience-tabletop' });
  });

  it('synchronously returns null on expired TTL docs in FirestoreKvAdapter & MemoryKvAdapter', async () => {
    let nowMs = 1_700_000_000_000;
    const { collection, store } = createMockFirestoreCollection();
    const firestoreKv = new FirestoreKvAdapter({
      labSlug: 'resilience-tabletop',
      collectionRef: collection,
      nowFn: () => nowMs
    });

    await firestoreKv.put('lab9:resilience:session/1', '{"tamper_attempts_blocked":1}', {
      expirationTtl: 3600
    });
    const expectedDocId = buildKvDocId('resilience-tabletop', 'lab9:resilience:session/1');
    assert.equal(expectedDocId, 'resilience-tabletop:lab9%3Aresilience%3Asession%2F1');

    const storedDoc = store.get(expectedDocId);
    assert.ok(storedDoc);
    assert.equal(storedDoc.labSlug, 'resilience-tabletop');
    assert.equal(storedDoc.value, '{"tamper_attempts_blocked":1}');
    assert.equal(storedDoc.expireAt?.toMillis(), nowMs + 3_600_000);

    // Before expiry
    assert.equal(
      await firestoreKv.get('lab9:resilience:session/1'),
      '{"tamper_attempts_blocked":1}'
    );

    // Advance clock past TTL without deleting doc from Firestore (simulating delayed reaper)
    nowMs += 3_600_000;
    assert.equal(store.has(expectedDocId), true);
    assert.equal(await firestoreKv.get('lab9:resilience:session/1'), null);

    // MemoryKvAdapter parity
    let memNow = 1_700_000_000_000;
    const memKv = new MemoryKvAdapter({ labSlug: 'resilience-tabletop', nowFn: () => memNow });
    await memKv.put('lab9:resilience:abc', 'ok', { expirationTtl: 10 });
    assert.equal(await memKv.get('lab9:resilience:abc'), 'ok');
    memNow += 10_000;
    assert.equal(await memKv.get('lab9:resilience:abc'), null);
  });

  it('rejects forged X-Forwarded-Host headers and allows lab.0trust.dev & localhost:5177', () => {
    const forgedReq = new Request(
      'https://0trust-lab-resilience-tabletop-abc.run.app/api/resilience/probe-delete',
      { headers: { 'x-forwarded-host': 'evil.com', 'x-forwarded-proto': 'https' } }
    );
    assert.equal(
      resolvePublicOrigin(forgedReq),
      'https://0trust-lab-resilience-tabletop-abc.run.app'
    );

    const localReq = new Request(
      'http://127.0.0.1:8080/api/resilience/probe-delete',
      { headers: { 'x-forwarded-host': 'localhost:5177', 'x-forwarded-proto': 'http' } }
    );
    assert.equal(resolvePublicOrigin(localReq), 'http://localhost:5177');
  });

  it('redacts JWT signatures in _telemetry and never leaks X-Lab-Router-Secret or OTLP_AUTH_HEADER', async () => {
    const otlpAuthSecret = 'Bearer otlp-super-secret-header-token';
    const capturedOtlpBodies: string[] = [];
    const originalFetch = globalThis.fetch;

    globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
      capturedOtlpBodies.push(String(init?.body || ''));
      return new Response('{}', { status: 200 });
    }) as typeof fetch;

    try {
      const app = createCloudRunApp({
        env: {
          ENVIRONMENT: 'production',
          LAB_SLUG: 'resilience-tabletop',
          LAB_ROUTER_SECRET: TEST_ROUTER_SECRET,
          OTLP_ENDPOINT: 'https://otlp.example.com',
          OTLP_AUTH_HEADER: otlpAuthSecret
        },
        kv: new MemoryKvAdapter({ labSlug: 'resilience-tabletop' })
      });

      const fakeJwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyLTEifQ.SuperSecretSignatureXYZ123';
      const res = await app.request(
        'https://0trust-lab-resilience-tabletop-abc.run.app/api/resilience/probe-delete',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-lab-router-secret': TEST_ROUTER_SECRET,
            authorization: `Bearer ${fakeJwt}`,
            traceparent: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01'
          },
          body: JSON.stringify({
            attempted_action: 'DELETE',
            object_lock_mode: 'GOVERNANCE'
          })
        }
      );

      assert.equal(res.status, 200);
      assert.ok(res.headers.get('traceparent')?.startsWith('00-4bf92f3577b34da6a3ce929d0e0e4736-'));
      assert.ok(res.headers.get('X-Edge-Latency-Ms'));

      const bodyText = await res.text();
      assert.ok(!bodyText.includes('SuperSecretSignatureXYZ123'), 'JWT signature must be redacted');
      assert.ok(!bodyText.includes(TEST_ROUTER_SECRET), 'Router secret must never appear in response');
      assert.ok(!bodyText.includes(otlpAuthSecret), 'OTLP auth header must never appear in response');

      const parsed = JSON.parse(bodyText) as {
        _telemetry: { redacted_auth_header: string; redaction_applied: boolean };
      };
      assert.equal(parsed._telemetry.redaction_applied, true);
      assert.equal(
        parsed._telemetry.redacted_auth_header,
        'Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyLTEifQ.***REDACTED***'
      );

      await new Promise((r) => setTimeout(r, 10));
      assert.equal(capturedOtlpBodies.length, 2);
      for (const body of capturedOtlpBodies) {
        assert.ok(body.includes('zerotrust-lab-resilience-tabletop'));
        assert.ok(!body.includes(TEST_ROUTER_SECRET));
        assert.ok(!body.includes('SuperSecretSignatureXYZ123'));
        assert.ok(!body.includes(otlpAuthSecret));
      }
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('verifies /api/resilience/probe-delete route (GOVERNANCE 200 vs COMPLIANCE 403) and KV persistence', async () => {
    const kv = new MemoryKvAdapter({ labSlug: 'resilience-tabletop' });
    const app = createCloudRunApp({
      env: {
        ENVIRONMENT: 'development',
        LAB_SLUG: 'resilience-tabletop'
      },
      kv
    });

    const sessionId = 'lab9-happy-session';

    // 1. Vulnerable GOVERNANCE mode -> 200 R2_UNLOCKED_RISK
    const unlockedRes = await app.request(
      'http://127.0.0.1:8080/api/resilience/probe-delete',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Session-Id': sessionId },
        body: JSON.stringify({
          attempted_action: 'DELETE',
          object_lock_mode: 'GOVERNANCE'
        })
      }
    );
    assert.equal(unlockedRes.status, 200);
    const unlockedData = (await unlockedRes.json()) as {
      status: string;
      rpo_penalty_minutes: number;
      tamper_attempts_blocked: number;
    };
    assert.equal(unlockedData.status, 'R2_UNLOCKED_RISK');
    assert.equal(unlockedData.rpo_penalty_minutes, 1440);
    assert.equal(unlockedData.tamper_attempts_blocked, 0);

    // 2. Hardened COMPLIANCE mode -> 403 ObjectLockComplianceViolation (R2_IMMUTABILITY_HELD)
    const lockedRes = await app.request(
      'http://127.0.0.1:8080/api/resilience/probe-delete',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Session-Id': sessionId },
        body: JSON.stringify({
          attempted_action: 'BYPASS_GOVERNANCE',
          object_lock_mode: 'COMPLIANCE'
        })
      }
    );
    assert.equal(lockedRes.status, 403);
    const lockedData = (await lockedRes.json()) as {
      status: string;
      error_code: string;
      invariant: string;
      tamper_attempts_blocked: number;
    };
    assert.equal(lockedData.status, 'R2_IMMUTABILITY_HELD');
    assert.equal(lockedData.error_code, 'ObjectLockComplianceViolation');
    assert.equal(lockedData.invariant, 'OBJECT_LOCK_IMMUTABLE');
    assert.equal(lockedData.tamper_attempts_blocked, 1);

    // 3. Verify KV state persisted tamper_attempts_blocked = 1
    const storedRaw = await kv.get(`lab9:resilience:${sessionId}`);
    assert.ok(storedRaw);
    const stored = JSON.parse(storedRaw) as {
      tamper_attempts_blocked: number;
      last_status: string;
    };
    assert.equal(stored.tamper_attempts_blocked, 1);
    assert.equal(stored.last_status, 'R2_IMMUTABILITY_HELD');

    // 4. Non-existent /api/resilience-tabletop/probe-delete returns 404 (verifying route exception)
    const wrongPrefixRes = await app.request(
      'http://127.0.0.1:8080/api/resilience-tabletop/probe-delete',
      { method: 'POST' }
    );
    assert.equal(wrongPrefixRes.status, 404);
  });

  it('rejects >64 KB JSON body with 413 PAYLOAD_TOO_LARGE and malformed JSON with 400 INVALID_JSON', async () => {
    const app = createCloudRunApp({
      env: {
        ENVIRONMENT: 'production',
        LAB_SLUG: 'resilience-tabletop',
        LAB_ROUTER_SECRET: TEST_ROUTER_SECRET
      },
      kv: new MemoryKvAdapter({ labSlug: 'resilience-tabletop' })
    });

    const oversizedBody = JSON.stringify({
      attempted_action: 'DELETE',
      object_lock_mode: 'COMPLIANCE',
      padding: 'x'.repeat(65 * 1024)
    });

    const res413 = await app.request('http://127.0.0.1:8080/api/resilience/probe-delete', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Lab-Router-Secret': TEST_ROUTER_SECRET
      },
      body: oversizedBody
    });
    assert.equal(res413.status, 413);
    const body413 = (await res413.json()) as { error: string };
    assert.equal(body413.error, 'PAYLOAD_TOO_LARGE');

    const res400 = await app.request('http://127.0.0.1:8080/api/resilience/probe-delete', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Lab-Router-Secret': TEST_ROUTER_SECRET
      },
      body: '{malformed-json'
    });
    assert.equal(res400.status, 400);
    const body400 = (await res400.json()) as { error: string };
    assert.equal(body400.error, 'INVALID_JSON');
  });
});
