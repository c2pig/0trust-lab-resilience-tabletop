export type CrisisScenarioId =
  | 'RANSOMWARE_PRIMARY_DB'
  | 'PRIMARY_REGION_IDP_OUTAGE'
  | 'INSIDER_BACKUP_TAMPER';

export type ResilienceSeatId = 'sre-war-room' | 'ciso-cosigner';

export type TabletopMachineState =
  | 'STEADY_STATE'
  | 'INCIDENT_DECLARED'
  | 'CONTAINMENT_ACTIVE'
  | 'RECOVERY_EXECUTING'
  | 'VERIFIED_RECOVERED'
  | 'SLA_BREACHED';

export type TabletopStage = 1 | 2 | 3;

export type GateStatus = 'WAITING' | 'CHECKING' | 'PASS' | 'BLOCK' | 'WARN';

export type TierHealth = 'HEALTHY' | 'DEGRADED' | 'COMPROMISED' | 'FAILOVER_ACTIVE';

export type InfrastructureTierId =
  | 'primary_db'
  | 'idp_control_plane'
  | 'app_edge'
  | 'r2_immutable_vault'
  | 'warm_standby_region';

export type BackupLockChoice = 'R2_OBJECT_LOCK_COMPLIANCE' | 'R2_GOVERNANCE_OR_UNLOCKED';

export type FailoverStrategyChoice = 'WARM_STANDBY' | 'COLD_REBUILD';

export type AccessStrategyChoice =
  | 'DUAL_CUSTODY_BREAK_GLASS'
  | 'SINGLE_ADMIN_BYPASS'
  | 'WAIT_FOR_IDP';

export type SlaTier = 'PLATINUM' | 'GOLD' | 'BREACH';

export type RedTeamScenarioId = '9A' | '9B' | '9C';

export type R2MutationAction = 'DELETE' | 'BYPASS_GOVERNANCE' | 'SHORTEN_RETENTION';

export interface ProbeDeleteApiResponse {
  status: 'R2_IMMUTABILITY_HELD' | 'R2_UNLOCKED_RISK';
  http_status: number;
  error_code?: string;
  attempted_action: R2MutationAction;
  object_lock_mode: 'COMPLIANCE' | 'GOVERNANCE' | 'NONE';
  snapshot_id?: string;
  bucket: string;
  object_key: string;
  retain_until_iso: string;
  tamper_attempts_blocked: number;
  rpo_penalty_minutes?: number;
  invariant?: string;
  storage?: string;
  kv_ttl_seconds?: number;
  timestamp: string;
  message: string;
}

export interface CrisisScenarioDefinition {
  id: CrisisScenarioId;
  title: string;
  shortLabel: string;
  severity: 'CRITICAL' | 'HIGH';
  summary: string;
  attackVector: string;
  idpDown: boolean;
  initialBlastRadius: Record<InfrastructureTierId, TierHealth>;
  telemetrySample: Record<string, unknown>;
}

export interface R2ObjectLockSnapshot {
  snapshot_id: string;
  bucket: string;
  object_key: string;
  object_lock_mode: 'COMPLIANCE' | 'GOVERNANCE' | 'NONE';
  retain_until_iso: string;
  sha256_digest: string;
  size_gb: number;
  last_verified_iso: string;
  tamper_attempts_blocked: number;
}

export interface WarmStandbyStatus {
  primary_region: string;
  standby_region: string;
  health_quorum_probes_failed: number;
  quorum_threshold: number;
  promoted: boolean;
  routing_target: 'primary' | 'warm-standby' | 'cold-rebuild-pending';
  replication_lag_seconds: number;
}

export interface BreakGlassSession {
  invoked: boolean;
  status: 'INACTIVE' | 'PENDING_COSIGN' | 'ACTIVE' | 'DENIED';
  custodians: string[];
  quorum_required: '2-of-2';
  max_ttl_minutes: 15;
  expires_at_iso: string | null;
  fido2_attestation_ids: string[];
  webauthn_challenge?: string;
  cosign_requested_at_iso?: string | null;
  error_code?: '403 BREAK_GLASS_QUORUM_REQUIRED';
  error_detail?: string;
}

export interface RecoveryChoices {
  backup_mode: BackupLockChoice;
  failover_strategy: FailoverStrategyChoice;
  access_strategy: AccessStrategyChoice;
  health_quorum_probes: number;
  dual_custody_approvers: string[];
}

export interface ResilienceAuditEvent {
  event_id: string;
  timestamp: string;
  stage: TabletopStage;
  event_type:
    | 'CRISIS_DECLARED'
    | 'R2_IMMUTABILITY_HELD'
    | 'R2_UNLOCKED_RISK'
    | 'FAILOVER_QUORUM_VERIFIED'
    | 'FAILOVER_COLD_REBUILD'
    | 'BREAK_GLASS_REQUESTED'
    | 'BREAK_GLASS_INVOKED'
    | 'BREAK_GLASS_DENIED'
    | 'RECOVERY_SLA_VERIFIED'
    | 'RECOVERY_SLA_BREACHED'
    | 'STATE_RESET';
  severity: 'INFO' | 'SUCCESS' | 'WARN' | 'CRITICAL';
  http_status?: number;
  error_code?: string;
  title: string;
  correlation_id: string;
  traceparent: string;
  payload: Record<string, unknown>;
}

