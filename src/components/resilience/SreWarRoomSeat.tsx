import React from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  KeyRound,
  Lock,
  ShieldAlert,
  ShieldCheck
} from 'lucide-react';
import {
  AccessStrategyChoice,
  BackupLockChoice,
  CRISIS_SCENARIOS,
  CrisisScenarioDefinition,
  CrisisScenarioId,
  FailoverStrategyChoice,
  GateStatus,
  InfrastructureTierId,
  R2MutationAction,
  RecoveryChoices,
  RedTeamScenarioId,
  ResilienceSeatId,
  ResilienceTabletopState,
  TabletopStage,
  TierHealth
} from '../../contracts/resilienceContract';

const TIER_LABELS: Record<InfrastructureTierId, { name: string; subtitle: string }> = {
  primary_db: { name: 'Primary Database', subtitle: 'us-east-1 · Transactional Ledger' },
  idp_control_plane: { name: 'Okta / Entra IdP', subtitle: 'Workforce SSO Control Plane' },
  app_edge: { name: 'Cloudflare App Edge', subtitle: 'Workers + Zero Trust Gateway' },
  r2_immutable_vault: { name: 'Cloudflare R2 Vault', subtitle: 'Object Lock WORM Backup' },
  warm_standby_region: { name: 'Warm-Standby Region', subtitle: 'us-west-2 · Hot Replica' }
};

function getTierBadge(health: TierHealth) {
  switch (health) {
    case 'HEALTHY':
      return <span className="badge badge-emerald">HEALTHY</span>;
    case 'FAILOVER_ACTIVE':
      return <span className="badge badge-blue">FAILOVER ACTIVE</span>;
    case 'DEGRADED':
      return <span className="badge badge-amber">DEGRADED</span>;
    case 'COMPROMISED':
      return <span className="badge badge-crimson">COMPROMISED</span>;
  }
}

function getGateCardClass(status: GateStatus): string {
  switch (status) {
    case 'CHECKING':
      return 'gate-card running';
    case 'PASS':
      return 'gate-card passed';
    case 'BLOCK':
      return 'gate-card blocked';
    case 'WARN':
      return 'gate-card warning';
    default:
      return 'gate-card';
  }
}

function getGateBadge(status: GateStatus) {
  switch (status) {
    case 'CHECKING':
      return <span className="badge badge-blue">CHECKING</span>;
    case 'PASS':
      return <span className="badge badge-emerald">PASS · HARDENED</span>;
    case 'BLOCK':
      return <span className="badge badge-crimson">BLOCK · TRAP</span>;
    case 'WARN':
      return <span className="badge badge-amber">WARN · PENALTY</span>;
    default:
      return <span className="badge">WAITING</span>;
  }
}

export interface SreWarRoomSeatProps {
  state: ResilienceTabletopState;
  scenarioDef: CrisisScenarioDefinition;
  animatingGate: number;
  stage1Done: boolean;
  probeAction: R2MutationAction;
  probingR2: boolean;
  hasDualCustody2of2: boolean;
  getStage2GateStatus: (gate: 1 | 2 | 3) => GateStatus;
  onSetProbeAction: (action: R2MutationAction) => void;
  onInjectCrisis: (scenarioId: CrisisScenarioId) => void;
  onSelectStage: (stage: TabletopStage) => void;
  onHardenAllStage2: () => void;
  onUpdateChoices: (patch: Partial<RecoveryChoices>) => void;
  onProbeR2: (overrideAction?: R2MutationAction) => Promise<void>;
  onRequestCisoCosign: () => void;
  onSelectSeat: (seat: ResilienceSeatId) => void;
  onExecuteRecovery: () => void;
  onFinalizeScorecard: () => void;
  onRunRedTeam: (redTeamId: RedTeamScenarioId) => Promise<void>;
}

