import type {
  CrisisScenarioDefinition,
  GateStatus,
  ResilienceSeatId,
  ResilienceTabletopState
} from '../contracts/resilienceContract';

export interface ResilienceSeatItem {
  id: ResilienceSeatId;
  name: string;
  roleLabel: string;
  appLabel: string;
  avatarInitials: string;
  badge?: {
    text: string;
    tone: 'neutral' | 'emerald' | 'amber' | 'crimson' | 'blue';
    pulse?: boolean;
  };
}

/**
 * Derives whether 2-of-2 dual-custody break-glass is configured in Stage 2 choices.
 */
export function deriveHasDualCustody2of2(state: ResilienceTabletopState): boolean {
  return (
    state.choices.access_strategy === 'DUAL_CUSTODY_BREAK_GLASS' &&
    state.choices.dual_custody_approvers.length >= 2
  );
}

/**
 * Derives the stage completion flags for the 3-stage tabletop workflow.
 */
export function deriveStageCompletion(state: ResilienceTabletopState): {
  stage1Done: boolean;
  stage2Done: boolean;
  stage3Done: boolean;
} {
  return {
    stage1Done: state.machine_state !== 'STEADY_STATE',
    stage2Done:
      state.machine_state === 'RECOVERY_EXECUTING' ||
      state.machine_state === 'VERIFIED_RECOVERED' ||
      state.machine_state === 'SLA_BREACHED',
    stage3Done:
      state.machine_state === 'VERIFIED_RECOVERED' || state.machine_state === 'SLA_BREACHED'
  };
}

/**
 * Derives the 2-Seat Role Switcher configuration (SRE War Room + CISO Out-of-Band Co-Signer).
 */
export function deriveResilienceSeats(
  state: ResilienceTabletopState,
  hasDualCustody2of2: boolean
): ResilienceSeatItem[] {
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
}

/**
 * Derives the live Stage 2 gate status for backup (1), failover (2), and access (3).
 */
export function deriveStage2GateStatus(
  state: ResilienceTabletopState,
  scenarioDef: Pick<CrisisScenarioDefinition, 'idpDown'>,
  animatingGate: number,
  gate: 1 | 2 | 3
): GateStatus {
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
}

/**
 * Derives the CSS badge class for the current crisis machine state.
 */
export function deriveMachineBadgeClass(
  machineState: ResilienceTabletopState['machine_state']
): string {
  if (machineState === 'VERIFIED_RECOVERED') return 'badge badge-emerald';
  if (machineState === 'SLA_BREACHED') return 'badge badge-crimson';
  if (machineState === 'STEADY_STATE') return 'badge badge-blue';
  return 'badge badge-amber';
}
