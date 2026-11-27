export interface KVNamespace {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
  delete(key: string): Promise<void>;
}

function sanitizeSessionId(raw: string | null | undefined): string {
  if (!raw) return 'demo-visitor';
  const cleaned = raw.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);
  return cleaned || 'demo-visitor';
}

export type ProbeAttemptedAction = 'DELETE' | 'BYPASS_GOVERNANCE' | 'SHORTEN_RETENTION';
export type ProbeObjectLockMode = 'COMPLIANCE' | 'GOVERNANCE' | 'NONE';

export interface ResilienceProbeEnv {
  STATE_KV?: KVNamespace;
  ENVIRONMENT?: string;
}

export interface ProbeDeleteRequest {
  sessionId?: string;
  scenario?: string;
  attempted_action?: ProbeAttemptedAction;
  object_lock_mode?: ProbeObjectLockMode;
  snapshot_id?: string;
  bucket?: string;
  object_key?: string;
  retain_until_iso?: string;
}

interface ResilienceSessionKvRecord {
  session_id: string;
  scenario: string;
  object_lock_mode: ProbeObjectLockMode;
  tamper_attempts_blocked: number;
  last_attempted_action: ProbeAttemptedAction;
  last_status: 'R2_IMMUTABILITY_HELD' | 'R2_UNLOCKED_RISK';
  updated_at: string;
}

const MAX_BODY_BYTES = 64 * 1024;
const KV_TTL_SECONDS = 3600;
const MAX_EPHEMERAL_ENTRIES = 256;
const EPHEMERAL_TTL_MS = KV_TTL_SECONDS * 1000;
const VALID_ACTIONS = new Set<ProbeAttemptedAction>([
  'DELETE',
  'BYPASS_GOVERNANCE',
  'SHORTEN_RETENTION'
]);
const VALID_MODES = new Set<ProbeObjectLockMode>(['COMPLIANCE', 'GOVERNANCE', 'NONE']);

const ephemeralResilienceStore = new Map<
  string,
  { record: ResilienceSessionKvRecord; expiresAt: number }
>();

function getEphemeralResilience(key: string): ResilienceSessionKvRecord | null {
  const entry = ephemeralResilienceStore.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    ephemeralResilienceStore.delete(key);
    return null;
  }
  return entry.record;
}

function setEphemeralResilience(key: string, record: ResilienceSessionKvRecord): void {
  const now = Date.now();
  for (const [k, v] of ephemeralResilienceStore) {
    if (now > v.expiresAt) ephemeralResilienceStore.delete(k);
  }
  if (ephemeralResilienceStore.has(key)) ephemeralResilienceStore.delete(key);
  while (ephemeralResilienceStore.size >= MAX_EPHEMERAL_ENTRIES) {
    const oldest = ephemeralResilienceStore.keys().next().value;
    if (oldest === undefined) break;
    ephemeralResilienceStore.delete(oldest);
  }
  ephemeralResilienceStore.set(key, { record, expiresAt: now + EPHEMERAL_TTL_MS });
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store'
    }
  });
}

function defaultRetainUntilIso(): string {
  return new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
}

