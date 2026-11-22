import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Clock,
  Copy,
  Download,
  KeyRound,
  Lock,
  Play,
  RotateCcw,
  ShieldAlert,
  ShieldCheck,
  UserCheck
} from 'lucide-react';
import {
  AccessStrategyChoice,
  BackupLockChoice,
  CRISIS_SCENARIOS,
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
} from '../contracts/resilienceContract';
import {
  coSignBreakGlassAsCiso,
  createInitialTabletopState,
  createResilienceSessionId,
  createResilienceSpan,
  evaluateTabletopOutcome,
  executeContainmentAndRecovery,
  exportPostIncidentReport,
  finalizeTabletopScorecard,
  injectCrisisScenario,
  PLATINUM_RECOVERY_CHOICES,
  probeR2ObjectLockApi,
  requestCisoBreakGlassCosign,
  runRedTeamScenario,
  setActiveStage,
  updateRecoveryChoices
} from '../engine/resilienceTabletopEngine';
import { RoleSeatItem, RoleSwitcherBar } from '../components/RoleSwitcherBar';
import { XRayDecodedProofSection, XRayTelemetryDrawer } from '../components/XRayTelemetryDrawer';
import { ObservabilitySpan } from '../types';

export interface ResilienceTabletopPageProps {
  onBack: () => void;
}

interface ExploredResilienceTraps {
  r2UnlockedTrap: boolean;
  r2ComplianceHeld9A: boolean;
  breakGlassQuorumDenied9B: boolean;
  coldRebuildSlaBreach9C: boolean;
  cisoDualCustodyPlatinum: boolean;
}

const INITIAL_TRAPS: ExploredResilienceTraps = {
  r2UnlockedTrap: false,
  r2ComplianceHeld9A: false,
  breakGlassQuorumDenied9B: false,
  coldRebuildSlaBreach9C: false,
  cisoDualCustodyPlatinum: false
};

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