export interface PostIncidentTimelineEntry {
  t_plus_minutes: number;
  phase: 'DETECTION' | 'CONTAINMENT' | 'RECOVERY' | 'VERIFICATION';
  action: string;
  outcome: 'PASS' | 'BLOCKED' | 'PENALTY';
  actor: string;
  evidence_ref: string;
}

export interface TabletopOutcome {
  scenario: CrisisScenarioId;
  rto_minutes: number;
  rpo_minutes: number;
  resilience_score: number;
  sla_tier: SlaTier;
  sla_met: boolean;
  invariants_passed: string[];
  invariants_failed: string[];
  rto_breakdown: Array<{ label: string; minutes: number }>;
  rpo_breakdown: Array<{ label: string; minutes: number }>;
  post_incident_timeline: PostIncidentTimelineEntry[];
  audit_events: ResilienceAuditEvent[];
}

export interface ResilienceTabletopState {
  correlation_id: string;
  traceparent: string;
  active_stage: TabletopStage;
  machine_state: TabletopMachineState;
  selected_scenario: CrisisScenarioId;
  blast_radius: Record<InfrastructureTierId, TierHealth>;
  r2_snapshot: R2ObjectLockSnapshot;
  warm_standby: WarmStandbyStatus;
  break_glass: BreakGlassSession;
  choices: RecoveryChoices;
  last_r2_mutation_result: {
    attempted_action: R2MutationAction;
    http_status: number;
    error_code?: string;
    message: string;
    timestamp: string;
    storage?: string;
  } | null;
  outcome: TabletopOutcome | null;
  active_red_team: RedTeamScenarioId | null;
  audit_log: ResilienceAuditEvent[];
}

export const SLA_TARGETS = {
  PLATINUM_MAX_RTO_MIN: 30,
  PLATINUM_MAX_RPO_MIN: 15,
  PLATINUM_MIN_SCORE: 85,
  GOLD_MAX_RTO_MIN: 60,
  GOLD_MAX_RPO_MIN: 60,
  GOLD_MIN_SCORE: 65
} as const;

export const CRISIS_SCENARIOS: Record<CrisisScenarioId, CrisisScenarioDefinition> = {
  RANSOMWARE_PRIMARY_DB: {
    id: 'RANSOMWARE_PRIMARY_DB',
    title: 'Ransomware Encrypts Primary DB',
    shortLabel: 'Ransomware Primary DB',
    severity: 'CRITICAL',
    summary:
      'File-encrypting ransomware compromises the primary transactional database and fires automated DELETE + retention-shortening calls against backup storage.',
    attackVector: 'Lateral movement via compromised CI runner -> Primary DB encryption + S3/R2 DeleteObject',
    idpDown: false,
    initialBlastRadius: {
      primary_db: 'COMPROMISED',
      idp_control_plane: 'HEALTHY',
      app_edge: 'DEGRADED',
      r2_immutable_vault: 'HEALTHY',
      warm_standby_region: 'HEALTHY'
    },
    telemetrySample: {
      alert_source: 'cloudflare-edr-sensor',
      encrypted_tablespaces: ['erp_orders', 'ledger_entries', 'customer_vault'],
      ransom_note_detected: true,
      backup_delete_attempts: 14
    }
  },
  PRIMARY_REGION_IDP_OUTAGE: {
    id: 'PRIMARY_REGION_IDP_OUTAGE',
    title: 'Primary Cloud Region & IdP Outage (503)',
    shortLabel: 'Region + IdP Outage (503)',
    severity: 'CRITICAL',
    summary:
      'Primary cloud region experiences a control-plane blackout while Okta/Entra IdP returns HTTP 503, locking out standard SSO administrative consoles.',
    attackVector: 'Regional BGP/control-plane outage + Upstream IdP 503 Service Unavailable',
    idpDown: true,
    initialBlastRadius: {
      primary_db: 'DEGRADED',
      idp_control_plane: 'COMPROMISED',
      app_edge: 'COMPROMISED',
      r2_immutable_vault: 'HEALTHY',
      warm_standby_region: 'HEALTHY'
    },
    telemetrySample: {
      alert_source: 'cloudflare-health-quorum',
      primary_region: 'us-east-1',
      idp_http_status: 503,
      consecutive_failed_probes: 3
    }
  },
  INSIDER_BACKUP_TAMPER: {
    id: 'INSIDER_BACKUP_TAMPER',
    title: 'Insider Compromised Admin Backup Tamper',
    shortLabel: 'Insider Backup Tamper',
    severity: 'HIGH',
    summary:
      'A hijacked privileged admin token attempts to invoke BypassGovernance and delete R2 snapshots prior to exfiltrating production records.',
    attackVector: 'Stolen Admin Session Token -> R2 DeleteObject + PutObjectRetention(BypassGovernance)',
    idpDown: false,
    initialBlastRadius: {
      primary_db: 'DEGRADED',
      idp_control_plane: 'DEGRADED',
      app_edge: 'HEALTHY',
      r2_immutable_vault: 'HEALTHY',
      warm_standby_region: 'HEALTHY'
    },
    telemetrySample: {
      alert_source: 'r2-audit-pipeline',
      actor_principal: 'compromised-platform-admin@0trust.dev',
      api_calls: ['DeleteObject', 'PutObjectRetention(BypassGovernance=true)'],
      ip_anomaly_score: 96
    }
  }
};