export function SreWarRoomSeat({
  state,
  scenarioDef,
  animatingGate,
  stage1Done,
  probeAction,
  probingR2,
  hasDualCustody2of2,
  getStage2GateStatus,
  onSetProbeAction,
  onInjectCrisis,
  onSelectStage,
  onHardenAllStage2,
  onUpdateChoices,
  onProbeR2,
  onRequestCisoCosign,
  onSelectSeat,
  onExecuteRecovery,
  onFinalizeScorecard,
  onRunRedTeam
}: SreWarRoomSeatProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {/* PHASE 1: DISCOVERY — Crisis Scenario Selector & 5-Tier Blast Radius Map */}
      <section
        aria-label="Phase 1 Discovery Crisis Injection and Blast Radius Map"
        className="pane"
      >
        <div className="pane-header">
          <span style={{ fontWeight: 700, fontSize: '12.5px', color: 'var(--text-primary)' }}>
            Phase 1 (Discovery) — Crisis Injection &amp; 5-Tier Infrastructure Blast-Radius Map
          </span>
          <span className="badge badge-blue">Seat 1 · SRE War Room</span>
        </div>

        <div className="pane-body" style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            {(Object.keys(CRISIS_SCENARIOS) as CrisisScenarioId[]).map((id) => {
              const item = CRISIS_SCENARIOS[id];
              const isSelected = state.selected_scenario === id;
              return (
                <button
                  key={id}
                  type="button"
                  className={isSelected ? 'btn btn-primary btn-sm' : 'btn btn-sm'}
                  onClick={() => onInjectCrisis(id)}
                >
                  <Activity size={13} />
                  <span>{item.shortLabel}</span>
                  <span
                    className="mono"
                    style={{ fontSize: '10px', opacity: isSelected ? 0.95 : 0.7 }}
                  >
                    ({item.severity})
                  </span>
                </button>
              );
            })}
          </div>

          <div
            className={getGateCardClass(
              animatingGate === 1 ? 'CHECKING' : stage1Done ? 'WARN' : 'WAITING'
            )}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: '12px',
                marginBottom: '6px',
                flexWrap: 'wrap'
              }}
            >
              <strong style={{ fontSize: '13.5px' }}>{scenarioDef.title}</strong>
              <span className="mono" style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                Vector: {scenarioDef.attackVector}
              </span>
            </div>
            <p style={{ fontSize: '12.5px', color: 'var(--text-secondary)', marginBottom: '10px' }}>
              {scenarioDef.summary}
            </p>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={() => onInjectCrisis(state.selected_scenario)}
              >
                <Activity size={13} />
                <span>Trigger Crisis Injection</span>
              </button>
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => onSelectStage(2)}
              >
                <span>Configure Stage 2 Containment Gates</span>
                <ArrowRight size={13} />
              </button>
            </div>
          </div>

          {/* 5-Tier Infrastructure Blast-Radius Map */}
          <div>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '8px',
                flexWrap: 'wrap',
                gap: '8px'
              }}
            >
              <span style={{ fontSize: '12px', fontWeight: 700 }}>
                5-Tier Infrastructure Blast-Radius Map
              </span>
              <span style={{ fontSize: '11.5px', color: 'var(--text-muted)' }}>
                R2 Mode: <code>{state.r2_snapshot.object_lock_mode}</code> · Tamper Blocks:{' '}
                <code>{state.r2_snapshot.tamper_attempts_blocked}</code>
              </span>
            </div>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
                gap: '10px'
              }}
            >
              {(Object.keys(TIER_LABELS) as InfrastructureTierId[]).map((tierId) => {
                const meta = TIER_LABELS[tierId];
                const health = state.blast_radius[tierId];
                return (
                  <div
                    key={tierId}
                    style={{
                      padding: '10px 12px',
                      borderRadius: 'var(--radius-sm)',
                      border: '1px solid var(--border-subtle)',
                      backgroundColor: 'var(--bg-canvas)',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      gap: '8px'
                    }}
                  >
                    <div>
                      <div style={{ fontSize: '12.5px', fontWeight: 700 }}>{meta.name}</div>
                      <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                        {meta.subtitle}
                      </div>
                    </div>
                    {getTierBadge(health)}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </section>

      {/* PHASES 2 & 3: UNDERSTANDING & PRACTICE — Vulnerable Stage 2 Defaults, R2 WORM Probe & 2-Seat Co-Signing */}
      <section
        aria-label="Phases 2 and 3 Recovery and Containment Controls"
        className="pane"
      >
        <div className="pane-header">
          <span style={{ fontWeight: 700, fontSize: '12.5px', color: 'var(--text-primary)' }}>
            Phases 2 &amp; 3 (Understanding &amp; Practice) — Containment Gates &amp; Vulnerable Default Traps
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <button
              type="button"
              className="btn btn-emerald btn-sm"
              onClick={onHardenAllStage2}
              title="Switch all 3 Stage 2 gates from vulnerable defaults to hardened posture and request CISO 2/2 FIDO2 co-sign"
            >
              <ShieldCheck size={13} />
              <span>Harden Stage 2 &amp; Request CISO Co-Sign</span>
            </button>
          </div>
        </div>

        <div className="pane-body" style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div
            style={{
              padding: '10px 12px',
              borderRadius: 'var(--radius-sm)',
              backgroundColor: '#fffbeb',
              border: '1px solid #fde68a',
              color: '#92400e',
              fontSize: '12px'
            }}
          >
            <strong>Safe-to-Fail Trap Notice:</strong> Stage 2 initializes with{' '}
            <strong>vulnerable baseline defaults</strong> (<code>GOVERNANCE / Unlocked</code> backup,{' '}
            <code>Cold Rebuild</code> with <code>1</code> probe, and <code>Single-Admin Bypass</code>).
            Probe R2 or execute recovery now to observe the failure modes, then harden all 3 gates and co-sign in{' '}
            <strong>Seat 2 (CISO)</strong> to achieve <code>PLATINUM</code> SLA.
          </div>

          {/* Gate 1: Cloudflare R2 Object Lock Immutability + Live Edge Probe */}
          <div className={getGateCardClass(getStage2GateStatus(1))}>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: '8px',
                marginBottom: '8px',
                flexWrap: 'wrap'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Lock size={14} />
                <strong style={{ fontSize: '13px' }}>
                  Gate 1: Cloudflare R2 Object Lock WORM Immutability (Phase 2 Probe)
                </strong>
              </div>
              {getGateBadge(getStage2GateStatus(1))}
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
                gap: '10px',
                marginBottom: '10px'
              }}
            >
              <div>
                <label
                  htmlFor="r2-backup-lock-mode"
                  style={{ display: 'block', fontSize: '11.5px', fontWeight: 700, marginBottom: '4px' }}
                >
                  Backup Object Lock Policy
                </label>
                <select
                  id="r2-backup-lock-mode"
                  className="select-control"
                  aria-label="Backup Lock Mode"
                  value={state.choices.backup_mode}
                  onChange={(e) =>
                    onUpdateChoices({ backup_mode: e.target.value as BackupLockChoice })
                  }
                >
                  <option value="R2_GOVERNANCE_OR_UNLOCKED">
                    [Trap Default] Unlocked / GOVERNANCE Mode (Tamperable · RPO 1440m)
                  </option>
                  <option value="R2_OBJECT_LOCK_COMPLIANCE">
                    [Hardened] R2 Object Lock: COMPLIANCE (30d WORM · RPO 5m)
                  </option>
                </select>
              </div>

              <div>
                <label
                  htmlFor="r2-probe-action"
                  style={{ display: 'block', fontSize: '11.5px', fontWeight: 700, marginBottom: '4px' }}
                >
                  Simulated Attacker / Ransomware API Call
                </label>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <select
                    id="r2-probe-action"
                    className="select-control"
                    aria-label="R2 Probe Action"
                    value={probeAction}
                    onChange={(e) => onSetProbeAction(e.target.value as R2MutationAction)}
                  >
                    <option value="DELETE">DeleteObject (Ransomware Wiper)</option>
                    <option value="BYPASS_GOVERNANCE">
                      PutObjectRetention (BypassGovernance=true)
                    </option>
                    <option value="SHORTEN_RETENTION">
                      Shorten Retention Window (&lt;30d)
                    </option>
                  </select>
                  <button
                    type="button"
                    className="btn btn-danger-soft btn-sm"
                    disabled={probingR2}
                    onClick={() => void onProbeR2()}
                    style={{ whiteSpace: 'nowrap' }}
                  >
                    <ShieldAlert size={13} />
                    <span>
                      {probingR2
                        ? 'Probing Edge…'
                        : 'Probe R2 Object Lock (POST /api/resilience/probe-delete)'}
                    </span>
                  </button>
                </div>
              </div>
            </div>

            {state.last_r2_mutation_result && (
              <div
                role="status"
                style={{
                  fontSize: '12px',
                  padding: '9px 12px',
                  borderRadius: 'var(--radius-sm)',
                  backgroundColor:
                    state.last_r2_mutation_result.http_status === 403 ? '#ecfdf5' : '#fef2f2',
                  color:
                    state.last_r2_mutation_result.http_status === 403 ? '#065f46' : '#991b1b',
                  border: '1px solid currentColor'
                }}
              >
                <strong>HTTP {state.last_r2_mutation_result.http_status}</strong>{' '}
                {state.last_r2_mutation_result.error_code ? (
                  <code>{state.last_r2_mutation_result.error_code}</code>
                ) : (
                  <code>R2_UNLOCKED_RISK</code>
                )}{' '}
                — {state.last_r2_mutation_result.message}
              </div>
            )}
          </div>

          {/* Gate 2: Warm-Standby Region Failover & Health Quorum */}
          <div className={getGateCardClass(getStage2GateStatus(2))}>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: '8px',
                marginBottom: '8px',
                flexWrap: 'wrap'
              }}
            >
              <strong style={{ fontSize: '13px' }}>
                Gate 2: Warm-Standby Region Failover &amp; Health Check Quorum
              </strong>
              {getGateBadge(getStage2GateStatus(2))}
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
                gap: '10px'
              }}
            >
              <div>
                <label
                  htmlFor="failover-strategy-select"
                  style={{ display: 'block', fontSize: '11.5px', fontWeight: 700, marginBottom: '4px' }}
                >
                  Regional Recovery Strategy
                </label>
                <select
                  id="failover-strategy-select"
                  className="select-control"
                  aria-label="Failover Strategy"
                  value={state.choices.failover_strategy}
                  onChange={(e) =>
                    onUpdateChoices({
                      failover_strategy: e.target.value as FailoverStrategyChoice
                    })
                  }
                >
                  <option value="COLD_REBUILD">
                    [Trap Default] Cold Rebuild from Scratch (RTO +240m)
                  </option>
                  <option value="WARM_STANDBY">
                    [Hardened] Warm-Standby Promotion (us-west-2 · RTO +12m)
                  </option>
                </select>
              </div>

              <div>
                <label
                  htmlFor="health-quorum-select"
                  style={{ display: 'block', fontSize: '11.5px', fontWeight: 700, marginBottom: '4px' }}
                >
                  Consecutive Failed Health Probes (Quorum &gt;= 2)
                </label>
                <select
                  id="health-quorum-select"
                  className="select-control"
                  aria-label="Health Quorum Probes"
                  value={state.choices.health_quorum_probes}
                  onChange={(e) =>
                    onUpdateChoices({ health_quorum_probes: Number(e.target.value) })
                  }
                >
                  <option value={1}>
                    [Trap Default] 1 Probe (Below Quorum &lt;2 · +45m delay)
                  </option>
                  <option value={2}>2 Consecutive Probes (Quorum Met)</option>
                  <option value={3}>3 Consecutive Probes (Quorum Met · Hardened)</option>
                </select>
              </div>
            </div>
          </div>

          {/* Gate 3: IdP-Independent 2-of-2 FIDO2 Break-Glass Access */}
          <div className={getGateCardClass(getStage2GateStatus(3))}>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: '8px',
                marginBottom: '8px',
                flexWrap: 'wrap'
              }}
            >
              <strong style={{ fontSize: '13px' }}>
                Gate 3: IdP-Independent Break-Glass Access (2-of-2 FIDO2 Dual Custody)
              </strong>
              {getGateBadge(getStage2GateStatus(3))}
            </div>

            <div
              style={{
                display: 'flex',
                gap: '10px',
                flexWrap: 'wrap',
                alignItems: 'center',
                marginBottom: '10px'
              }}
            >
              <select
                className="select-control"
                aria-label="Break-Glass Access Strategy"
                style={{ flex: '1 1 280px' }}
                value={state.choices.access_strategy}
                onChange={(e) =>
                  onUpdateChoices({
                    access_strategy: e.target.value as AccessStrategyChoice
                  })
                }
              >
                <option value="SINGLE_ADMIN_BYPASS">
                  [Trap Default] Single-Admin Password Bypass (403 Denied)
                </option>
                <option value="DUAL_CUSTODY_BREAK_GLASS">
                  [Hardened] Dual-Custody Break-Glass (2-of-2 FIDO2 · 15m TTL · +8m)
                </option>
                <option value="WAIT_FOR_IDP">
                  [Trap] Wait for Upstream IdP Recovery (+180m if IdP 503)
                </option>
              </select>

              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={onRequestCisoCosign}
              >
                <KeyRound size={13} />
                <span>Sign as SRE Custodian (1/2) &amp; Request CISO Co-Sign</span>
              </button>

              {(state.break_glass.status === 'PENDING_COSIGN' ||
                state.choices.access_strategy === 'DUAL_CUSTODY_BREAK_GLASS') &&
                !hasDualCustody2of2 && (
                  <button
                    type="button"
                    className="btn btn-dark btn-sm"
                    onClick={() => onSelectSeat('ciso-cosigner')}
                  >
                    <span>Switch to Seat 2 (CISO Morgan Vance) to Co-Sign (2/2)</span>
                    <ArrowRight size={13} />
                  </button>
                )}
            </div>

            <div
              style={{
                fontSize: '12px',
                color: 'var(--text-secondary)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                flexWrap: 'wrap',
                gap: '8px'
              }}
            >
              <span>
                Active FIDO2 Custodians ({state.choices.dual_custody_approvers.length}/2):{' '}
                <code>
                  {state.choices.dual_custody_approvers.length > 0
                    ? state.choices.dual_custody_approvers.join(' + ')
                    : 'none'}
                </code>
              </span>
              {hasDualCustody2of2 ? (
                <span className="badge badge-emerald">2-of-2 FIDO2 Quorum Verified</span>
              ) : (
                <span className="badge badge-amber">
                  1-of-2 Only — Requires Seat 2 CISO Co-Sign
                </span>
              )}
            </div>

            {state.break_glass.status === 'DENIED' && (
              <div
                role="alert"
                style={{
                  marginTop: '8px',
                  fontSize: '12px',
                  padding: '8px 10px',
                  borderRadius: 'var(--radius-sm)',
                  backgroundColor: '#fef2f2',
                  color: '#991b1b',
                  border: '1px solid #fecaca'
                }}
              >
                <strong>{state.break_glass.error_code}</strong> —{' '}
                {state.break_glass.error_detail}
              </div>
            )}

            {state.break_glass.status === 'ACTIVE' && (
              <div
                role="status"
                style={{
                  marginTop: '8px',
                  fontSize: '12px',
                  padding: '8px 10px',
                  borderRadius: 'var(--radius-sm)',
                  backgroundColor: '#ecfdf5',
                  color: '#065f46',
                  border: '1px solid #a7f3d0'
                }}
              >
                <strong>BREAK_GLASS_INVOKED</strong> — Custodians:{' '}
                <code>{state.break_glass.custodians.join(' + ')}</code> · Attestations:{' '}
                <code>{state.break_glass.fido2_attestation_ids.join(', ')}</code> (15m max TTL)
              </div>
            )}
          </div>

          {/* Action Bar & Red-Team Quick Triggers */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '12px',
              flexWrap: 'wrap',
              paddingTop: '4px'
            }}
          >
            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={onExecuteRecovery}
              >
                <ShieldCheck size={13} />
                <span>Execute Containment &amp; Recovery</span>
              </button>
              <button
                type="button"
                className="btn btn-emerald btn-sm"
                onClick={onFinalizeScorecard}
              >
                <span>View Deterministic RTO/RPO Scorecard</span>
                <ArrowRight size={13} />
              </button>
            </div>

            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
              <span
                style={{
                  fontSize: '11px',
                  fontWeight: 700,
                  color: '#991b1b',
                  textTransform: 'uppercase'
                }}
              >
                Red-Team:
              </span>
              <button
                type="button"
                className="btn btn-danger-soft btn-sm"
                onClick={() => void onRunRedTeam('9A')}
              >
                <ShieldAlert size={12} />
                <span>9A: Delete R2 WORM (403)</span>
              </button>
              <button
                type="button"
                className="btn btn-danger-soft btn-sm"
                onClick={() => void onRunRedTeam('9B')}
              >
                <ShieldAlert size={12} />
                <span>9B: Single-Admin Bypass (403)</span>
              </button>
              <button
                type="button"
                className="btn btn-amber-soft btn-sm"
                onClick={() => void onRunRedTeam('9C')}
              >
                <AlertTriangle size={12} />
                <span>9C: Unlocked + Cold Rebuild (Breach)</span>
              </button>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