export function ResilienceTabletopPage({ onBack }: ResilienceTabletopPageProps) {
  const [sessionId, setSessionId] = useState<string>(() => createResilienceSessionId());
  const [activeSeat, setActiveSeat] = useState<ResilienceSeatId>('sre-war-room');
  const [state, setState] = useState<ResilienceTabletopState>(() =>
    createInitialTabletopState('INIT')
  );
  const [probeAction, setProbeAction] = useState<R2MutationAction>('DELETE');
  const [probingR2, setProbingR2] = useState<boolean>(false);
  const [isAutoPlaying, setIsAutoPlaying] = useState<boolean>(false);
  const [animatingGate, setAnimatingGate] = useState<number>(0);
  const [copiedReport, setCopiedReport] = useState<boolean>(false);
  const [traps, setTraps] = useState<ExploredResilienceTraps>(INITIAL_TRAPS);
  const [spans, setSpans] = useState<ObservabilitySpan[]>([]);

  const timerRefs = useRef<number[]>([]);

  const clearTimers = () => {
    timerRefs.current.forEach((id) => window.clearTimeout(id));
    timerRefs.current = [];
  };

  useEffect(() => {
    return () => clearTimers();
  }, []);

  const recordSpan = useCallback((span: ObservabilitySpan) => {
    setSpans((prev) => [span, ...prev].slice(0, 40));
  }, []);

  // Emit initial steady-state span on mount
  useEffect(() => {
    recordSpan(
      createResilienceSpan({
        sessionId,
        traceparent: state.traceparent,
        method: 'GET',
        path: '/api/resilience/war-room-init',
        status: 200,
        latencyMs: 3,
        origin: 'browser-webcrypto-fallback',
        summary: {
          machine_state: 'STEADY_STATE',
          correlation_id: state.correlation_id,
          stage2_default_posture: 'VULNERABLE_TRAP_BASELINE',
          r2_object_lock_mode: state.r2_snapshot.object_lock_mode
        }
      })
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const scenarioDef = CRISIS_SCENARIOS[state.selected_scenario];

  // Live projected RTO/RPO/Score based on current choices
  const projectedOutcome = useMemo(
    () =>
      evaluateTabletopOutcome(state.selected_scenario, state.choices, {
        correlation_id: state.correlation_id,
        traceparent: state.traceparent
      }),
    [state.selected_scenario, state.choices, state.correlation_id, state.traceparent]
  );

  const stage1Done = state.machine_state !== 'STEADY_STATE';
  const stage2Done =
    state.machine_state === 'RECOVERY_EXECUTING' ||
    state.machine_state === 'VERIFIED_RECOVERED' ||
    state.machine_state === 'SLA_BREACHED';
  const stage3Done =
    state.machine_state === 'VERIFIED_RECOVERED' || state.machine_state === 'SLA_BREACHED';

  const hasDualCustody2of2 =
    state.choices.access_strategy === 'DUAL_CUSTODY_BREAK_GLASS' &&
    state.choices.dual_custody_approvers.length >= 2;

  // 2-Seat Role Switcher Configuration (Archetype B: Incident War Room)
  const seats: RoleSeatItem<ResilienceSeatId>[] = useMemo(() => {
    const sreBadge = (() => {
      if (state.machine_state === 'STEADY_STATE') {
        return { text: 'Steady State', tone: 'neutral' as const };
      }
      if (
        state.machine_state === 'VERIFIED_RECOVERED' ||
        (state.warm_standby.promoted && state.break_glass.status === 'ACTIVE')
      ) {
        return { text: 'Failover Active', tone: 'emerald' as const };
      }
      if (state.break_glass.status === 'PENDING_COSIGN') {
        return { text: 'Awaiting CISO FIDO2', tone: 'amber' as const, pulse: true };
      }
      return { text: '● Crisis Active', tone: 'crimson' as const, pulse: true };
    })();

    const cisoBadge = (() => {
      if (state.break_glass.status === 'PENDING_COSIGN') {
        return { text: '● 1 Co-Sign Req', tone: 'amber' as const, pulse: true };
      }
      if (state.break_glass.status === 'ACTIVE' || hasDualCustody2of2) {
        return { text: '2-of-2 Co-Signed (15m)', tone: 'emerald' as const };
      }
      if (state.break_glass.status === 'DENIED') {
        return { text: '403 Quorum Denied', tone: 'crimson' as const, pulse: true };
      }
      return { text: 'Standby', tone: 'neutral' as const };
    })();

    return [
      {
        id: 'sre-war-room',
        name: 'Alex Rivera',
        roleLabel: 'SRE · Failover War Room',
        appLabel: 'Continuity & Blast-Radius Console',
        avatarInitials: 'AR',
        badge: sreBadge
      },
      {
        id: 'ciso-cosigner',
        name: 'Morgan Vance',
        roleLabel: 'CISO · Out-of-Band FIDO2 Co-Signer',
        appLabel: 'FIDO2 Dual-Custody & SLA Board',
        avatarInitials: 'MV',
        badge: cisoBadge
      }
    ];
  }, [
    state.machine_state,
    state.warm_standby.promoted,
    state.break_glass.status,
    hasDualCustody2of2
  ]);

  const handleSelectStage = (stage: TabletopStage) => {
    clearTimers();
    setAnimatingGate(0);
    setState((prev) => setActiveStage(prev, stage));
  };

  const handleReset = () => {
    clearTimers();
    const freshSid = createResilienceSessionId();
    setSessionId(freshSid);
    setActiveSeat('sre-war-room');
    setIsAutoPlaying(false);
    setAnimatingGate(0);
    setCopiedReport(false);
    setTraps(INITIAL_TRAPS);
    const freshState = createInitialTabletopState('MANUAL_RESET');
    setState(freshState);
    setSpans([
      createResilienceSpan({
        sessionId: freshSid,
        traceparent: freshState.traceparent,
        method: 'POST',
        path: '/api/resilience/reset',
        status: 200,
        latencyMs: 2,
        origin: 'browser-webcrypto-fallback',
        summary: {
          machine_state: 'STEADY_STATE',
          correlation_id: freshState.correlation_id,
          stage2_default_posture: 'VULNERABLE_TRAP_BASELINE'
        }
      })
    ]);
  };

  const handleInjectCrisis = (scenarioId: CrisisScenarioId) => {
    clearTimers();
    setAnimatingGate(1);
    const t1 = window.setTimeout(() => {
      setAnimatingGate(0);
      setState((prev) => {
        const next = injectCrisisScenario(prev, scenarioId);
        recordSpan(
          createResilienceSpan({
            sessionId,
            traceparent: next.traceparent,
            method: 'POST',
            path: '/api/resilience/inject-crisis',
            status: 200,
            latencyMs: 6,
            origin: 'browser-webcrypto-fallback',
            summary: {
              scenario: scenarioId,
              machine_state: next.machine_state,
              idp_down: CRISIS_SCENARIOS[scenarioId].idpDown,
              blast_radius: next.blast_radius
            }
          })
        );
        return next;
      });
    }, 220);
    timerRefs.current.push(t1);
  };

  const handleUpdateChoices = (patch: Partial<RecoveryChoices>) => {
    setState((prev) => updateRecoveryChoices(prev, patch));
  };

  const handleProbeR2 = async (overrideAction?: R2MutationAction) => {
    const actionToRun = overrideAction || probeAction;
    setProbingR2(true);
    const { nextState, span } = await probeR2ObjectLockApi(state, actionToRun, sessionId);
    setState(nextState);
    recordSpan(span);
    setProbingR2(false);

    if (nextState.last_r2_mutation_result?.http_status === 403) {
      setTraps((prev) => ({ ...prev, r2ComplianceHeld9A: true }));
    } else if (nextState.last_r2_mutation_result?.http_status === 200) {
      setTraps((prev) => ({ ...prev, r2UnlockedTrap: true }));
    }
  };

  const handleRequestCisoCosign = () => {
    setState((prev) => {
      const base =
        prev.machine_state === 'STEADY_STATE'
          ? injectCrisisScenario(prev, prev.selected_scenario)
          : prev;
      const next = requestCisoBreakGlassCosign(base);
      recordSpan(
        createResilienceSpan({
          sessionId,
          traceparent: next.traceparent,
          method: 'POST',
          path: '/api/resilience/break-glass/request-cosign',
          status: 202,
          latencyMs: 5,
          origin: 'browser-webcrypto-fallback',
          summary: {
            status: 'PENDING_COSIGN',
            quorum_progress: '1-of-2',
            sre_custodian: 'sre-lead-fido2@0trust.dev',
            fido2_attestation_id: next.break_glass.fido2_attestation_ids[0],
            webauthn_challenge: next.break_glass.webauthn_challenge
          }
        })
      );
      return next;
    });
  };

  const handleCisoCoSign2of2 = () => {
    setState((prev) => {
      const next = coSignBreakGlassAsCiso(prev);
      recordSpan(
        createResilienceSpan({
          sessionId,
          traceparent: next.traceparent,
          method: 'POST',
          path: '/api/resilience/break-glass/ciso-cosign',
          status: 200,
          latencyMs: 7,
          origin: 'browser-webcrypto-fallback',
          summary: {
            status: 'BREAK_GLASS_INVOKED',
            quorum_verified: '2-of-2',
            custodians: next.break_glass.custodians,
            fido2_attestation_ids: next.break_glass.fido2_attestation_ids,
            max_ttl_minutes: 15,
            expires_at_iso: next.break_glass.expires_at_iso
          }
        })
      );
      return next;
    });
  };

  const updateTrapsFromState = (s: ResilienceTabletopState) => {
    setTraps((prev) => ({
      r2UnlockedTrap:
        prev.r2UnlockedTrap ||
        s.choices.backup_mode === 'R2_GOVERNANCE_OR_UNLOCKED' ||
        s.last_r2_mutation_result?.http_status === 200,
      r2ComplianceHeld9A:
        prev.r2ComplianceHeld9A ||
        s.r2_snapshot.tamper_attempts_blocked > 0 ||
        s.choices.backup_mode === 'R2_OBJECT_LOCK_COMPLIANCE',
      breakGlassQuorumDenied9B:
        prev.breakGlassQuorumDenied9B || s.break_glass.status === 'DENIED',
      coldRebuildSlaBreach9C:
        prev.coldRebuildSlaBreach9C ||
        s.choices.failover_strategy === 'COLD_REBUILD' ||
        s.choices.health_quorum_probes < 2 ||
        s.outcome?.sla_tier === 'BREACH',
      cisoDualCustodyPlatinum:
        prev.cisoDualCustodyPlatinum ||
        (s.break_glass.status === 'ACTIVE' && s.outcome?.sla_tier === 'PLATINUM')
    }));
  };

  const handleExecuteRecovery = () => {
    clearTimers();
    setAnimatingGate(1);
    const t1 = window.setTimeout(() => setAnimatingGate(2), 180);
    const t2 = window.setTimeout(() => setAnimatingGate(3), 360);
    const t3 = window.setTimeout(() => {
      setAnimatingGate(0);
      setState((prev) => {
        const s2 = executeContainmentAndRecovery(prev, prev.choices);
        const s3 = finalizeTabletopScorecard(s2);
        const isDenied = s3.break_glass.status === 'DENIED';
        const httpStatus = isDenied ? 403 : s3.outcome?.sla_met ? 200 : 422;

        recordSpan(
          createResilienceSpan({
            sessionId,
            traceparent: s3.traceparent,
            method: 'POST',
            path: '/api/resilience/execute-recovery',
            status: httpStatus,
            latencyMs: 9,
            origin: 'browser-webcrypto-fallback',
            summary: {
              machine_state: s3.machine_state,
              sla_tier: s3.outcome?.sla_tier,
              rto_minutes: s3.outcome?.rto_minutes,
              rpo_minutes: s3.outcome?.rpo_minutes,
              resilience_score: s3.outcome?.resilience_score,
              break_glass_status: s3.break_glass.status,
              error_code: s3.break_glass.error_code,
              invariants_passed: s3.outcome?.invariants_passed,
              invariants_failed: s3.outcome?.invariants_failed
            }
          })
        );
        updateTrapsFromState(s3);
        return {
          ...s3,
          active_stage: 2
        };
      });
    }, 520);
    timerRefs.current.push(t1, t2, t3);
  };

  const handleFinalizeScorecard = () => {
    clearTimers();
    setAnimatingGate(1);
    const t1 = window.setTimeout(() => {
      setAnimatingGate(0);
      setState((prev) => {
        const next = finalizeTabletopScorecard(prev);
        recordSpan(
          createResilienceSpan({
            sessionId,
            traceparent: next.traceparent,
            method: 'POST',
            path: '/api/resilience/finalize-scorecard',
            status: next.outcome?.sla_met ? 200 : 422,
            latencyMs: 5,
            origin: 'browser-webcrypto-fallback',
            summary: {
              machine_state: next.machine_state,
              sla_tier: next.outcome?.sla_tier,
              rto_minutes: next.outcome?.rto_minutes,
              rpo_minutes: next.outcome?.rpo_minutes,
              resilience_score: next.outcome?.resilience_score,
              timeline_steps: next.outcome?.post_incident_timeline.map(
                (t) => `T+${t.t_plus_minutes}m:${t.phase}`
              )
            }
          })
        );
        updateTrapsFromState(next);
        return next;
      });
    }, 220);
    timerRefs.current.push(t1);
  };

  const handleHardenAllStage2 = () => {
    setState((prev) => {
      const base =
        prev.machine_state === 'STEADY_STATE'
          ? injectCrisisScenario(prev, prev.selected_scenario)
          : prev;
      const withChoices = updateRecoveryChoices(base, {
        backup_mode: 'R2_OBJECT_LOCK_COMPLIANCE',
        failover_strategy: 'WARM_STANDBY',
        health_quorum_probes: 3,
        access_strategy: 'DUAL_CUSTODY_BREAK_GLASS'
      });
      if (withChoices.break_glass.status === 'ACTIVE') {
        return withChoices;
      }
      return requestCisoBreakGlassCosign(withChoices);
    });
  };

  const handleRunRedTeam = async (redTeamId: RedTeamScenarioId) => {
    clearTimers();
    setIsAutoPlaying(false);
    setAnimatingGate(1);

    if (redTeamId === '9A') {
      const hardened = updateRecoveryChoices(
        injectCrisisScenario(state, 'RANSOMWARE_PRIMARY_DB'),
        { backup_mode: 'R2_OBJECT_LOCK_COMPLIANCE' }
      );
      const { nextState, span } = await probeR2ObjectLockApi(hardened, 'DELETE', sessionId);
      setAnimatingGate(0);
      const final9A: ResilienceTabletopState = {
        ...nextState,
        active_stage: 2,
        machine_state: 'CONTAINMENT_ACTIVE',
        active_red_team: '9A'
      };
      setState(final9A);
      recordSpan(span);
      setTraps((prev) => ({ ...prev, r2ComplianceHeld9A: true }));
      return;
    }

    const t1 = window.setTimeout(() => {
      setAnimatingGate(0);
      setState((prev) => {
        const next = runRedTeamScenario(prev, redTeamId);
        const httpStatus = redTeamId === '9B' ? 403 : 422;
        recordSpan(
          createResilienceSpan({
            sessionId,
            traceparent: next.traceparent,
            method: 'POST',
            path: `/api/resilience/red-team/${redTeamId.toLowerCase()}`,
            status: httpStatus,
            latencyMs: 8,
            origin: 'browser-webcrypto-fallback',
            summary: {
              red_team_scenario: redTeamId,
              machine_state: next.machine_state,
              sla_tier: next.outcome?.sla_tier,
              rto_minutes: next.outcome?.rto_minutes,
              rpo_minutes: next.outcome?.rpo_minutes,
              error_code: next.break_glass.error_code
            }
          })
        );
        updateTrapsFromState(next);
        return next;
      });
    }, 240);
    timerRefs.current.push(t1);
  };

  const handleGuidedWalkthrough = async () => {
    clearTimers();
    setIsAutoPlaying(true);
    setActiveSeat('sre-war-room');

    const fresh = createInitialTabletopState('MANUAL_RESET');
    const s1 = injectCrisisScenario(fresh, 'PRIMARY_REGION_IDP_OUTAGE');
    const s1Hardened = updateRecoveryChoices(s1, {
      backup_mode: 'R2_OBJECT_LOCK_COMPLIANCE',
      failover_strategy: 'WARM_STANDBY',
      health_quorum_probes: 3,
      access_strategy: 'DUAL_CUSTODY_BREAK_GLASS'
    });
    const { nextState: s1Probed, span: probeSpan } = await probeR2ObjectLockApi(
      s1Hardened,
      'DELETE',
      sessionId
    );
    const s1Requested = requestCisoBreakGlassCosign(s1Probed);
    setState({ ...s1Requested, active_stage: 2 });
    recordSpan(probeSpan);

    const t1 = window.setTimeout(() => {
      setActiveSeat('ciso-cosigner');
      const s2Cosigned = coSignBreakGlassAsCiso(s1Requested);
      const s2Executed = executeContainmentAndRecovery(s2Cosigned, {
        ...PLATINUM_RECOVERY_CHOICES
      });
      setState(s2Executed);

      const t2 = window.setTimeout(() => {
        const s3Final = finalizeTabletopScorecard(s2Executed);
        setState(s3Final);
        recordSpan(
          createResilienceSpan({
            sessionId,
            traceparent: s3Final.traceparent,
            method: 'POST',
            path: '/api/resilience/guided-platinum-walkthrough',
            status: 200,
            latencyMs: 11,
            origin: 'browser-webcrypto-fallback',
            summary: {
              sla_tier: s3Final.outcome?.sla_tier,
              rto_minutes: s3Final.outcome?.rto_minutes,
              rpo_minutes: s3Final.outcome?.rpo_minutes,
              resilience_score: s3Final.outcome?.resilience_score,
              quorum: '2-of-2 FIDO2 Verified'
            }
          })
        );
        setTraps((prev) => ({
          ...prev,
          r2ComplianceHeld9A: true,
          cisoDualCustodyPlatinum: true
        }));
        setIsAutoPlaying(false);
      }, 650);
      timerRefs.current.push(t2);
    }, 600);
    timerRefs.current.push(t1);
  };

  const handleCopyReport = async () => {
    const json = exportPostIncidentReport(state);
    try {
      await navigator.clipboard.writeText(json);
      setCopiedReport(true);
      window.setTimeout(() => setCopiedReport(false), 2000);
    } catch {
      setCopiedReport(false);
    }
  };

  const handleDownloadReport = () => {
    const json = exportPostIncidentReport(state);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `lab9-post-incident-${state.correlation_id}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Compute live gate statuses for Stage 2 controls
  const getStage2GateStatus = (gate: 1 | 2 | 3): GateStatus => {
    if (animatingGate === gate) return 'CHECKING';
    if (animatingGate > gate) return 'PASS';

    if (gate === 1) {
      return state.choices.backup_mode === 'R2_OBJECT_LOCK_COMPLIANCE' ? 'PASS' : 'BLOCK';
    }
    if (gate === 2) {
      if (state.choices.failover_strategy === 'COLD_REBUILD') return 'WARN';
      return state.choices.health_quorum_probes >= 2 ? 'PASS' : 'BLOCK';
    }
    if (state.choices.access_strategy === 'SINGLE_ADMIN_BYPASS') return 'BLOCK';
    if (state.choices.access_strategy === 'DUAL_CUSTODY_BREAK_GLASS') {
      return state.choices.dual_custody_approvers.length >= 2 ? 'PASS' : 'WARN';
    }
    if (state.choices.access_strategy === 'WAIT_FOR_IDP' && scenarioDef.idpDown) return 'WARN';
    return 'PASS';
  };

  const machineBadgeClass =
    state.machine_state === 'VERIFIED_RECOVERED'
      ? 'badge badge-emerald'
      : state.machine_state === 'SLA_BREACHED'
        ? 'badge badge-crimson'
        : state.machine_state === 'STEADY_STATE'
          ? 'badge badge-blue'
          : 'badge badge-amber';

  const trapChecklist = [
    {
      key: 'r2UnlockedTrap',
      label: 'Vulnerable Stage 2 Default: R2 GOVERNANCE / Unlocked Tamper Trap (HTTP 200 · RPO 1440m)',
      tested: traps.r2UnlockedTrap
    },
    {
      key: 'r2ComplianceHeld9A',
      label: '9A: R2 Object Lock COMPLIANCE WORM Immutability Probe (HTTP 403 ObjectLockComplianceViolation)',
      tested: traps.r2ComplianceHeld9A
    },
    {
      key: 'breakGlassQuorumDenied9B',
      label: '9B: Single-Admin / 1-of-2 Break-Glass Bypass Blocked (HTTP 403 BREAK_GLASS_QUORUM_REQUIRED)',
      tested: traps.breakGlassQuorumDenied9B
    },
    {
      key: 'coldRebuildSlaBreach9C',
      label: '9C: Cold Rebuild (+240m) / Below-Quorum (<2 Probes) SLA Breach Trap',
      tested: traps.coldRebuildSlaBreach9C
    },
    {
      key: 'cisoDualCustodyPlatinum',
      label: '2-of-2 Out-of-Band FIDO2 CISO Co-Sign & Platinum SLA Recovery (RTO 20m / RPO 5m / Score 100)',
      tested: traps.cisoDualCustodyPlatinum
    }
  ];

  const testedTrapCount = trapChecklist.filter((t) => t.tested).length;

  const decodedProofSections: XRayDecodedProofSection[] = useMemo(
    () => [
      {
        id: 'r2-object-lock-worm',
        label: 'Cloudflare R2 Object Lock WORM & Probe Proof',
        payload: {
          r2_snapshot: state.r2_snapshot,
          last_r2_mutation_result: state.last_r2_mutation_result
        }
      },
      {
        id: 'fido2-break-glass-quorum',
        label: '2-of-2 FIDO2 Out-of-Band Break-Glass Session',
        payload: {
          break_glass: state.break_glass,
          access_strategy: state.choices.access_strategy,
          dual_custody_approvers: state.choices.dual_custody_approvers
        }
      },
      {
        id: 'blast-radius-warm-standby',
        label: '5-Tier Blast Radius & Warm-Standby Quorum',
        payload: {
          scenario: state.selected_scenario,
          machine_state: state.machine_state,
          blast_radius: state.blast_radius,
          warm_standby: state.warm_standby
        }
      },
      {
        id: 'deterministic-sla-scorecard',
        label: 'Deterministic RTO/RPO Scorecard & Correlation Trail',
        payload: {
          correlation_id: state.correlation_id,
          traceparent: state.traceparent,
          active_red_team: state.active_red_team,
          projected_or_actual_outcome: state.outcome || projectedOutcome
        }
      }
    ],
    [state, projectedOutcome]
  );

  const displayedOutcome = state.outcome || projectedOutcome;

  return (
    <div className="lab-shell">
      {/* 1. Universal Capability-First Header */}
      <header className="lab-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap' }}>
          <button type="button" className="btn btn-sm" onClick={onBack}>
            <ArrowLeft size={14} />
            <span>All Labs</span>
          </button>

          <div>
            <h1 style={{ fontSize: '15.5px', fontWeight: 800, color: 'var(--text-primary)', margin: 0 }}>
              Chaos &amp; Cyber Resilience Tabletop Simulator
            </h1>
            <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
              Archetype B: 2-Seat Incident War Room · R2 Object Lock WORM, Quorum Failover &amp; 2-of-2 FIDO2 Break-Glass
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
          <span className="badge badge-blue" title="Per-visitor STATE_KV isolation (1h TTL) + deterministic browser fallback">
            $0.00 Guided Sandbox · Edge + WebCrypto
          </span>

          <button
            type="button"
            className="btn btn-emerald btn-sm"
            onClick={() => void handleGuidedWalkthrough()}
            disabled={isAutoPlaying}
          >
            <Play size={13} />
            <span>
              {isAutoPlaying ? 'Running 2-Seat Walkthrough…' : 'Guided Walkthrough (Platinum 2-Seat)'}
            </span>
          </button>

          <button type="button" className="btn btn-sm" onClick={handleReset}>
            <RotateCcw size={13} />
            <span>↺ Reset</span>
          </button>
        </div>
      </header>

      {/* 2. Adaptive Workspace (Natural Document Flow) */}
      <main className="lab-workspace" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        {/* 2-Seat Role Switcher Bar (SRE War Room <-> CISO Out-of-Band FIDO2 Co-Signer) */}
        <RoleSwitcherBar
          seats={seats}
          activeSeatId={activeSeat}
          onSelectSeat={setActiveSeat}
          ariaLabel="Incident War Room 2-Seat Role Switcher"
        />

        {/* War Room Live Status & Projected RTO / RPO / SLA Ticker */}
        <section
          aria-label="War Room Live Telemetry & SLA Ticker"
          style={{
            padding: '14px 18px',
            borderRadius: 'var(--radius-md)',
            background: 'linear-gradient(90deg, #eff6ff 0%, #f8fafc 100%)',
            border: '1px solid #bfdbfe',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '16px',
            flexWrap: 'wrap'
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', maxWidth: '580px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
              <span className={machineBadgeClass}>{state.machine_state}</span>
              <span className="mono" style={{ fontSize: '11.5px', color: '#1e40af', fontWeight: 700 }}>
                {state.correlation_id}
              </span>
              {state.active_red_team && (
                <span className="badge badge-crimson">Red-Team {state.active_red_team}</span>
              )}
            </div>
            <div style={{ fontSize: '12.5px', color: '#1e293b' }}>
              <strong>Active Scenario:</strong> {scenarioDef.title}{' '}
              {scenarioDef.idpDown && (
                <span className="badge badge-crimson" style={{ marginLeft: '6px' }}>
                  IdP HTTP 503 Outage
                </span>
              )}
            </div>
          </div>

          {/* Live Projected / Actual RTO & RPO Counters */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: '10.5px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                {state.outcome ? 'Verified RTO' : 'Projected RTO'}
              </div>
              <div
                className="mono"
                style={{
                  fontSize: '16px',
                  fontWeight: 800,
                  color: displayedOutcome.rto_minutes <= 30 ? '#059669' : '#dc2626'
                }}
              >
                {displayedOutcome.rto_minutes}m{' '}
                <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)' }}>
                  (Target &lt;=30m)
                </span>
              </div>
            </div>

            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: '10.5px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                {state.outcome ? 'Verified RPO' : 'Projected RPO'}
              </div>
              <div
                className="mono"
                style={{
                  fontSize: '16px',
                  fontWeight: 800,
                  color: displayedOutcome.rpo_minutes <= 15 ? '#059669' : '#dc2626'
                }}
              >
                {displayedOutcome.rpo_minutes}m{' '}
                <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)' }}>
                  (Target &lt;=15m)
                </span>
              </div>
            </div>

            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: '10.5px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                SLA Classification
              </div>
              <div>
                <span
                  className={
                    displayedOutcome.sla_tier === 'PLATINUM'
                      ? 'badge badge-emerald'
                      : displayedOutcome.sla_tier === 'GOLD'
                        ? 'badge badge-amber'
                        : 'badge badge-crimson'
                  }
                >
                  {displayedOutcome.sla_tier} · {displayedOutcome.resilience_score}/100
                </span>
              </div>
            </div>
          </div>
        </section>

        {/* 3-Stage War-Room Milestone Stepper */}
        <div
          className="stepper-bar"
          role="tablist"
          aria-label="Chaos & Cyber Resilience Workflow Steps"
          style={{ margin: 0 }}
        >
          <button
            type="button"
            role="tab"
            aria-selected={state.active_stage === 1}
            className={`stage-pill ${
              state.active_stage === 1 ? 'active' : stage1Done ? 'completed' : ''
            }`}
            onClick={() => handleSelectStage(1)}
          >
            <span style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <span className="stage-number">1</span>
              <span>Phase 1 · Crisis &amp; Blast Radius</span>
            </span>
            {stage1Done && <CheckCircle2 size={15} color="#059669" />}
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={state.active_stage === 2}
            className={`stage-pill ${
              state.active_stage === 2 ? 'active' : stage2Done ? 'completed' : ''
            }`}
            onClick={() => handleSelectStage(2)}
          >
            <span style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <span className="stage-number">2</span>
              <span>Phases 2–3 · WORM Probe &amp; 2-of-2 Failover</span>
            </span>
            {stage2Done && <CheckCircle2 size={15} color="#059669" />}
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={state.active_stage === 3}
            className={`stage-pill ${
              state.active_stage === 3 ? 'active' : stage3Done ? 'completed' : ''
            }`}
            onClick={() => handleSelectStage(3)}
          >
            <span style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <span className="stage-number">3</span>
              <span>Phase 4 · RTO/RPO Scorecard &amp; Timeline</span>
            </span>
            {stage3Done && <CheckCircle2 size={15} color="#059669" />}
          </button>
        </div>

        {/* =====================================================================
            SEAT 1: ALEX RIVERA (SRE · FAILOVER WAR ROOM)
            ===================================================================== */}
        {activeSeat === 'sre-war-room' && (
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
                        onClick={() => handleInjectCrisis(id)}
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
                      onClick={() => handleInjectCrisis(state.selected_scenario)}
                    >
                      <Activity size={13} />
                      <span>Trigger Crisis Injection</span>
                    </button>
                    <button
                      type="button"
                      className="btn btn-sm"
                      onClick={() => handleSelectStage(2)}
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
                    onClick={handleHardenAllStage2}
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
                          handleUpdateChoices({ backup_mode: e.target.value as BackupLockChoice })
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
                          onChange={(e) => setProbeAction(e.target.value as R2MutationAction)}
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
                          onClick={() => void handleProbeR2()}
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
                          handleUpdateChoices({
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
                          handleUpdateChoices({ health_quorum_probes: Number(e.target.value) })
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
                        handleUpdateChoices({
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
                      onClick={handleRequestCisoCosign}
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
                          onClick={() => setActiveSeat('ciso-cosigner')}
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
                      onClick={handleExecuteRecovery}
                    >
                      <ShieldCheck size={13} />
                      <span>Execute Containment &amp; Recovery</span>
                    </button>
                    <button
                      type="button"
                      className="btn btn-emerald btn-sm"
                      onClick={handleFinalizeScorecard}
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
                      onClick={() => void handleRunRedTeam('9A')}
                    >
                      <ShieldAlert size={12} />
                      <span>9A: Delete R2 WORM (403)</span>
                    </button>
                    <button
                      type="button"
                      className="btn btn-danger-soft btn-sm"
                      onClick={() => void handleRunRedTeam('9B')}
                    >
                      <ShieldAlert size={12} />
                      <span>9B: Single-Admin Bypass (403)</span>
                    </button>
                    <button
                      type="button"
                      className="btn btn-amber-soft btn-sm"
                      onClick={() => void handleRunRedTeam('9C')}
                    >
                      <AlertTriangle size={12} />
                      <span>9C: Unlocked + Cold Rebuild (Breach)</span>
                    </button>
                  </div>
                </div>
              </div>
            </section>
          </div>
        )}

        {/* =====================================================================
            SEAT 2: MORGAN VANCE (CISO · OUT-OF-BAND FIDO2 CO-SIGNER)
            ===================================================================== */}
        {activeSeat === 'ciso-cosigner' && (
          <section
            aria-label="CISO Out-of-Band FIDO2 Co-Signer Console"
            className="pane"
          >
            <div className="pane-header">
              <span style={{ fontWeight: 700, fontSize: '12.5px', color: 'var(--text-primary)' }}>
                Seat 2 · CISO Out-of-Band FIDO2 Dual-Custody Co-Signer &amp; Executive SLA Board
              </span>
              <span className="badge badge-blue">IdP-Independent Hardware WebAuthn</span>
            </div>

            <div className="pane-body" style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div
                style={{
                  padding: '14px 16px',
                  borderRadius: 'var(--radius-md)',
                  border:
                    state.break_glass.status === 'ACTIVE'
                      ? '1.5px solid var(--accent-emerald)'
                      : state.break_glass.status === 'PENDING_COSIGN'
                        ? '1.5px solid var(--accent-amber)'
                        : '1.5px solid var(--border-strong)',
                  backgroundColor:
                    state.break_glass.status === 'ACTIVE'
                      ? 'var(--accent-emerald-dim)'
                      : state.break_glass.status === 'PENDING_COSIGN'
                        ? 'var(--accent-amber-dim)'
                        : 'var(--bg-canvas)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '12px'
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: '10px',
                    flexWrap: 'wrap'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <UserCheck size={16} />
                    <strong style={{ fontSize: '14px' }}>
                      Out-of-Band FIDO2 / WebAuthn Dual-Custody Quorum (2-of-2 Required)
                    </strong>
                  </div>
                  <span
                    className={
                      state.break_glass.status === 'ACTIVE'
                        ? 'badge badge-emerald'
                        : state.break_glass.status === 'PENDING_COSIGN'
                          ? 'badge badge-amber'
                          : state.break_glass.status === 'DENIED'
                            ? 'badge badge-crimson'
                            : 'badge'
                    }
                  >
                    {state.break_glass.status}
                  </span>
                </div>

                <p style={{ fontSize: '12.5px', color: 'var(--text-secondary)', margin: 0 }}>
                  When the primary workforce IdP returns <code>HTTP 503</code> during a regional outage,
                  emergency recovery requires <strong>2-of-2 hardware FIDO2 attestation</strong> verified directly
                  against pre-registered public keys at the Cloudflare Edge—preventing any single compromised
                  admin from bypassing controls.
                </p>

                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                    gap: '10px',
                    fontSize: '12px'
                  }}
                >
                  <div
                    style={{
                      padding: '10px 12px',
                      borderRadius: 'var(--radius-sm)',
                      backgroundColor: 'var(--bg-surface)',
                      border: '1px solid var(--border-subtle)'
                    }}
                  >
                    <div style={{ fontWeight: 700, marginBottom: '4px' }}>
                      Custodian 1 · SRE Lead (Alex Rivera)
                    </div>
                    <div className="mono" style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                      sre-lead-fido2@0trust.dev
                    </div>
                    <div style={{ marginTop: '6px' }}>
                      <span className="badge badge-emerald">SIGNED (1/2)</span>
                    </div>
                  </div>

                  <div
                    style={{
                      padding: '10px 12px',
                      borderRadius: 'var(--radius-sm)',
                      backgroundColor: 'var(--bg-surface)',
                      border: '1px solid var(--border-subtle)'
                    }}
                  >
                    <div style={{ fontWeight: 700, marginBottom: '4px' }}>
                      Custodian 2 · CISO (Morgan Vance)
                    </div>
                    <div className="mono" style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                      ciso-fido2@0trust.dev
                    </div>
                    <div style={{ marginTop: '6px' }}>
                      {hasDualCustody2of2 ? (
                        <span className="badge badge-emerald">CO-SIGNED (2/2 · 15m TTL)</span>
                      ) : (
                        <span className="badge badge-amber">AWAITING HARDWARE FIDO2 TAP</span>
                      )}
                    </div>
                  </div>

                  <div
                    style={{
                      padding: '10px 12px',
                      borderRadius: 'var(--radius-sm)',
                      backgroundColor: 'var(--bg-surface)',
                      border: '1px solid var(--border-subtle)'
                    }}
                  >
                    <div style={{ fontWeight: 700, marginBottom: '4px' }}>
                      Challenge &amp; Zero-Standing-Privilege TTL
                    </div>
                    <div className="mono" style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                      Challenge: {state.break_glass.webauthn_challenge || 'webauthn-chal-ready'}
                    </div>
                    <div
                      style={{
                        marginTop: '6px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '5px',
                        fontSize: '11.5px',
                        fontWeight: 700,
                        color: 'var(--accent-primary-ink)'
                      }}
                    >
                      <Clock size={12} />
                      <span>Max Elevation TTL: 15 Minutes (+8m RTO)</span>
                    </div>
                  </div>
                </div>

                <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    className="btn btn-emerald btn-sm"
                    onClick={handleCisoCoSign2of2}
                  >
                    <KeyRound size={13} />
                    <span>Co-Sign with Hardware FIDO2 Key (2/2 · 15m Max TTL)</span>
                  </button>

                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    onClick={() => {
                      const cosigned = coSignBreakGlassAsCiso(
                        updateRecoveryChoices(state, {
                          backup_mode: 'R2_OBJECT_LOCK_COMPLIANCE',
                          failover_strategy: 'WARM_STANDBY',
                          health_quorum_probes: 3,
                          access_strategy: 'DUAL_CUSTODY_BREAK_GLASS'
                        })
                      );
                      const executed = executeContainmentAndRecovery(cosigned, cosigned.choices);
                      const finalized = finalizeTabletopScorecard(executed);
                      setState(finalized);
                      recordSpan(
                        createResilienceSpan({
                          sessionId,
                          traceparent: finalized.traceparent,
                          method: 'POST',
                          path: '/api/resilience/ciso-cosign-and-recover',
                          status: 200,
                          latencyMs: 9,
                          origin: 'browser-webcrypto-fallback',
                          summary: {
                            status: 'VERIFIED_RECOVERED',
                            sla_tier: finalized.outcome?.sla_tier,
                            rto_minutes: finalized.outcome?.rto_minutes,
                            rpo_minutes: finalized.outcome?.rpo_minutes,
                            resilience_score: finalized.outcome?.resilience_score
                          }
                        })
                      );
                      updateTrapsFromState(finalized);
                    }}
                  >
                    <ShieldCheck size={13} />
                    <span>Co-Sign (2/2) + Execute Hardened Platinum Recovery</span>
                  </button>

                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => setActiveSeat('sre-war-room')}
                  >
                    <span>Return to Seat 1 (SRE War Room)</span>
                    <ArrowRight size={13} />
                  </button>
                </div>
              </div>
            </div>
          </section>
        )}

        {/* =====================================================================
            STAGE 3 / PHASE 4: DETERMINISTIC RTO/RPO SCORECARD & CHRONOLOGICAL TIMELINE
            ===================================================================== */}
        <section
          aria-label="Deterministic RTO RPO Scorecard and Post-Incident Timeline"
          className="pane"
        >
          <div className="pane-header">
            <span style={{ fontWeight: 700, fontSize: '12.5px', color: 'var(--text-primary)' }}>
              Stage 3 — Deterministic RTO/RPO Scorecard &amp; Chronological Post-Incident Timeline
            </span>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button type="button" className="btn btn-sm" onClick={handleCopyReport}>
                <Copy size={12} />
                <span>{copiedReport ? 'Copied JSON' : 'Copy Timeline JSON'}</span>
              </button>
              <button type="button" className="btn btn-sm" onClick={handleDownloadReport}>
                <Download size={12} />
                <span>Export JSON</span>
              </button>
            </div>
          </div>

          <div className="pane-body" style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            {/* Executive Scorecard Banner */}
            <div className={displayedOutcome.sla_met ? 'gate-card passed' : 'gate-card blocked'}>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  gap: '12px'
                }}
              >
                <div>
                  <div style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase' }}>
                    {state.outcome
                      ? 'Verified Executive Resilience Scorecard'
                      : 'Live Projected Resilience Scorecard (Click Execute Recovery to Lock In)'}
                  </div>
                  <div style={{ fontSize: '18px', fontWeight: 800 }}>
                    SLA Tier: {displayedOutcome.sla_tier}{' '}
                    {displayedOutcome.sla_met ? '(SLA MET)' : '(SLA BREACHED)'}
                  </div>
                </div>

                <div style={{ display: 'flex', gap: '18px', textAlign: 'right' }}>
                  <div>
                    <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>RTO</div>
                    <div style={{ fontSize: '17px', fontWeight: 800 }}>
                      {displayedOutcome.rto_minutes} min
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>RPO</div>
                    <div style={{ fontSize: '17px', fontWeight: 800 }}>
                      {displayedOutcome.rpo_minutes} min
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Score</div>
                    <div style={{ fontSize: '17px', fontWeight: 800 }}>
                      {displayedOutcome.resilience_score}/100
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* RTO & RPO Breakdown Grid */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
                gap: '12px'
              }}
            >
              <div
                style={{
                  padding: '12px 14px',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 'var(--radius-sm)',
                  backgroundColor: 'var(--bg-canvas)'
                }}
              >
                <div style={{ fontSize: '12px', fontWeight: 700, marginBottom: '6px' }}>
                  RTO Breakdown (Recovery Time Objective)
                </div>
                {displayedOutcome.rto_breakdown.map((b, idx) => (
                  <div
                    key={idx}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      fontSize: '12px',
                      padding: '4px 0',
                      borderBottom:
                        idx < displayedOutcome.rto_breakdown.length - 1
                          ? '1px dashed var(--border-subtle)'
                          : 'none'
                    }}
                  >
                    <span>{b.label}</span>
                    <strong className="mono">+{b.minutes}m</strong>
                  </div>
                ))}
              </div>

              <div
                style={{
                  padding: '12px 14px',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 'var(--radius-sm)',
                  backgroundColor: 'var(--bg-canvas)'
                }}
              >
                <div style={{ fontSize: '12px', fontWeight: 700, marginBottom: '6px' }}>
                  RPO Breakdown (Recovery Point Objective)
                </div>
                {displayedOutcome.rpo_breakdown.map((b, idx) => (
                  <div
                    key={idx}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      fontSize: '12px',
                      padding: '4px 0'
                    }}
                  >
                    <span>{b.label}</span>
                    <strong className="mono">{b.minutes}m</strong>
                  </div>
                ))}
              </div>
            </div>

            {/* Chronologically Sorted Post-Incident Timeline */}
            <div>
              <div
                style={{
                  fontSize: '12px',
                  fontWeight: 700,
                  marginBottom: '8px',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  gap: '8px'
                }}
              >
                <span>Chronological Post-Incident Timeline (Sorted by Ascending T+ Minutes)</span>
                <span className="mono" style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                  {displayedOutcome.post_incident_timeline
                    .map((e) => `+${e.t_plus_minutes}m`)
                    .join(' → ')}
                </span>
              </div>
              <div className="data-table-wrapper">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>T+</th>
                      <th>Phase</th>
                      <th>Action</th>
                      <th>Actor</th>
                      <th>Outcome</th>
                    </tr>
                  </thead>
                  <tbody>
                    {displayedOutcome.post_incident_timeline.map((entry, idx) => (
                      <tr key={idx}>
                        <td className="mono" style={{ fontWeight: 700 }}>
                          +{entry.t_plus_minutes}m
                        </td>
                        <td>
                          <span className="badge">{entry.phase}</span>
                        </td>
                        <td>{entry.action}</td>
                        <td className="mono" style={{ fontSize: '11.5px', color: 'var(--text-secondary)' }}>
                          {entry.actor}
                        </td>
                        <td>
                          <span
                            className={
                              entry.outcome === 'PASS'
                                ? 'badge badge-emerald'
                                : entry.outcome === 'BLOCKED'
                                  ? 'badge badge-crimson'
                                  : 'badge badge-amber'
                            }
                          >
                            {entry.outcome}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </section>

        {/* =====================================================================
            PHASE 4: REFLECTION DEBRIEF CARD (In-Flow)
            ===================================================================== */}
        <section
          aria-label="Phase 4 Reflection Debrief"
          style={{
            backgroundColor: 'var(--bg-surface)',
            border:
              state.outcome?.sla_tier === 'PLATINUM'
                ? '1.5px solid var(--accent-emerald)'
                : '1.5px solid var(--border-strong)',
            borderRadius: 'var(--radius-lg)',
            padding: '18px 20px',
            boxShadow: 'var(--shadow-sm)',
            display: 'flex',
            flexDirection: 'column',
            gap: '14px'
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '10px',
              flexWrap: 'wrap'
            }}
          >
            <div>
              <div
                style={{
                  fontSize: '11px',
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  letterSpacing: '0.06em',
                  color: 'var(--accent-emerald)'
                }}
              >
                Phase 4 · Reflection Debrief
              </div>
              <h2 style={{ fontSize: '16.5px', fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>
                Fail-Closed WORM Immutability, Quorum Failover &amp; 2-of-2 FIDO2 Break-Glass
              </h2>
            </div>

            <button type="button" className="btn btn-sm" onClick={handleReset}>
              <RotateCcw size={12} />
              <span>Restart Tabletop</span>
            </button>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))',
              gap: '10px'
            }}
          >
            <div
              style={{
                padding: '12px',
                borderRadius: 'var(--radius-sm)',
                backgroundColor: 'var(--bg-canvas)',
                border: '1px solid var(--border-subtle)',
                fontSize: '12px'
              }}
            >
              <strong style={{ display: 'block', marginBottom: '4px', color: 'var(--text-primary)' }}>
                1. WORM Immutability Defeats Wipers
              </strong>
              <span style={{ color: 'var(--text-secondary)' }}>
                <code>GOVERNANCE</code> backups can be bypassed by compromised admin tokens (RPO <code>1440m</code>).
                Cloudflare R2 <code>COMPLIANCE</code> mode enforces fail-closed <code>403 ObjectLockComplianceViolation</code>{' '}
                (RPO <code>5m</code>).
              </span>
            </div>

            <div
              style={{
                padding: '12px',
                borderRadius: 'var(--radius-sm)',
                backgroundColor: 'var(--bg-canvas)',
                border: '1px solid var(--border-subtle)',
                fontSize: '12px'
              }}
            >
              <strong style={{ display: 'block', marginBottom: '4px', color: 'var(--text-primary)' }}>
                2. IdP-Independent 2-of-2 FIDO2 Custody
              </strong>
              <span style={{ color: 'var(--text-secondary)' }}>
                During an upstream IdP <code>503</code> outage, single-admin bypasses fail with{' '}
                <code>403 BREAK_GLASS_QUORUM_REQUIRED</code>. Out-of-band SRE + CISO FIDO2 co-signing grants a scoped{' '}
                <code>15m</code> recovery window (<code>+8m</code> RTO).
              </span>
            </div>

            <div
              style={{
                padding: '12px',
                borderRadius: 'var(--radius-sm)',
                backgroundColor: 'var(--bg-canvas)',
                border: '1px solid var(--border-subtle)',
                fontSize: '12px'
              }}
            >
              <strong style={{ display: 'block', marginBottom: '4px', color: 'var(--text-primary)' }}>
                3. Quorum-Gated Warm-Standby Failover
              </strong>
              <span style={{ color: 'var(--text-secondary)' }}>
                Requiring <code>&gt;= 2</code> consecutive failed health probes before promoting{' '}
                <code>us-west-2</code> prevents flapping while cutting recovery time from <code>+240m</code> (Cold Rebuild)
                to <code>+12m</code> (<code>PLATINUM</code> RTO <code>20m</code>).
              </span>
            </div>
          </div>

          <div
            style={{
              padding: '12px 14px',
              borderRadius: 'var(--radius-sm)',
              backgroundColor: 'var(--bg-canvas)',
              border: '1px solid var(--border-subtle)',
              display: 'flex',
              flexDirection: 'column',
              gap: '8px'
            }}
          >
            <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-primary)' }}>
              Security Traps &amp; Negative Scenarios Explored ({testedTrapCount} / {trapChecklist.length})
            </div>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
                gap: '6px',
                fontSize: '12px'
              }}
            >
              {trapChecklist.map((trap) => (
                <div
                  key={trap.key}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '7px',
                    color: trap.tested ? 'var(--accent-emerald-ink)' : 'var(--text-muted)'
                  }}
                >
                  <CheckCircle2
                    size={14}
                    color={trap.tested ? '#059669' : '#cbd5e1'}
                    style={{ flexShrink: 0 }}
                  />
                  <span>{trap.label}</span>
                </div>
              ))}
            </div>
            <div style={{ fontSize: '11.5px', color: 'var(--text-muted)' }}>
              Open the sticky <strong>X-Ray Telemetry Drawer</strong> below to inspect live W3C{' '}
              <code>traceparent</code> spans, <code>POST /api/resilience/probe-delete</code> WORM responses, and
              2-of-2 FIDO2 attestation payloads.
            </div>
          </div>
        </section>
      </main>

      {/* 3. Sticky Bottom X-Ray Telemetry Drawer (Normal Document Flow) */}
      <XRayTelemetryDrawer
        spans={spans}
        decodedProofSections={decodedProofSections}
        onClear={() => setSpans([])}
      />
    </div>
  );
}

export default ResilienceTabletopPage;