export async function onRequestPost(context: {
  request: Request;
  env: ResilienceProbeEnv;
}): Promise<Response> {
  const rawText = await context.request.text();
  if (rawText.length > MAX_BODY_BYTES) {
    return jsonResponse(
      {
        error: 'PAYLOAD_TOO_LARGE',
        message: 'Request payload exceeds 64KB limit.'
      },
      413
    );
  }

  let body: ProbeDeleteRequest = {};
  if (rawText.trim().length > 0) {
    try {
      body = JSON.parse(rawText) as ProbeDeleteRequest;
    } catch {
      return jsonResponse(
        {
          error: 'INVALID_JSON',
          message: 'Request body must be valid JSON.'
        },
        400
      );
    }
  }

  const sessionId = sanitizeSessionId(
    context.request.headers.get('X-Session-Id') || body.sessionId
  );
  const kvKey = `lab9:resilience:${sessionId}`;

  const attemptedAction: ProbeAttemptedAction =
    body.attempted_action && VALID_ACTIONS.has(body.attempted_action)
      ? body.attempted_action
      : 'DELETE';

  const objectLockMode: ProbeObjectLockMode =
    body.object_lock_mode && VALID_MODES.has(body.object_lock_mode)
      ? body.object_lock_mode
      : 'GOVERNANCE';

  const snapshotId = (body.snapshot_id || 'snap-r2-20261122-001').slice(0, 96);
  const bucket = (body.bucket || '0trust-prod-immutable-backups').slice(0, 128);
  const objectKey = (body.object_key || 'db/primary/2026-11-22T02-00Z.tar.zst.enc').slice(0, 180);
  const retainUntilIso = (body.retain_until_iso || defaultRetainUntilIso()).slice(0, 64);
  const scenario = (body.scenario || 'RANSOMWARE_PRIMARY_DB').slice(0, 64);
  const timestamp = new Date().toISOString();

  let existing: ResilienceSessionKvRecord | null = null;
  if (context.env.STATE_KV) {
    try {
      const raw = await context.env.STATE_KV.get(kvKey);
      if (raw) {
        existing = JSON.parse(raw) as ResilienceSessionKvRecord;
      }
    } catch {
      existing = null;
    }
  } else {
    existing = getEphemeralResilience(kvKey);
  }

  const prevBlocked = existing?.tamper_attempts_blocked ?? 0;
  const storageMode = context.env.STATE_KV ? 'cloudflare-kv' : 'ephemeral-edge';

  if (objectLockMode === 'COMPLIANCE') {
    const nextBlocked = prevBlocked + 1;
    const record: ResilienceSessionKvRecord = {
      session_id: sessionId,
      scenario,
      object_lock_mode: 'COMPLIANCE',
      tamper_attempts_blocked: nextBlocked,
      last_attempted_action: attemptedAction,
      last_status: 'R2_IMMUTABILITY_HELD',
      updated_at: timestamp
    };

    if (context.env.STATE_KV) {
      await context.env.STATE_KV.put(kvKey, JSON.stringify(record), {
        expirationTtl: KV_TTL_SECONDS
      });
    } else {
      setEphemeralResilience(kvKey, record);
    }

    return jsonResponse(
      {
        status: 'R2_IMMUTABILITY_HELD',
        http_status: 403,
        error_code: 'ObjectLockComplianceViolation',
        attempted_action: attemptedAction,
        object_lock_mode: 'COMPLIANCE',
        snapshot_id: snapshotId,
        bucket,
        object_key: objectKey,
        retain_until_iso: retainUntilIso,
        tamper_attempts_blocked: nextBlocked,
        invariant: 'OBJECT_LOCK_IMMUTABLE',
        storage: storageMode,
        kv_ttl_seconds: KV_TTL_SECONDS,
        timestamp,
        message: `Fail-closed: R2 Object Lock COMPLIANCE mode prevents ${attemptedAction} until retention expiry (${retainUntilIso}), even for root/admin credentials.`
      },
      403
    );
  }

  const record: ResilienceSessionKvRecord = {
    session_id: sessionId,
    scenario,
    object_lock_mode: objectLockMode,
    tamper_attempts_blocked: prevBlocked,
    last_attempted_action: attemptedAction,
    last_status: 'R2_UNLOCKED_RISK',
    updated_at: timestamp
  };

  if (context.env.STATE_KV) {
    await context.env.STATE_KV.put(kvKey, JSON.stringify(record), {
      expirationTtl: KV_TTL_SECONDS
    });
  } else {
    setEphemeralResilience(kvKey, record);
  }

  return jsonResponse(
    {
      status: 'R2_UNLOCKED_RISK',
      http_status: 200,
      attempted_action: attemptedAction,
      object_lock_mode: objectLockMode,
      snapshot_id: snapshotId,
      bucket,
      object_key: objectKey,
      retain_until_iso: retainUntilIso,
      tamper_attempts_blocked: prevBlocked,
      rpo_penalty_minutes: 1440,
      storage: storageMode,
      kv_ttl_seconds: KV_TTL_SECONDS,
      timestamp,
      message: `WARNING: Backup snapshot mutated/deleted because R2 Object Lock was in ${objectLockMode} mode (not COMPLIANCE — RPO degraded to 1440m).`
    },
    200
  );
}
