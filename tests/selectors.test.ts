import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  coSignBreakGlassAsCiso,
  createInitialTabletopState,
  injectCrisisScenario,
  PLATINUM_RECOVERY_CHOICES,
  requestCisoBreakGlassCosign,
  updateRecoveryChoices
} from '../src/engine/resilienceTabletopEngine';
import {
  deriveHasDualCustody2of2,
  deriveMachineBadgeClass,
  deriveResilienceSeats,
  deriveStage2GateStatus,
  deriveStageCompletion
} from '../src/engine/resilienceTabletopSelectors';

describe('Lab 9 (Resilience Tabletop) Layer 3 Selectors — DOM-free UI derivations', () => {
  it('derives dual-custody 2-of-2 flag and stage completion flags', () => {
    const initial = createInitialTabletopState();
    assert.equal(deriveHasDualCustody2of2(initial), false);
    assert.deepEqual(deriveStageCompletion(initial), {
      stage1Done: false,
      stage2Done: false,
      stage3Done: false
    });

    const crisis = injectCrisisScenario(initial, 'RANSOMWARE_PRIMARY_DB');
    assert.deepEqual(deriveStageCompletion(crisis), {
      stage1Done: true,
      stage2Done: false,
      stage3Done: false
    });

    const platinum = updateRecoveryChoices(crisis, PLATINUM_RECOVERY_CHOICES);
    assert.equal(deriveHasDualCustody2of2(platinum), true);
  });

  it('derives SRE and CISO seat badges across STEADY_STATE, PENDING_COSIGN, ACTIVE, and DENIED', () => {
    const initial = createInitialTabletopState();
    const steadySeats = deriveResilienceSeats(initial, false);
    assert.equal(steadySeats[0].badge?.text, 'Steady State');
    assert.equal(steadySeats[1].badge?.text, 'Standby');

    const crisis = injectCrisisScenario(initial, 'RANSOMWARE_PRIMARY_DB');
    const platinum = updateRecoveryChoices(crisis, PLATINUM_RECOVERY_CHOICES);
    const pending = requestCisoBreakGlassCosign(platinum);
    const pendingSeats = deriveResilienceSeats(pending, true);
    assert.equal(pendingSeats[0].badge?.text, 'Awaiting CISO FIDO2');
    assert.equal(pendingSeats[1].badge?.text, '● 1 Co-Sign Req');

    const approved = coSignBreakGlassAsCiso(pending);
    const approvedSeats = deriveResilienceSeats(approved, true);
    assert.equal(approvedSeats[1].badge?.text, '2-of-2 Co-Signed (15m)');

    const denied = {
      ...pending,
      break_glass: { ...pending.break_glass, status: 'DENIED' as const }
    };
    const deniedSeats = deriveResilienceSeats(denied, false);
    assert.equal(deniedSeats[1].badge?.text, '403 Quorum Denied');
  });

  it('derives Stage 2 gate statuses and machine badge classes', () => {
    const initial = createInitialTabletopState();
    assert.equal(deriveMachineBadgeClass('STEADY_STATE'), 'badge badge-blue');
    assert.equal(deriveMachineBadgeClass('VERIFIED_RECOVERED'), 'badge badge-emerald');
    assert.equal(deriveMachineBadgeClass('SLA_BREACHED'), 'badge badge-crimson');
    assert.equal(deriveMachineBadgeClass('RECOVERY_EXECUTING'), 'badge badge-amber');

    assert.equal(deriveStage2GateStatus(initial, { idpDown: true }, 0, 1), 'BLOCK');
    assert.equal(deriveStage2GateStatus(initial, { idpDown: true }, 0, 2), 'WARN');
    assert.equal(deriveStage2GateStatus(initial, { idpDown: true }, 0, 3), 'BLOCK');

    const platinum = updateRecoveryChoices(initial, PLATINUM_RECOVERY_CHOICES);
    assert.equal(deriveStage2GateStatus(platinum, { idpDown: true }, 0, 1), 'PASS');
    assert.equal(deriveStage2GateStatus(platinum, { idpDown: true }, 0, 2), 'PASS');
    assert.equal(deriveStage2GateStatus(platinum, { idpDown: true }, 0, 3), 'PASS');
    assert.equal(deriveStage2GateStatus(platinum, { idpDown: true }, 2, 2), 'CHECKING');
    assert.equal(deriveStage2GateStatus(platinum, { idpDown: true }, 3, 2), 'PASS');
  });
});
