import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { onRequestPost } from '../functions/api/resilience/probe-delete';
import { MemoryKvAdapter } from '../server/kvAdapter';

function makeProbeRequest(
  body: unknown,
  headers: Record<string, string> = {}
): Request {
  const rawBody = typeof body === 'string' ? body : JSON.stringify(body);
  return new Request('https://lab.0trust.dev/api/resilience/probe-delete', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...headers
    },
    body: rawBody
  });
}

describe('Lab 9 (Resilience Tabletop) Layer 2 API — functions/api/resilience/probe-delete.ts', () => {
  it('allows privileged delete in GOVERNANCE mode (200 R2_UNLOCKED_RISK) and NONE mode', async () => {
    const kv = new MemoryKvAdapter({ labSlug: 'resilience-tabletop' });

    const govRes = await onRequestPost({
      request: makeProbeRequest({
        sessionId: 'gov-session-1',
        attempted_action: 'DELETE',
        object_lock_mode: 'GOVERNANCE'
      }),
      env: { STATE_KV: kv, ENVIRONMENT: 'test' }
    });
    assert.equal(govRes.status, 200);
    const govJson = (await govRes.json()) as {
      status: string;
      tamper_attempts_blocked: number;
    };
    assert.equal(govJson.status, 'R2_UNLOCKED_RISK');
    assert.equal(govJson.tamper_attempts_blocked, 0);

    const noneRes = await onRequestPost({
      request: makeProbeRequest({
        sessionId: 'none-session-1',
        attempted_action: 'SHORTEN_RETENTION',
        object_lock_mode: 'NONE'
      }),
      env: { STATE_KV: kv, ENVIRONMENT: 'test' }
    });
    assert.equal(noneRes.status, 200);
    const noneJson = (await noneRes.json()) as { status: string; tamper_attempts_blocked: number };
    assert.equal(noneJson.status, 'R2_UNLOCKED_RISK');
    assert.equal(noneJson.tamper_attempts_blocked, 0);
  });

  it('blocks even root/break-glass delete in COMPLIANCE mode (403 R2_IMMUTABILITY_HELD) and increments counter', async () => {
    const kv = new MemoryKvAdapter({ labSlug: 'resilience-tabletop' });
    const sessionId = 'compliance-session-1';

    const res1 = await onRequestPost({
      request: makeProbeRequest({
        sessionId,
        attempted_action: 'BYPASS_GOVERNANCE',
        object_lock_mode: 'COMPLIANCE'
      }),
      env: { STATE_KV: kv, ENVIRONMENT: 'test' }
    });
    assert.equal(res1.status, 403);
    const json1 = (await res1.json()) as {
      status: string;
      error_code: string;
      invariant: string;
      tamper_attempts_blocked: number;
    };
    assert.equal(json1.status, 'R2_IMMUTABILITY_HELD');
    assert.equal(json1.error_code, 'ObjectLockComplianceViolation');
    assert.equal(json1.invariant, 'OBJECT_LOCK_IMMUTABLE');
    assert.equal(json1.tamper_attempts_blocked, 1);

    const res2 = await onRequestPost({
      request: makeProbeRequest({
        sessionId,
        attempted_action: 'DELETE',
        object_lock_mode: 'COMPLIANCE'
      }),
      env: { STATE_KV: kv, ENVIRONMENT: 'test' }
    });
    assert.equal(res2.status, 403);
    const json2 = (await res2.json()) as { tamper_attempts_blocked: number };
    assert.equal(json2.tamper_attempts_blocked, 2);
  });

  it('rejects >64 KB payload (413) and malformed JSON (400) fail-closed', async () => {
    const kv = new MemoryKvAdapter({ labSlug: 'resilience-tabletop' });

    const res413 = await onRequestPost({
      request: makeProbeRequest({
        sessionId: 'oversized-session',
        padding: 'a'.repeat(65 * 1024)
      }),
      env: { STATE_KV: kv, ENVIRONMENT: 'test' }
    });
    assert.equal(res413.status, 413);
    assert.equal(((await res413.json()) as { error: string }).error, 'PAYLOAD_TOO_LARGE');

    const res400 = await onRequestPost({
      request: makeProbeRequest('{bad-json'),
      env: { STATE_KV: kv, ENVIRONMENT: 'test' }
    });
    assert.equal(res400.status, 400);
    assert.equal(((await res400.json()) as { error: string }).error, 'INVALID_JSON');
  });

  it('isolates session state in STATE_KV by X-Session-Id / sessionId', async () => {
    const kv = new MemoryKvAdapter({ labSlug: 'resilience-tabletop' });

    await onRequestPost({
      request: makeProbeRequest(
        { attempted_action: 'DELETE', object_lock_mode: 'COMPLIANCE' },
        { 'X-Session-Id': 'session-alpha' }
      ),
      env: { STATE_KV: kv, ENVIRONMENT: 'test' }
    });

    await onRequestPost({
      request: makeProbeRequest(
        { attempted_action: 'DELETE', object_lock_mode: 'GOVERNANCE' },
        { 'X-Session-Id': 'session-beta' }
      ),
      env: { STATE_KV: kv, ENVIRONMENT: 'test' }
    });

    const alphaRaw = await kv.get('lab9:resilience:session-alpha');
    const betaRaw = await kv.get('lab9:resilience:session-beta');
    assert.ok(alphaRaw);
    assert.ok(betaRaw);

    const alpha = JSON.parse(alphaRaw) as { tamper_attempts_blocked: number; last_status: string };
    const beta = JSON.parse(betaRaw) as { tamper_attempts_blocked: number; last_status: string };
    assert.equal(alpha.tamper_attempts_blocked, 1);
    assert.equal(alpha.last_status, 'R2_IMMUTABILITY_HELD');
    assert.equal(beta.tamper_attempts_blocked, 0);
    assert.equal(beta.last_status, 'R2_UNLOCKED_RISK');
  });
});
