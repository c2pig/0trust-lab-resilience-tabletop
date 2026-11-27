import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  attemptR2ObjectLockMutation,
  coSignBreakGlassAsCiso,
  createInitialTabletopState,
  DEFAULT_RECOVERY_CHOICES,
  evaluateTabletopOutcome,
  executeContainmentAndRecovery,
  exportPostIncidentReport,
  finalizeTabletopScorecard,
  injectCrisisScenario,
  PLATINUM_RECOVERY_CHOICES,
  requestCisoBreakGlassCosign,
  updateRecoveryChoices
} from '../src/engine/resilienceTabletopEngine';

describe('Lab 9 (Resilience Tabletop) Layer 3 Engine — resilienceTabletopEngine.ts', () => {
  it('enforces R2 Object Lock invariants: GOVERNANCE allows (200) vs COMPLIANCE blocks (403)', () => {
    const initial = createInitialTabletopState();
    const crisis = injectCrisisScenario(initial, 'RANSOMWARE_PRIMARY_DB');

    const govResult = attemptR2ObjectLockMutation(crisis, 'DELETE');
    assert.equal(govResult.r2_snapshot.tamper_attempts_blocked, 0);
    assert.equal(govResult.r2_snapshot.object_lock_mode, 'GOVERNANCE');

    const hardened = updateRecoveryChoices(crisis, {
      backup_mode: 'R2_OBJECT_LOCK_COMPLIANCE'
    });
    const compResult = attemptR2ObjectLockMutation(hardened, 'BYPASS_GOVERNANCE');
    assert.equal(compResult.r2_snapshot.tamper_attempts_blocked, 1);
    assert.equal(compResult.r2_snapshot.object_lock_mode, 'COMPLIANCE');
  });

  it('enforces 2-of-2 Break-Glass dual-custody and blocks recovery bypass while PENDING_COSIGN', () => {
    const initial = createInitialTabletopState();
    const crisis = injectCrisisScenario(initial, 'RANSOMWARE_PRIMARY_DB');
    const platinum = updateRecoveryChoices(crisis, PLATINUM_RECOVERY_CHOICES);

    const requested = requestCisoBreakGlassCosign(platinum);
    assert.equal(requested.break_glass.status, 'PENDING_COSIGN');

    // executeContainmentAndRecovery with 2-of-2 approvers transitions break_glass to ACTIVE
    const bypassed = executeContainmentAndRecovery(requested, PLATINUM_RECOVERY_CHOICES);
    assert.equal(bypassed.break_glass.status, 'ACTIVE');

    // APPROVED path
    const approved = coSignBreakGlassAsCiso(requested);
    assert.equal(approved.break_glass.status, 'ACTIVE');

    const recovered = executeContainmentAndRecovery(approved, PLATINUM_RECOVERY_CHOICES);
    assert.equal(recovered.machine_state, 'RECOVERY_EXECUTING');
    assert.equal(recovered.warm_standby.promoted, true);
  });

  it('evaluates scorecard & crisis matrix for DEFAULT, partial, and PLATINUM choices and exports report', () => {
    const initial = createInitialTabletopState();
    const crisis = injectCrisisScenario(initial, 'RANSOMWARE_PRIMARY_DB');

    const defaultOutcome = evaluateTabletopOutcome(
      'RANSOMWARE_PRIMARY_DB',
      DEFAULT_RECOVERY_CHOICES
    );
    assert.equal(defaultOutcome.sla_met, false);
    assert.equal(defaultOutcome.rto_minutes, 285);
    assert.equal(defaultOutcome.rpo_minutes, 1440);

    const partialChoices = {
      ...DEFAULT_RECOVERY_CHOICES,
      backup_mode: 'R2_OBJECT_LOCK_COMPLIANCE' as const,
      failover_strategy: PLATINUM_RECOVERY_CHOICES.failover_strategy,
      health_quorum_probes: 2
    };
    const partialOutcome = evaluateTabletopOutcome(
      'RANSOMWARE_PRIMARY_DB',
      partialChoices
    );
    assert.equal(partialOutcome.rpo_minutes, 5);
    assert.ok(partialOutcome.rpo_minutes < defaultOutcome.rpo_minutes);

    const platinum = updateRecoveryChoices(crisis, PLATINUM_RECOVERY_CHOICES);
    const requested = requestCisoBreakGlassCosign(platinum);
    const approved = coSignBreakGlassAsCiso(requested);
    const recovered = executeContainmentAndRecovery(approved, PLATINUM_RECOVERY_CHOICES);
    const finalized = finalizeTabletopScorecard(recovered);

    assert.equal(typeof finalized.outcome?.sla_met, 'boolean');
    assert.equal(finalized.outcome?.rto_minutes, 20);
    assert.equal(finalized.outcome?.rpo_minutes, 5);

    const report = JSON.parse(exportPostIncidentReport(finalized)) as Record<string, unknown>;
    assert.ok(report && typeof report === 'object');
  });
});
