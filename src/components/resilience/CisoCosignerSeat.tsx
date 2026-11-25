import React from 'react';
import { ArrowRight, Clock, KeyRound, ShieldCheck, UserCheck } from 'lucide-react';
import { ResilienceSeatId, ResilienceTabletopState } from '../../contracts/resilienceContract';

export interface CisoCosignerSeatProps {
  state: ResilienceTabletopState;
  hasDualCustody2of2: boolean;
  onCisoCoSign2of2: () => void;
  onCisoCoSignAndRecover: () => void;
  onSelectSeat: (seat: ResilienceSeatId) => void;
}

export function CisoCosignerSeat({
  state,
  hasDualCustody2of2,
  onCisoCoSign2of2,
  onCisoCoSignAndRecover,
  onSelectSeat
}: CisoCosignerSeatProps) {
  return (
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
              onClick={onCisoCoSign2of2}
            >
              <KeyRound size={13} />
              <span>Co-Sign with Hardware FIDO2 Key (2/2 · 15m Max TTL)</span>
            </button>

            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={onCisoCoSignAndRecover}
            >
              <ShieldCheck size={13} />
              <span>Co-Sign (2/2) + Execute Hardened Platinum Recovery</span>
            </button>

            <button
              type="button"
              className="btn btn-sm"
              onClick={() => onSelectSeat('sre-war-room')}
            >
              <span>Return to Seat 1 (SRE War Room)</span>
              <ArrowRight size={13} />
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
