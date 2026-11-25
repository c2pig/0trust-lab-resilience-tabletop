import React from 'react';
import { ArrowLeft, Play, RotateCcw } from 'lucide-react';
import { RoleSwitcherBar } from '../components/RoleSwitcherBar';
import { XRayTelemetryDrawer } from '../components/XRayTelemetryDrawer';
import { CisoCosignerSeat } from '../components/resilience/CisoCosignerSeat';
import { ExecutiveScorecardSection } from '../components/resilience/ExecutiveScorecardSection';
import { SreWarRoomSeat } from '../components/resilience/SreWarRoomSeat';
import { WarRoomStatusBar } from '../components/resilience/WarRoomStatusBar';
import { useResilienceTabletop } from '../hooks/useResilienceTabletop';

export interface ResilienceTabletopPageProps {
  onBack: () => void;
}

export function ResilienceTabletopPage({ onBack }: ResilienceTabletopPageProps) {
  const {
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
  } = useResilienceTabletop();

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

        <WarRoomStatusBar
          state={state}
          scenarioDef={scenarioDef}
          displayedOutcome={displayedOutcome}
          machineBadgeClass={machineBadgeClass}
          stage1Done={stage1Done}
          stage2Done={stage2Done}
          stage3Done={stage3Done}
          onSelectStage={handleSelectStage}
        />

        {activeSeat === 'sre-war-room' && (
          <SreWarRoomSeat
            state={state}
            scenarioDef={scenarioDef}
            animatingGate={animatingGate}
            stage1Done={stage1Done}
            probeAction={probeAction}
            probingR2={probingR2}
            hasDualCustody2of2={hasDualCustody2of2}
            getStage2GateStatus={getStage2GateStatus}
            onSetProbeAction={setProbeAction}
            onInjectCrisis={handleInjectCrisis}
            onSelectStage={handleSelectStage}
            onHardenAllStage2={handleHardenAllStage2}
            onUpdateChoices={handleUpdateChoices}
            onProbeR2={handleProbeR2}
            onRequestCisoCosign={handleRequestCisoCosign}
            onSelectSeat={setActiveSeat}
            onExecuteRecovery={handleExecuteRecovery}
            onFinalizeScorecard={handleFinalizeScorecard}
            onRunRedTeam={handleRunRedTeam}
          />
        )}

        {activeSeat === 'ciso-cosigner' && (
          <CisoCosignerSeat
            state={state}
            hasDualCustody2of2={hasDualCustody2of2}
            onCisoCoSign2of2={handleCisoCoSign2of2}
            onCisoCoSignAndRecover={handleCisoCoSignAndRecover}
            onSelectSeat={setActiveSeat}
          />
        )}

        <ExecutiveScorecardSection
          state={state}
          displayedOutcome={displayedOutcome}
          copiedReport={copiedReport}
          trapChecklist={trapChecklist}
          testedTrapCount={testedTrapCount}
          onCopyReport={handleCopyReport}
          onDownloadReport={handleDownloadReport}
          onReset={handleReset}
        />
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
