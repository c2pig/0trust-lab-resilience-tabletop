import {
  CRISIS_SCENARIOS,
  CrisisScenarioId,
  InfrastructureTierId,
  PostIncidentTimelineEntry,
  ProbeDeleteApiResponse,
  R2MutationAction,
  RecoveryChoices,
  RedTeamScenarioId,
  ResilienceAuditEvent,
  ResilienceTabletopState,
  SLA_TARGETS,
  SlaTier,
  TabletopOutcome,
  TabletopStage,
  TierHealth
} from '../contracts/resilienceContract';
import { ObservabilitySpan } from '../types';

function randomHex(bytes: number): string {
  const arr = new Uint8Array(bytes);
  if (typeof globalThis !== 'undefined' && globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(arr);
  } else {
    for (let i = 0; i < bytes; i++) {
      arr[i] = Math.floor(Math.random() * 256);
    }
  }
  return Array.from(arr, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function createResilienceSessionId(): string {
  return `vis_lab9_${randomHex(5)}`;
}

export function generateCorrelationId(): string {
  return `corr-lab9-${randomHex(6)}`;
}

export function generateTraceparent(): string {
  return `00-${randomHex(16)}-${randomHex(8)}-01`;
}

function makeEventId(): string {
  return `evt-${randomHex(5)}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

function plusDaysIso(days: number): string {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

function plusMinutesIso(minutes: number): string {
  return new Date(Date.now() + minutes * 60 * 1000).toISOString();
}

/**
 * Vulnerable Stage 2 Defaults (Safe-to-Fail Traps per Sprint Spec & Security Architect Spec).
 */
export const DEFAULT_RECOVERY_CHOICES: RecoveryChoices = {
  backup_mode: 'R2_GOVERNANCE_OR_UNLOCKED',
  failover_strategy: 'COLD_REBUILD',
  access_strategy: 'SINGLE_ADMIN_BYPASS',
  health_quorum_probes: 1,
  dual_custody_approvers: ['sre-lead-fido2@0trust.dev']
};

/**
 * Hardened Platinum Recovery Configuration (2-of-2 FIDO2 + R2 COMPLIANCE + Warm-Standby Quorum).
 */
export const PLATINUM_RECOVERY_CHOICES: RecoveryChoices = {
  backup_mode: 'R2_OBJECT_LOCK_COMPLIANCE',
  failover_strategy: 'WARM_STANDBY',
  access_strategy: 'DUAL_CUSTODY_BREAK_GLASS',
  health_quorum_probes: 3,
  dual_custody_approvers: ['sre-lead-fido2@0trust.dev', 'ciso-fido2@0trust.dev']
};

export function createResilienceSpan(params: {
  sessionId: string;
  traceparent: string;
  method: string;
  path: string;
  status: number;
  latencyMs?: number;
  origin?: 'cloudflare-edge' | 'browser-webcrypto-fallback';
  summary: Record<string, unknown>;
}): ObservabilitySpan {
  const parts = params.traceparent.split('-');
  const traceId = parts[1] || randomHex(16);
  const parentSpanId = parts[2] || '0000000000000000';
  const spanId = randomHex(8);

  return {
    id: `span_${randomHex(6)}`,
    traceparent: `00-${traceId}-${spanId}-01`,
    trace_id: traceId,
    span_id: spanId,
    parent_span_id: parentSpanId,
    session_id: params.sessionId,
    method: params.method,
    path: params.path,
    status: params.status,
    latency_ms: params.latencyMs ?? 4,
    timestamp: nowIso(),
    otlp_export: 'in-lab-only',
    redacted_auth_header: null,
    redaction_applied: false,
    execution_origin: params.origin ?? 'browser-webcrypto-fallback',
    response_summary: params.summary
  };
}

export function createInitialTabletopState(
  reason: 'INIT' | 'MANUAL_RESET' = 'INIT'
): ResilienceTabletopState {
  const correlation_id = generateCorrelationId();
  const traceparent = generateTraceparent();
  const ts = nowIso();
  const initialLockMode =
    DEFAULT_RECOVERY_CHOICES.backup_mode === 'R2_OBJECT_LOCK_COMPLIANCE'
      ? 'COMPLIANCE'
      : 'GOVERNANCE';

  return {
    correlation_id,
    traceparent,
    active_stage: 1,
    machine_state: 'STEADY_STATE',
    selected_scenario: 'PRIMARY_REGION_IDP_OUTAGE',
    blast_radius: {
      primary_db: 'HEALTHY',
      idp_control_plane: 'HEALTHY',
      app_edge: 'HEALTHY',
      r2_immutable_vault: 'HEALTHY',
      warm_standby_region: 'HEALTHY'
    },
    r2_snapshot: {
      snapshot_id: 'snap-r2-20261122-001',
      bucket: '0trust-prod-immutable-backups',
      object_key: 'db/primary/2026-11-22T02-00Z.tar.zst.enc',
      object_lock_mode: initialLockMode,
      retain_until_iso: plusDaysIso(30),
      sha256_digest: 'sha256:9f84c2a1e7d04b882c5f9b3a77d190e4b6c1a2f8d90e1c4b',
      size_gb: 482,
      last_verified_iso: ts,
      tamper_attempts_blocked: 0
    },
    warm_standby: {
      primary_region: 'us-east-1',
      standby_region: 'us-west-2',
      health_quorum_probes_failed: 0,
      quorum_threshold: 2,
      promoted: false,
      routing_target: 'primary',
      replication_lag_seconds: 14
    },
    break_glass: {
      invoked: false,
      status: 'INACTIVE',
      custodians: [...DEFAULT_RECOVERY_CHOICES.dual_custody_approvers],
      quorum_required: '2-of-2',
      max_ttl_minutes: 15,
      expires_at_iso: null,
      fido2_attestation_ids: [],
      webauthn_challenge: undefined,
      cosign_requested_at_iso: null
    },
    choices: {
      ...DEFAULT_RECOVERY_CHOICES,
      dual_custody_approvers: [...DEFAULT_RECOVERY_CHOICES.dual_custody_approvers]
    },
    last_r2_mutation_result: null,
    outcome: null,
    active_red_team: null,
    audit_log: [
      {
        event_id: makeEventId(),
        timestamp: ts,
        stage: 1,
        event_type: 'STATE_RESET',
        severity: 'INFO',
        title:
          reason === 'MANUAL_RESET'
            ? 'Tabletop reset to STEADY_STATE with vulnerable Stage 2 defaults'
            : 'Tabletop initialized in STEADY_STATE ($0 Guided Sandbox · Vulnerable Stage 2 Defaults)',
        correlation_id,
        traceparent,
        payload: {
          machine_state: 'STEADY_STATE',
          r2_object_lock_mode: initialLockMode,
          default_posture: 'VULNERABLE_TRAP_BASELINE'
        }
      }
    ]
  };
}

export function updateRecoveryChoices(
  state: ResilienceTabletopState,
  patch: Partial<RecoveryChoices>
): ResilienceTabletopState {
  const nextChoices: RecoveryChoices = {
    ...state.choices,
    ...patch
  };

  if (patch.access_strategy && !patch.dual_custody_approvers) {
    if (patch.access_strategy === 'SINGLE_ADMIN_BYPASS') {
      nextChoices.dual_custody_approvers = ['sre-lead-fido2@0trust.dev'];
    } else if (patch.access_strategy === 'WAIT_FOR_IDP') {
      nextChoices.dual_custody_approvers = [];
    } else if (patch.access_strategy === 'DUAL_CUSTODY_BREAK_GLASS') {
      const hasCiso = state.choices.dual_custody_approvers.includes('ciso-fido2@0trust.dev');
      nextChoices.dual_custody_approvers = hasCiso
        ? ['sre-lead-fido2@0trust.dev', 'ciso-fido2@0trust.dev']
        : ['sre-lead-fido2@0trust.dev'];
    }
  }

  const nextObjectLockMode =
    nextChoices.backup_mode === 'R2_OBJECT_LOCK_COMPLIANCE' ? 'COMPLIANCE' : 'GOVERNANCE';

  return {
    ...state,
    choices: nextChoices,
    r2_snapshot: {
      ...state.r2_snapshot,
      object_lock_mode: nextObjectLockMode
    }
  };
}

export function injectCrisisScenario(
  state: ResilienceTabletopState,
  scenarioId: CrisisScenarioId
): ResilienceTabletopState {
  const def = CRISIS_SCENARIOS[scenarioId];
  const ts = nowIso();
  const quorumFailures = scenarioId === 'PRIMARY_REGION_IDP_OUTAGE' ? 3 : 2;
  const currentLockMode =
    state.choices.backup_mode === 'R2_OBJECT_LOCK_COMPLIANCE' ? 'COMPLIANCE' : 'GOVERNANCE';

  const event: ResilienceAuditEvent = {
    event_id: makeEventId(),
    timestamp: ts,
    stage: 1,
    event_type: 'CRISIS_DECLARED',
    severity: 'CRITICAL',
    title: `Crisis Declared: ${def.title}`,
    correlation_id: state.correlation_id,
    traceparent: state.traceparent,
    payload: {
      scenario: scenarioId,
      severity: def.severity,
      idp_down: def.idpDown,
      blast_radius: def.initialBlastRadius,
      telemetry: def.telemetrySample
    }
  };

  return {
    ...state,
    active_stage: 1,
    machine_state: 'INCIDENT_DECLARED',
    selected_scenario: scenarioId,
    blast_radius: { ...def.initialBlastRadius },
    r2_snapshot: {
      ...state.r2_snapshot,
      object_lock_mode: currentLockMode
    },
    warm_standby: {
      ...state.warm_standby,
      health_quorum_probes_failed: quorumFailures,
      promoted: false,
      routing_target: 'primary'
    },
    break_glass: {
      invoked: false,
      status: 'INACTIVE',
      custodians: [...state.choices.dual_custody_approvers],
      quorum_required: '2-of-2',
      max_ttl_minutes: 15,
      expires_at_iso: null,
      fido2_attestation_ids: [],
      webauthn_challenge: undefined,
      cosign_requested_at_iso: null
    },
    last_r2_mutation_result: null,
    outcome: null,
    active_red_team: null,
    audit_log: [event, ...state.audit_log]
  };
}

export function attemptR2ObjectLockMutation(
  state: ResilienceTabletopState,
  action: R2MutationAction
): ResilienceTabletopState {
  const ts = nowIso();
  const lockMode =
    state.choices.backup_mode === 'R2_OBJECT_LOCK_COMPLIANCE' ? 'COMPLIANCE' : 'GOVERNANCE';
  const isComplianceLocked = lockMode === 'COMPLIANCE';

  if (isComplianceLocked) {
    const nextBlocked = state.r2_snapshot.tamper_attempts_blocked + 1;
    const event: ResilienceAuditEvent = {
      event_id: makeEventId(),
      timestamp: ts,
      stage: state.active_stage,
      event_type: 'R2_IMMUTABILITY_HELD',
      severity: 'SUCCESS',
      http_status: 403,
      error_code: 'ObjectLockComplianceViolation',
      title: `403 ObjectLockComplianceViolation — R2 ${action} blocked`,
      correlation_id: state.correlation_id,
      traceparent: state.traceparent,
      payload: {
        bucket: state.r2_snapshot.bucket,
        object_key: state.r2_snapshot.object_key,
        object_lock_mode: 'COMPLIANCE',
        retain_until_iso: state.r2_snapshot.retain_until_iso,
        attempted_action: action,
        tamper_attempts_blocked: nextBlocked,
        invariant: 'OBJECT_LOCK_IMMUTABLE'
      }
    };

    return {
      ...state,
      r2_snapshot: {
        ...state.r2_snapshot,
        object_lock_mode: 'COMPLIANCE',
        tamper_attempts_blocked: nextBlocked
      },
      last_r2_mutation_result: {
        attempted_action: action,
        http_status: 403,
        error_code: 'ObjectLockComplianceViolation',
        message: `Fail-closed: R2 Object Lock COMPLIANCE mode prevents ${action} until ${state.r2_snapshot.retain_until_iso} (even for root/admin credentials).`,
        timestamp: ts,
        storage: 'browser-fallback'
      },
      audit_log: [event, ...state.audit_log]
    };
  }

  // Unlocked or GOVERNANCE mode allows tampering -> RPO degraded to 1440m
  const riskEvent: ResilienceAuditEvent = {
    event_id: makeEventId(),
    timestamp: ts,
    stage: state.active_stage,
    event_type: 'R2_UNLOCKED_RISK',
    severity: 'CRITICAL',
    http_status: 200,
    title: `Backup Tamper Succeeded — ${lockMode} lock bypassed (RPO degraded to 1440m)`,
    correlation_id: state.correlation_id,
    traceparent: state.traceparent,
    payload: {
      object_lock_mode: lockMode,
      attempted_action: action,
      rpo_penalty_minutes: 1440
    }
  };

  return {
    ...state,
    blast_radius: {
      ...state.blast_radius,
      r2_immutable_vault: 'COMPROMISED'
    },
    r2_snapshot: {
      ...state.r2_snapshot,
      object_lock_mode: lockMode
    },
    last_r2_mutation_result: {
      attempted_action: action,
      http_status: 200,
      message: `WARNING: Backup snapshot mutated/deleted because R2 Object Lock was in ${lockMode} mode (not COMPLIANCE — RPO degraded to 1440m).`,
      timestamp: ts,
      storage: 'browser-fallback'
    },
    audit_log: [riskEvent, ...state.audit_log]
  };
}

/**
 * Calls POST /api/resilience/probe-delete on Cloudflare Edge with automatic
 * browser fallback in static `vite dev`. Always emits an ObservabilitySpan for XRayTelemetryDrawer.
 */
let resilienceEdgeApiAvailable: boolean | null = null;

export async function probeR2ObjectLockApi(
  state: ResilienceTabletopState,
  action: R2MutationAction,
  sessionId: string
): Promise<{ nextState: ResilienceTabletopState; span: ObservabilitySpan }> {
  const lockMode =
    state.choices.backup_mode === 'R2_OBJECT_LOCK_COMPLIANCE' ? 'COMPLIANCE' : 'GOVERNANCE';
  const startPerf = performance.now();

  if (typeof window !== 'undefined' && resilienceEdgeApiAvailable === null) {
    try {
      const probe = await fetch('/api/state', { method: 'GET' });
      const probeCt = probe.headers.get('Content-Type') || '';
      resilienceEdgeApiAvailable = probeCt.includes('application/json');
    } catch {
      resilienceEdgeApiAvailable = false;
    }
  }

  if (!(typeof window !== 'undefined' && resilienceEdgeApiAvailable === false)) {
    try {
      const res = await fetch('/api/resilience/probe-delete', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Session-Id': sessionId,
        traceparent: state.traceparent
      },
      body: JSON.stringify({
        sessionId,
        scenario: state.selected_scenario,
        attempted_action: action,
        object_lock_mode: lockMode,
        snapshot_id: state.r2_snapshot.snapshot_id,
        bucket: state.r2_snapshot.bucket,
        object_key: state.r2_snapshot.object_key,
        retain_until_iso: state.r2_snapshot.retain_until_iso
      })
    });

    const contentType = res.headers.get('Content-Type') || '';
    if (contentType.includes('application/json')) {
      const data = (await res.json()) as ProbeDeleteApiResponse & {
        _telemetry?: Partial<ObservabilitySpan>;
      };
      const latencyMs = Math.max(1, Math.round(performance.now() - startPerf));
      const ts = data.timestamp || nowIso();

      const isBlocked = data.http_status === 403 || data.status === 'R2_IMMUTABILITY_HELD';
      const nextBlocked =
        typeof data.tamper_attempts_blocked === 'number'
          ? data.tamper_attempts_blocked
          : isBlocked
            ? state.r2_snapshot.tamper_attempts_blocked + 1
            : state.r2_snapshot.tamper_attempts_blocked;

      const auditEvent: ResilienceAuditEvent = isBlocked
        ? {
            event_id: makeEventId(),
            timestamp: ts,
            stage: state.active_stage,
            event_type: 'R2_IMMUTABILITY_HELD',
            severity: 'SUCCESS',
            http_status: 403,
            error_code: data.error_code || 'ObjectLockComplianceViolation',
            title: `403 ObjectLockComplianceViolation — R2 ${action} blocked`,
            correlation_id: state.correlation_id,
            traceparent: state.traceparent,
            payload: {
              bucket: data.bucket,
              object_key: data.object_key,
              object_lock_mode: 'COMPLIANCE',
              retain_until_iso: data.retain_until_iso,
              attempted_action: action,
              tamper_attempts_blocked: nextBlocked,
              storage: data.storage || 'cloudflare-kv',
              kv_ttl_seconds: data.kv_ttl_seconds ?? 3600
            }
          }
        : {
            event_id: makeEventId(),
            timestamp: ts,
            stage: state.active_stage,
            event_type: 'R2_UNLOCKED_RISK',
            severity: 'CRITICAL',
            http_status: 200,
            title: `Backup Tamper Succeeded — ${lockMode} lock bypassed (RPO degraded to 1440m)`,
            correlation_id: state.correlation_id,
            traceparent: state.traceparent,
            payload: {
              object_lock_mode: lockMode,
              attempted_action: action,
              rpo_penalty_minutes: data.rpo_penalty_minutes ?? 1440,
              storage: data.storage || 'cloudflare-kv',
              kv_ttl_seconds: data.kv_ttl_seconds ?? 3600
            }
          };

      const nextState: ResilienceTabletopState = {
        ...state,
        blast_radius: {
          ...state.blast_radius,
          r2_immutable_vault: isBlocked ? 'HEALTHY' : 'COMPROMISED'
        },
        r2_snapshot: {
          ...state.r2_snapshot,
          object_lock_mode: lockMode,
          tamper_attempts_blocked: nextBlocked
        },
        last_r2_mutation_result: {
          attempted_action: action,
          http_status: data.http_status,
          error_code: data.error_code,
          message: data.message,
          timestamp: ts,
          storage: data.storage || 'cloudflare-kv'
        },
        audit_log: [auditEvent, ...state.audit_log]
      };

      const summaryCopy: Record<string, unknown> = { ...data };
      delete summaryCopy._telemetry;

      const span = createResilienceSpan({
        sessionId,
        traceparent: data._telemetry?.traceparent || state.traceparent,
        method: 'POST',
        path: '/api/resilience/probe-delete',
        status: res.status,
        latencyMs: data._telemetry?.latency_ms ?? latencyMs,
        origin: 'cloudflare-edge',
        summary: summaryCopy
      });

      return { nextState, span };
      }
    } catch {
      // Fall through to deterministic browser fallback in static vite dev
    }
  }

  const latencyMs = Math.max(1, Math.round(performance.now() - startPerf));
  const nextState = attemptR2ObjectLockMutation(state, action);
  const resInfo = nextState.last_r2_mutation_result!;
  const span = createResilienceSpan({
    sessionId,
    traceparent: nextState.traceparent,
    method: 'POST',
    path: '/api/resilience/probe-delete',
    status: resInfo.http_status,
    latencyMs,
    origin: 'browser-webcrypto-fallback',
    summary: {
      status: resInfo.http_status === 403 ? 'R2_IMMUTABILITY_HELD' : 'R2_UNLOCKED_RISK',
      http_status: resInfo.http_status,
      error_code: resInfo.error_code,
      attempted_action: resInfo.attempted_action,
      object_lock_mode: nextState.r2_snapshot.object_lock_mode,
      tamper_attempts_blocked: nextState.r2_snapshot.tamper_attempts_blocked,
      message: resInfo.message
    }
  });

  return { nextState, span };
}

/**
 * Seat 1 (SRE · Failover War Room): Signs 1-of-2 FIDO2 custody and dispatches
 * out-of-band co-signing challenge to Seat 2 (CISO · Out-of-Band FIDO2 Co-Signer).
 */
export function requestCisoBreakGlassCosign(
  state: ResilienceTabletopState
): ResilienceTabletopState {
  const ts = nowIso();
  const sreAttestation = `fido2-sre-${randomHex(3)}`;
  const challenge = `webauthn-chal-${randomHex(8)}`;

  const event: ResilienceAuditEvent = {
    event_id: makeEventId(),
    timestamp: ts,
    stage: 2,
    event_type: 'BREAK_GLASS_REQUESTED',
    severity: 'INFO',
    title: 'SRE Custodian (1/2) signed FIDO2 challenge — Awaiting CISO Out-of-Band Co-Sign (2/2)',
    correlation_id: state.correlation_id,
    traceparent: state.traceparent,
    payload: {
      requester: 'sre-lead-fido2@0trust.dev',
      sre_attestation_id: sreAttestation,
      webauthn_challenge: challenge,
      quorum_progress: '1-of-2',
      target_seat: 'ciso-cosigner'
    }
  };

  return {
    ...state,
    choices: {
      ...state.choices,
      access_strategy: 'DUAL_CUSTODY_BREAK_GLASS',
      dual_custody_approvers: ['sre-lead-fido2@0trust.dev']
    },
    break_glass: {
      invoked: false,
      status: 'PENDING_COSIGN',
      custodians: ['sre-lead-fido2@0trust.dev'],
      quorum_required: '2-of-2',
      max_ttl_minutes: 15,
      expires_at_iso: null,
      fido2_attestation_ids: [sreAttestation],
      webauthn_challenge: challenge,
      cosign_requested_at_iso: ts,
      error_code: undefined,
      error_detail: undefined
    },
    audit_log: [event, ...state.audit_log]
  };
}

/**
 * Seat 2 (CISO · Out-of-Band FIDO2 Co-Signer): Completes 2-of-2 hardware FIDO2
 * dual custody with a 15-minute max TTL, independent of upstream IdP 503 outage.
 */
export function coSignBreakGlassAsCiso(
  state: ResilienceTabletopState
): ResilienceTabletopState {
  const ts = nowIso();
  const existingSreAttest =
    state.break_glass.fido2_attestation_ids[0] || `fido2-sre-${randomHex(3)}`;
  const cisoAttest = `fido2-ciso-${randomHex(3)}`;
  const challenge = state.break_glass.webauthn_challenge || `webauthn-chal-${randomHex(8)}`;
  const custodians = ['sre-lead-fido2@0trust.dev', 'ciso-fido2@0trust.dev'];
  const expiresAtIso = plusMinutesIso(15);

  const event: ResilienceAuditEvent = {
    event_id: makeEventId(),
    timestamp: ts,
    stage: 2,
    event_type: 'BREAK_GLASS_INVOKED',
    severity: 'SUCCESS',
    http_status: 200,
    title: 'BREAK_GLASS_INVOKED — CISO co-signed 2-of-2 Hardware FIDO2 (15m max TTL)',
    correlation_id: state.correlation_id,
    traceparent: state.traceparent,
    payload: {
      custodians,
      quorum_verified: '2-of-2',
      fido2_attestation_ids: [existingSreAttest, cisoAttest],
      webauthn_challenge: challenge,
      max_ttl_minutes: 15,
      expires_at_iso: expiresAtIso
    }
  };

  return {
    ...state,
    choices: {
      ...state.choices,
      access_strategy: 'DUAL_CUSTODY_BREAK_GLASS',
      dual_custody_approvers: custodians
    },
    break_glass: {
      invoked: true,
      status: 'ACTIVE',
      custodians,
      quorum_required: '2-of-2',
      max_ttl_minutes: 15,
      expires_at_iso: expiresAtIso,
      fido2_attestation_ids: [existingSreAttest, cisoAttest],
      webauthn_challenge: challenge,
      cosign_requested_at_iso: state.break_glass.cosign_requested_at_iso || ts,
      error_code: undefined,
      error_detail: undefined
    },
    audit_log: [event, ...state.audit_log]
  };
}

/**
 * Pure deterministic RTO/RPO scoring model per Security Architect Contract.
 */
export function evaluateTabletopOutcome(
  scenario: CrisisScenarioId,
  choices: RecoveryChoices,
  context?: { correlation_id?: string; traceparent?: string }
): TabletopOutcome {
  const correlation_id = context?.correlation_id ?? generateCorrelationId();
  const traceparent = context?.traceparent ?? generateTraceparent();
  const scenarioDef = CRISIS_SCENARIOS[scenario];
  const ts = nowIso();

  const invariants_passed: string[] = [];
  const invariants_failed: string[] = [];
  const rto_breakdown: Array<{ label: string; minutes: number }> = [];
  const rpo_breakdown: Array<{ label: string; minutes: number }> = [];
  const audit_events: ResilienceAuditEvent[] = [];
  const timeline: PostIncidentTimelineEntry[] = [
    {
      t_plus_minutes: 0,
      phase: 'DETECTION',
      action: `Crisis triggered: ${scenarioDef.title}`,
      outcome: 'PASS',
      actor: 'cloudflare-health-quorum',
      evidence_ref: correlation_id
    }
  ];

  let score = 100;

  // 1. RPO Calculation: R2 Object Lock COMPLIANCE vs GOVERNANCE/Unlocked
  let rpo_minutes: number;
  if (choices.backup_mode === 'R2_OBJECT_LOCK_COMPLIANCE') {
    rpo_minutes = 5;
    rpo_breakdown.push({ label: 'R2 Object Lock (COMPLIANCE, 30d WORM)', minutes: 5 });
    invariants_passed.push('R2_OBJECT_LOCK_COMPLIANCE_VERIFIED');
    audit_events.push({
      event_id: makeEventId(),
      timestamp: ts,
      stage: 2,
      event_type: 'R2_IMMUTABILITY_HELD',
      severity: 'SUCCESS',
      http_status: 403,
      error_code: 'ObjectLockComplianceViolation',
      title: 'R2 Object Lock COMPLIANCE verified (RPO 5m)',
      correlation_id,
      traceparent,
      payload: { backup_mode: choices.backup_mode, rpo_minutes: 5 }
    });
    timeline.push({
      t_plus_minutes: 2,
      phase: 'CONTAINMENT',
      action: 'Verified immutable R2 COMPLIANCE snapshot (tamper attempts blocked 403)',
      outcome: 'PASS',
      actor: 'r2-object-lock',
      evidence_ref: '403 ObjectLockComplianceViolation'
    });
  } else {
    rpo_minutes = 1440;
    score -= 45;
    rpo_breakdown.push({ label: 'Unlocked / GOVERNANCE Backup Compromised', minutes: 1440 });
    invariants_failed.push('R2_IMMUTABILITY_MISSING_OR_BYPASSED');
    audit_events.push({
      event_id: makeEventId(),
      timestamp: ts,
      stage: 2,
      event_type: 'R2_UNLOCKED_RISK',
      severity: 'CRITICAL',
      title: 'Backup integrity compromised (GOVERNANCE/unlocked RPO = 1440m)',
      correlation_id,
      traceparent,
      payload: { backup_mode: choices.backup_mode, rpo_minutes: 1440 }
    });
    timeline.push({
      t_plus_minutes: 2,
      phase: 'CONTAINMENT',
      action: 'Attempted restore from non-COMPLIANCE backup (stale/tampered)',
      outcome: 'PENALTY',
      actor: 'backup-engine',
      evidence_ref: 'R2_UNLOCKED_RISK'
    });
  }

  // 2. RTO Calculation: Failover Strategy + Health Quorum
  let rto_minutes = 0;
  const quorumMet = choices.health_quorum_probes >= 2;

  if (choices.failover_strategy === 'WARM_STANDBY') {
    if (quorumMet) {
      rto_minutes += 12;
      rto_breakdown.push({ label: 'Warm-Standby Region Promotion (us-west-2)', minutes: 12 });
      invariants_passed.push('WARM_STANDBY_QUORUM_PROMOTED');
      audit_events.push({
        event_id: makeEventId(),
        timestamp: ts,
        stage: 2,
        event_type: 'FAILOVER_QUORUM_VERIFIED',
        severity: 'SUCCESS',
        title: `Warm-Standby promoted after ${choices.health_quorum_probes} failed health probes`,
        correlation_id,
        traceparent,
        payload: { quorum_probes: choices.health_quorum_probes, rto_component_min: 12 }
      });
      timeline.push({
        t_plus_minutes: 6,
        phase: 'RECOVERY',
        action: `Promoted Warm-Standby us-west-2 (quorum=${choices.health_quorum_probes}>=2)`,
        outcome: 'PASS',
        actor: 'cloudflare-load-balancer',
        evidence_ref: 'FAILOVER_QUORUM_VERIFIED'
      });
    } else {
      rto_minutes += 45;
      score -= 15;
      rto_breakdown.push({ label: 'Warm-Standby Delayed (Quorum < 2 probes)', minutes: 45 });
      invariants_failed.push('HEALTH_QUORUM_INSUFFICIENT');
      timeline.push({
        t_plus_minutes: 15,
        phase: 'RECOVERY',
        action: 'Warm-Standby promotion delayed: health quorum < 2 consecutive probes',
        outcome: 'PENALTY',
        actor: 'cloudflare-load-balancer',
        evidence_ref: 'HEALTH_QUORUM_INSUFFICIENT'
      });
    }
  } else {
    rto_minutes += 240;
    score -= 30;
    rto_breakdown.push({ label: 'Cold Rebuild from Scratch', minutes: 240 });
    invariants_failed.push('WARM_STANDBY_NOT_USED');
    audit_events.push({
      event_id: makeEventId(),
      timestamp: ts,
      stage: 2,
      event_type: 'FAILOVER_COLD_REBUILD',
      severity: 'WARN',
      title: 'Cold Rebuild selected (+240m RTO penalty)',
      correlation_id,
      traceparent,
      payload: { failover_strategy: 'COLD_REBUILD', rto_component_min: 240 }
    });
    timeline.push({
      t_plus_minutes: 20,
      phase: 'RECOVERY',
      action: 'Executing Cold Rebuild instead of Warm-Standby (+240m RTO)',
      outcome: 'PENALTY',
      actor: 'infra-recovery',
      evidence_ref: 'FAILOVER_COLD_REBUILD'
    });
  }

  // 3. Access / Break-Glass Strategy (Enforces 2-of-2 FIDO2 Out-of-Band CISO Co-Sign)
  const hasDualCustody =
    choices.access_strategy === 'DUAL_CUSTODY_BREAK_GLASS' &&
    choices.dual_custody_approvers.length >= 2;
  const isMissingCisoCosign =
    choices.access_strategy === 'DUAL_CUSTODY_BREAK_GLASS' &&
    choices.dual_custody_approvers.length < 2;

  if (hasDualCustody) {
    rto_minutes += 8;
    rto_breakdown.push({
      label: 'Dual-Custody Break-Glass (2-of-2 FIDO2, 15m TTL)',
      minutes: 8
    });
    invariants_passed.push('DUAL_CUSTODY_BREAK_GLASS_2_OF_2');
    audit_events.push({
      event_id: makeEventId(),
      timestamp: ts,
      stage: 2,
      event_type: 'BREAK_GLASS_INVOKED',
      severity: 'SUCCESS',
      title: 'BREAK_GLASS_INVOKED — 2-of-2 FIDO2 dual-custody granted (15m TTL)',
      correlation_id,
      traceparent,
      payload: {
        custodians: choices.dual_custody_approvers.slice(0, 2),
        ttl_minutes: 15
      }
    });
    timeline.push({
      t_plus_minutes: 4,
      phase: 'CONTAINMENT',
      action: 'Dual-custody 2-of-2 FIDO2 Break-Glass invoked (15m max TTL)',
      outcome: 'PASS',
      actor: choices.dual_custody_approvers.slice(0, 2).join(' + '),
      evidence_ref: 'BREAK_GLASS_INVOKED'
    });
  } else if (choices.access_strategy === 'SINGLE_ADMIN_BYPASS' || isMissingCisoCosign) {
    const penalty = scenarioDef.idpDown ? 180 : 45;
    rto_minutes += penalty;
    score -= 25;
    rto_breakdown.push({
      label: isMissingCisoCosign
        ? '1-of-2 FIDO2 Only (Missing CISO Co-Sign -> 403 BREAK_GLASS_QUORUM_REQUIRED)'
        : 'Single-Admin Bypass DENIED (403 BREAK_GLASS_QUORUM_REQUIRED)',
      minutes: penalty
    });
    invariants_failed.push('BREAK_GLASS_QUORUM_REQUIRED');
    audit_events.push({
      event_id: makeEventId(),
      timestamp: ts,
      stage: 2,
      event_type: 'BREAK_GLASS_DENIED',
      severity: 'CRITICAL',
      http_status: 403,
      error_code: 'BREAK_GLASS_QUORUM_REQUIRED',
      title: isMissingCisoCosign
        ? '403 BREAK_GLASS_QUORUM_REQUIRED — 1-of-2 SRE signature insufficient without CISO FIDO2 co-sign'
        : '403 BREAK_GLASS_QUORUM_REQUIRED — Single-admin bypass denied',
      correlation_id,
      traceparent,
      payload: {
        attempted_strategy: choices.access_strategy,
        custodians_present: choices.dual_custody_approvers,
        quorum_required: '2-of-2',
        rto_penalty_min: penalty
      }
    });
    timeline.push({
      t_plus_minutes: 4,
      phase: 'CONTAINMENT',
      action: isMissingCisoCosign
        ? 'Break-glass DENIED: 1-of-2 FIDO2 signature present; CISO out-of-band co-signature required (403 BREAK_GLASS_QUORUM_REQUIRED)'
        : 'Single-admin break-glass DENIED (403 BREAK_GLASS_QUORUM_REQUIRED)',
      outcome: 'BLOCKED',
      actor: 'break-glass-gate',
      evidence_ref: '403 BREAK_GLASS_QUORUM_REQUIRED'
    });
  } else {
    // WAIT_FOR_IDP
    const penalty = scenarioDef.idpDown ? 180 : 15;
    rto_minutes += penalty;
    if (scenarioDef.idpDown) {
      score -= 25;
      invariants_failed.push('IDP_UNREACHABLE_LOCKOUT');
    }
    rto_breakdown.push({
      label: scenarioDef.idpDown ? 'Blocked Waiting for IdP 503 Recovery' : 'Standard IdP SSO Auth',
      minutes: penalty
    });
    timeline.push({
      t_plus_minutes: 4,
      phase: 'CONTAINMENT',
      action: scenarioDef.idpDown
        ? 'Admin locked out waiting for IdP 503 recovery (+180m RTO)'
        : 'Authenticated via primary IdP SSO',
      outcome: scenarioDef.idpDown ? 'PENALTY' : 'PASS',
      actor: 'idp-control-plane',
      evidence_ref: scenarioDef.idpDown ? 'IDP_UNREACHABLE_LOCKOUT' : 'IDP_SSO_OK'
    });
  }

  const resilience_score = Math.max(0, Math.min(100, score));

  let sla_tier: SlaTier = 'BREACH';
  if (
    rto_minutes <= SLA_TARGETS.PLATINUM_MAX_RTO_MIN &&
    rpo_minutes <= SLA_TARGETS.PLATINUM_MAX_RPO_MIN &&
    resilience_score >= SLA_TARGETS.PLATINUM_MIN_SCORE
  ) {
    sla_tier = 'PLATINUM';
  } else if (
    rto_minutes <= SLA_TARGETS.GOLD_MAX_RTO_MIN &&
    rpo_minutes <= SLA_TARGETS.GOLD_MAX_RPO_MIN &&
    resilience_score >= SLA_TARGETS.GOLD_MIN_SCORE
  ) {
    sla_tier = 'GOLD';
  }

  const sla_met = sla_tier !== 'BREACH';

  audit_events.push({
    event_id: makeEventId(),
    timestamp: ts,
    stage: 3,
    event_type: sla_met ? 'RECOVERY_SLA_VERIFIED' : 'RECOVERY_SLA_BREACHED',
    severity: sla_met ? 'SUCCESS' : 'CRITICAL',
    title: sla_met
      ? `SLA ${sla_tier} Verified — RTO ${rto_minutes}m / RPO ${rpo_minutes}m (Score ${resilience_score})`
      : `SLA BREACHED — RTO ${rto_minutes}m / RPO ${rpo_minutes}m (Score ${resilience_score})`,
    correlation_id,
    traceparent,
    payload: {
      sla_tier,
      rto_minutes,
      rpo_minutes,
      resilience_score,
      invariants_passed,
      invariants_failed
    }
  });

  timeline.push({
    t_plus_minutes: rto_minutes,
    phase: 'VERIFICATION',
    action: sla_met
      ? `Service restored under ${sla_tier} SLA (RTO ${rto_minutes}m, RPO ${rpo_minutes}m)`
      : `Recovery completed with SLA BREACH (RTO ${rto_minutes}m, RPO ${rpo_minutes}m)`,
    outcome: sla_met ? 'PASS' : 'PENALTY',
    actor: 'resilience-scorecard',
    evidence_ref: sla_met ? `SLA_${sla_tier}` : 'RECOVERY_SLA_BREACHED'
  });

  // Sort strictly by ascending t_plus_minutes so T+0m -> T+2m -> T+4m -> T+6m -> T+20m is guaranteed chronological
  timeline.sort((a, b) => a.t_plus_minutes - b.t_plus_minutes);

  return {
    scenario,
    rto_minutes,
    rpo_minutes,
    resilience_score,
    sla_tier,
    sla_met,
    invariants_passed,
    invariants_failed,
    rto_breakdown,
    rpo_breakdown,
    post_incident_timeline: timeline,
    audit_events
  };
}

export function executeContainmentAndRecovery(
  state: ResilienceTabletopState,
  choices: RecoveryChoices
): ResilienceTabletopState {
  const ts = nowIso();
  const baseState =
    state.machine_state === 'STEADY_STATE'
      ? injectCrisisScenario(state, state.selected_scenario)
      : state;

  const outcome = evaluateTabletopOutcome(baseState.selected_scenario, choices, {
    correlation_id: baseState.correlation_id,
    traceparent: baseState.traceparent
  });

  const nextBlastRadius: Record<InfrastructureTierId, TierHealth> = {
    ...baseState.blast_radius,
    r2_immutable_vault:
      choices.backup_mode === 'R2_OBJECT_LOCK_COMPLIANCE' ? 'HEALTHY' : 'COMPROMISED',
    warm_standby_region:
      choices.failover_strategy === 'WARM_STANDBY' && choices.health_quorum_probes >= 2
        ? 'FAILOVER_ACTIVE'
        : 'DEGRADED',
    app_edge:
      choices.failover_strategy === 'WARM_STANDBY' && choices.health_quorum_probes >= 2
        ? 'FAILOVER_ACTIVE'
        : baseState.blast_radius.app_edge
  };

  const isDualCustody =
    choices.access_strategy === 'DUAL_CUSTODY_BREAK_GLASS' &&
    choices.dual_custody_approvers.length >= 2;
  const isMissingCisoCosign =
    choices.access_strategy === 'DUAL_CUSTODY_BREAK_GLASS' &&
    choices.dual_custody_approvers.length < 2;
  const isSingleDenied = choices.access_strategy === 'SINGLE_ADMIN_BYPASS' || isMissingCisoCosign;

  const stage2Events = outcome.audit_events.filter((e) => e.stage === 2);

  return {
    ...baseState,
    active_stage: 2,
    machine_state: 'RECOVERY_EXECUTING',
    choices,
    blast_radius: nextBlastRadius,
    r2_snapshot: {
      ...baseState.r2_snapshot,
      object_lock_mode:
        choices.backup_mode === 'R2_OBJECT_LOCK_COMPLIANCE' ? 'COMPLIANCE' : 'GOVERNANCE'
    },
    warm_standby: {
      ...baseState.warm_standby,
      health_quorum_probes_failed: choices.health_quorum_probes,
      promoted: choices.failover_strategy === 'WARM_STANDBY' && choices.health_quorum_probes >= 2,
      routing_target:
        choices.failover_strategy === 'WARM_STANDBY' && choices.health_quorum_probes >= 2
          ? 'warm-standby'
          : 'cold-rebuild-pending'
    },
    break_glass: isDualCustody
      ? {
          invoked: true,
          status: 'ACTIVE',
          custodians: choices.dual_custody_approvers.slice(0, 2),
          quorum_required: '2-of-2',
          max_ttl_minutes: 15,
          expires_at_iso: baseState.break_glass.expires_at_iso || plusMinutesIso(15),
          fido2_attestation_ids:
            baseState.break_glass.fido2_attestation_ids.length >= 2
              ? baseState.break_glass.fido2_attestation_ids
              : [`fido2-sre-${randomHex(3)}`, `fido2-ciso-${randomHex(3)}`],
          webauthn_challenge: baseState.break_glass.webauthn_challenge
        }
      : isSingleDenied
        ? {
            invoked: false,
            status: 'DENIED',
            custodians:
              choices.dual_custody_approvers.length > 0
                ? choices.dual_custody_approvers
                : ['single-admin@0trust.dev'],
            quorum_required: '2-of-2',
            max_ttl_minutes: 15,
            expires_at_iso: null,
            fido2_attestation_ids: baseState.break_glass.fido2_attestation_ids,
            webauthn_challenge: baseState.break_glass.webauthn_challenge,
            cosign_requested_at_iso: baseState.break_glass.cosign_requested_at_iso,
            error_code: '403 BREAK_GLASS_QUORUM_REQUIRED',
            error_detail: isMissingCisoCosign
              ? '1-of-2 FIDO2 signature present; CISO out-of-band co-signature required for 2-of-2 quorum.'
              : `Single-actor bypass denied at ${ts}. 2-of-2 hardware FIDO2 custody required.`
          }
        : {
            invoked: false,
            status: 'INACTIVE',
            custodians: [],
            quorum_required: '2-of-2',
            max_ttl_minutes: 15,
            expires_at_iso: null,
            fido2_attestation_ids: []
          },
    outcome,
    audit_log: [...stage2Events, ...baseState.audit_log]
  };
}

export function finalizeTabletopScorecard(
  state: ResilienceTabletopState
): ResilienceTabletopState {
  const prepared =
    state.outcome === null ? executeContainmentAndRecovery(state, state.choices) : state;
  const outcome = evaluateTabletopOutcome(prepared.selected_scenario, prepared.choices, {
    correlation_id: prepared.correlation_id,
    traceparent: prepared.traceparent
  });
  const stage3Events = outcome.audit_events.filter((e) => e.stage === 3);

  return {
    ...prepared,
    active_stage: 3,
    machine_state: outcome.sla_met ? 'VERIFIED_RECOVERED' : 'SLA_BREACHED',
    outcome,
    audit_log: [...stage3Events, ...prepared.audit_log]
  };
}

export function runRedTeamScenario(
  state: ResilienceTabletopState,
  redTeamId: RedTeamScenarioId
): ResilienceTabletopState {
  if (redTeamId === '9A') {
    // 9A: Ransomware overwrite/delete attempt on R2 Object Lock COMPLIANCE
    const withComplianceChoice = updateRecoveryChoices(state, {
      backup_mode: 'R2_OBJECT_LOCK_COMPLIANCE'
    });
    const s1 = injectCrisisScenario(withComplianceChoice, 'RANSOMWARE_PRIMARY_DB');
    const s2 = attemptR2ObjectLockMutation(s1, 'DELETE');
    return {
      ...s2,
      active_stage: 2,
      machine_state: 'CONTAINMENT_ACTIVE',
      active_red_team: '9A'
    };
  }

  if (redTeamId === '9B') {
    // 9B: IdP-down + Single-admin break-glass bypass attempt -> 403 BREAK_GLASS_QUORUM_REQUIRED + RTO penalty
    const s1 = injectCrisisScenario(state, 'PRIMARY_REGION_IDP_OUTAGE');
    const choices: RecoveryChoices = {
      backup_mode: 'R2_OBJECT_LOCK_COMPLIANCE',
      failover_strategy: 'WARM_STANDBY',
      access_strategy: 'SINGLE_ADMIN_BYPASS',
      health_quorum_probes: 3,
      dual_custody_approvers: ['single-admin@0trust.dev']
    };
    const s2 = executeContainmentAndRecovery(s1, choices);
    const s3 = finalizeTabletopScorecard(s2);
    return {
      ...s3,
      active_stage: 2,
      active_red_team: '9B'
    };
  }

  // 9C: IdP outage + Cold Rebuild + Unlocked/Governance backup -> SLA_BREACHED
  const s1 = injectCrisisScenario(state, 'PRIMARY_REGION_IDP_OUTAGE');
  const choices: RecoveryChoices = {
    backup_mode: 'R2_GOVERNANCE_OR_UNLOCKED',
    failover_strategy: 'COLD_REBUILD',
    access_strategy: 'WAIT_FOR_IDP',
    health_quorum_probes: 1,
    dual_custody_approvers: []
  };
  const s2 = executeContainmentAndRecovery(s1, choices);
  const s3 = finalizeTabletopScorecard(s2);
  return {
    ...s3,
    active_stage: 3,
    active_red_team: '9C'
  };
}

export function setActiveStage(
  state: ResilienceTabletopState,
  stage: TabletopStage
): ResilienceTabletopState {
  return { ...state, active_stage: stage };
}

export function exportPostIncidentReport(state: ResilienceTabletopState): string {
  const report = {
    report_type: '0trust.dev-lab9-post-incident-timeline',
    generated_at: nowIso(),
    correlation_id: state.correlation_id,
    traceparent: state.traceparent,
    machine_state: state.machine_state,
    scenario: state.selected_scenario,
    r2_object_lock: {
      snapshot_id: state.r2_snapshot.snapshot_id,
      object_lock_mode: state.r2_snapshot.object_lock_mode,
      retain_until_iso: state.r2_snapshot.retain_until_iso,
      tamper_attempts_blocked: state.r2_snapshot.tamper_attempts_blocked
    },
    outcome: state.outcome,
    audit_log: state.audit_log
  };
  return JSON.stringify(report, null, 2);
}
