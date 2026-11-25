import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CRISIS_SCENARIOS,
  CrisisScenarioId,
  GateStatus,
  R2MutationAction,
  RecoveryChoices,
  RedTeamScenarioId,
  ResilienceSeatId,
  ResilienceTabletopState,
  TabletopStage
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
import { RoleSeatItem } from '../components/RoleSwitcherBar';
import { XRayDecodedProofSection } from '../components/XRayTelemetryDrawer';
import { ObservabilitySpan } from '../types';

export interface ExploredResilienceTraps {
  r2UnlockedTrap: boolean;
  r2ComplianceHeld9A: boolean;
  breakGlassQuorumDenied9B: boolean;
  coldRebuildSlaBreach9C: boolean;
  cisoDualCustodyPlatinum: boolean;
}

export interface TrapChecklistItem {
  key: string;
  label: string;
  tested: boolean;
}

const INITIAL_TRAPS: ExploredResilienceTraps = {
  r2UnlockedTrap: false,
  r2ComplianceHeld9A: false,
  breakGlassQuorumDenied9B: false,
  coldRebuildSlaBreach9C: false,
  cisoDualCustodyPlatinum: false
};

export function useResilienceTabletop() {
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

  const handleCisoCoSignAndRecover = () => {
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

  const trapChecklist: TrapChecklistItem[] = [
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

  return {
    activeSeat,
    setActiveSeat,
    state,
    probeAction,
    setProbeAction,
    probingR2,
    isAutoPlaying,
    animatingGate,
    copiedReport,
    spans,
    setSpans,
    scenarioDef,
    displayedOutcome,
    stage1Done,
    stage2Done,
    stage3Done,
    hasDualCustody2of2,
    seats,
    machineBadgeClass,
    trapChecklist,
    testedTrapCount,
    decodedProofSections,
    getStage2GateStatus,
    handleSelectStage,
    handleReset,
    handleInjectCrisis,
    handleUpdateChoices,
    handleProbeR2,
    handleRequestCisoCosign,
    handleCisoCoSign2of2,
    handleCisoCoSignAndRecover,
    handleExecuteRecovery,
    handleFinalizeScorecard,
    handleHardenAllStage2,
    handleRunRedTeam,
    handleGuidedWalkthrough,
    handleCopyReport,
    handleDownloadReport
  };
}
