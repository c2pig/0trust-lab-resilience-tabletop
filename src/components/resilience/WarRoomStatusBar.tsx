import React from 'react';
import { CheckCircle2 } from 'lucide-react';
import {
  CrisisScenarioDefinition,
  ResilienceTabletopState,
  TabletopOutcome,
  TabletopStage
} from '../../contracts/resilienceContract';

export interface WarRoomStatusBarProps {
  state: ResilienceTabletopState;
  scenarioDef: CrisisScenarioDefinition;
  displayedOutcome: TabletopOutcome;
  machineBadgeClass: string;
  stage1Done: boolean;
  stage2Done: boolean;
  stage3Done: boolean;
  onSelectStage: (stage: TabletopStage) => void;
}

export function WarRoomStatusBar({
  state,
  scenarioDef,
  displayedOutcome,
  machineBadgeClass,
  stage1Done,
  stage2Done,
  stage3Done,
  onSelectStage
}: WarRoomStatusBarProps) {
  return (
    <>
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
          onClick={() => onSelectStage(1)}
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
          onClick={() => onSelectStage(2)}
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
          onClick={() => onSelectStage(3)}
        >
          <span style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span className="stage-number">3</span>
            <span>Phase 4 · RTO/RPO Scorecard &amp; Timeline</span>
          </span>
          {stage3Done && <CheckCircle2 size={15} color="#059669" />}
        </button>
      </div>
    </>
  );
}
