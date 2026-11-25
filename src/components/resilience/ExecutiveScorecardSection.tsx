import React from 'react';
import { CheckCircle2, Copy, Download, RotateCcw } from 'lucide-react';
import { ResilienceTabletopState, TabletopOutcome } from '../../contracts/resilienceContract';
import { TrapChecklistItem } from '../../hooks/useResilienceTabletop';

export interface ExecutiveScorecardSectionProps {
  state: ResilienceTabletopState;
  displayedOutcome: TabletopOutcome;
  copiedReport: boolean;
  trapChecklist: TrapChecklistItem[];
  testedTrapCount: number;
  onCopyReport: () => Promise<void>;
  onDownloadReport: () => void;
  onReset: () => void;
}

export function ExecutiveScorecardSection({
  state,
  displayedOutcome,
  copiedReport,
  trapChecklist,
  testedTrapCount,
  onCopyReport,
  onDownloadReport,
  onReset
}: ExecutiveScorecardSectionProps) {
  return (
    <>
      {/* STAGE 3 / PHASE 4: DETERMINISTIC RTO/RPO SCORECARD & CHRONOLOGICAL TIMELINE */}
      <section
        aria-label="Deterministic RTO RPO Scorecard and Post-Incident Timeline"
        className="pane"
      >
        <div className="pane-header">
          <span style={{ fontWeight: 700, fontSize: '12.5px', color: 'var(--text-primary)' }}>
            Stage 3 — Deterministic RTO/RPO Scorecard &amp; Chronological Post-Incident Timeline
          </span>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button type="button" className="btn btn-sm" onClick={() => void onCopyReport()}>
              <Copy size={12} />
              <span>{copiedReport ? 'Copied JSON' : 'Copy Timeline JSON'}</span>
            </button>
            <button type="button" className="btn btn-sm" onClick={onDownloadReport}>
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

      {/* PHASE 4: REFLECTION DEBRIEF CARD (In-Flow) */}
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

          <button type="button" className="btn btn-sm" onClick={onReset}>
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
    </>
  );
}
