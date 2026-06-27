'use client'

/**
 * <AuthShell>. The "Studio Ledger" auth scene for Tahi sign-in / sign-up.
 *
 * Layout: a two-column split on the cream canvas.
 *   Desktop (>= 64rem): forest panel 58% (immersive gradient + drifting
 *     glows + film grain + slow sheen, carrying the brand: wordmark, pill,
 *     headline, subcopy, peer testimonial, trust row) and a floating white
 *     card 42% holding the Clerk widget.
 *   Mobile (< 64rem): the forest collapses to a top band; the white card
 *     sits below it, pulled up -24px so it overlaps the seam; condensed
 *     trust proof renders under the card.
 *
 * The forest scene is an always-dark branded surface (like the sidebar):
 * its colours are hardcoded so they never flip with the app theme. The
 * white card is theme-pinned to light tokens so a visitor with dark mode
 * saved still gets a readable card (the (auth) group never applies .dark
 * to the card). Clerk renders the real form fields (Google, inputs,
 * submit, verification code, forgot-password, MFA); we only theme them via
 * `tahiClerkAppearance`. All decorative motion yields to
 * prefers-reduced-motion.
 */

import * as React from 'react'
import Link from 'next/link'
import { cn } from '@/lib/utils'
import { TahiStudioWordmark, LeafIcon } from '@/components/tahi/tahi-glyphs'

interface Testimonial {
  quote: string
  initials: string
  name: string
  role: string
}

interface TrustAvatar {
  /** Background colour of the placeholder avatar. */
  bg: string
  /** Optional "+N" chip text; when set the swatch renders as a count chip. */
  more?: string
}

interface AuthShellProps {
  /** Pill label on the forest panel ("The studio workspace"). */
  pill: string
  /** Large scene headline. */
  headline: string
  /** One-line subcopy under the headline. */
  sub?: string
  /** Peer testimonial shown on the panel (desktop only). */
  testimonial?: Testimonial
  /** Trust row (avatar stack + line). When set, bottom-anchors the scene
   *  on desktop and renders a condensed copy under the card on mobile. */
  trust?: { avatars: TrustAvatar[]; line: string }
  /** Vertically centre the scene content (sign-in) instead of
   *  space-between (sign-up). */
  centeredScene?: boolean
  /** Reassurance line under the form. */
  helperText?: string
  /** Render the Terms / Privacy legal line (sign-up). */
  showLegal?: boolean
  /** Footer switch row. */
  footerPrompt: string
  footerLinkLabel: string
  footerLinkHref: string
  /** The Clerk widget (ClerkSignIn / ClerkSignUp). */
  children: React.ReactNode
}

export function AuthShell({
  pill,
  headline,
  sub,
  testimonial,
  trust,
  centeredScene = false,
  helperText,
  showLegal = false,
  footerPrompt,
  footerLinkLabel,
  footerLinkHref,
  children,
}: AuthShellProps) {
  return (
    <div className="tahi-auth">
      <style>{AUTH_CSS}</style>

      {/* ── Forest scene ────────────────────────────────────────────── */}
      <aside className="tahi-auth-scene">
        <span className="ta-glow ta-g1" aria-hidden="true" />
        <span className="ta-glow ta-g2" aria-hidden="true" />
        <span className="ta-grain" aria-hidden="true" />
        <span className="ta-sheen" aria-hidden="true" />

        <div className={cn('ta-scene-content', centeredScene && 'ta-scene-centered')}>
          <div className="ta-wordmark">
            <TahiStudioWordmark height={28} title="Tahi Studio" />
          </div>

          <div className="ta-scene-mid">
            <span className="ta-pill">
              <span className="ta-pill-leaf" aria-hidden="true">
                <LeafIcon size={12} />
              </span>
              {pill}
            </span>
            <h2 className="ta-headline">{headline}</h2>
            {sub && <p className="ta-sub">{sub}</p>}

            {testimonial && (
              <figure className="ta-glass ta-testimonial">
                <blockquote className="ta-quote">{testimonial.quote}</blockquote>
                <figcaption className="ta-figc">
                  <span className="ta-avatar" aria-hidden="true">{testimonial.initials}</span>
                  <span className="ta-figc-text">
                    <span className="ta-figc-name">{testimonial.name}</span>
                    <span className="ta-figc-role">{testimonial.role}</span>
                  </span>
                </figcaption>
              </figure>
            )}
          </div>

          {trust && (
            <div className="ta-trust">
              <div className="ta-avatars" aria-hidden="true">
                {trust.avatars.map((a, i) => (
                  <span
                    key={i}
                    className={cn('ta-av', a.more && 'ta-av-more')}
                    style={{ background: a.bg }}
                  >
                    {a.more}
                  </span>
                ))}
              </div>
              <span className="ta-trust-line">{trust.line}</span>
            </div>
          )}
        </div>
      </aside>

      {/* ── Form column ─────────────────────────────────────────────── */}
      <main className="tahi-auth-form">
        <section className="tahi-auth-card ta-card-enter">
          {/* Card heading is Clerk-owned per step (sign-up / verify / sign-in),
              with wording set via ClerkProvider localization in app/layout.tsx. */}
          {children}

          {helperText && <p className="ta-helper">{helperText}</p>}

          {showLegal && (
            <p className="ta-legal">
              By continuing you agree to our{' '}
              <a href="/terms">Terms</a> and <a href="/privacy">Privacy Policy</a>.
            </p>
          )}

          <div className="ta-switch">
            <span>{footerPrompt} </span>
            {/^(mailto:|tel:|https?:)/.test(footerLinkHref) ? (
              <a href={footerLinkHref} className="ta-swlink">{footerLinkLabel}</a>
            ) : (
              <Link href={footerLinkHref} className="ta-swlink">{footerLinkLabel}</Link>
            )}
          </div>
        </section>

        {trust && (
          <div className="ta-trust-mobile">
            <div className="ta-avatars" aria-hidden="true">
              {trust.avatars.map((a, i) => (
                <span
                  key={i}
                  className={cn('ta-av ta-av-sm', a.more && 'ta-av-more')}
                  style={{ background: a.bg }}
                >
                  {a.more}
                </span>
              ))}
            </div>
            <span className="ta-trust-line">{trust.line}</span>
          </div>
        )}
      </main>
    </div>
  )
}

// Default trust avatar palette (placeholder swatches; swap for real client
// avatars when available). The last entry is the "+N" count chip.
export const TAHI_TRUST_AVATARS: TrustAvatar[] = [
  { bg: '#C99A6A' },
  { bg: '#7aab6b' },
  { bg: '#5b7da0' },
  { bg: '#b06a8a' },
  { bg: '#3C5733', more: '+12' },
]

// ──────────────────────────────────────────────────────────────────────
// Scene + card CSS. Scoped under .tahi-auth so the generic class names
// (.scene, .pill, .glass) can't collide with anything global. The forest
// colours are hardcoded (always-dark surface, like the sidebar); the card
// pins light tokens so it survives a dark-mode-saved visitor.
// ──────────────────────────────────────────────────────────────────────
const GRAIN =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='200'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.55'/%3E%3C/svg%3E\")"

const AUTH_CSS = `
.tahi-auth{ min-height:100vh; display:grid; grid-template-columns:58% 42%; background:#F7F6F3; font-family:'Manrope',var(--font-sans, sans-serif); overflow-x:hidden; }
.tahi-auth *{ box-sizing:border-box; }

/* ---- scene ---- */
.tahi-auth-scene{ position:relative; overflow:hidden; background-color:#13200C;
  background-image:radial-gradient(125% 100% at 50% 118%, #0c1607 0%, rgba(12,22,7,0) 58%), linear-gradient(162deg, #1F3719 0%, #172810 46%, #0E1C09 100%); }
.ta-glow{ position:absolute; border-radius:50%; pointer-events:none; z-index:0; mix-blend-mode:screen; filter:blur(52px); }
.ta-g1{ width:760px; height:760px; top:-220px; left:-160px; background:radial-gradient(circle, rgba(141,189,120,0.38) 0%, rgba(141,189,120,0) 62%); animation:ta-aurora1 17s ease-in-out infinite; }
.ta-g2{ width:680px; height:680px; bottom:-240px; right:-170px; background:radial-gradient(circle, rgba(72,132,96,0.32) 0%, rgba(72,132,96,0) 64%); animation:ta-aurora2 21s ease-in-out infinite; }
.ta-grain{ position:absolute; inset:0; pointer-events:none; z-index:1; background-image:${GRAIN}; background-size:200px 200px; mix-blend-mode:soft-light; opacity:.4; }
.ta-sheen{ position:absolute; width:560px; height:560px; left:32%; top:22%; border-radius:50%; z-index:0; pointer-events:none; mix-blend-mode:screen; filter:blur(56px); background:radial-gradient(circle, rgba(168,196,118,0.16) 0%, rgba(168,196,118,0) 66%); animation:ta-aurora3 25s ease-in-out infinite; }
.ta-scene-content{ position:relative; z-index:2; height:100%; padding:56px; display:flex; flex-direction:column; justify-content:space-between; }
.ta-scene-centered{ justify-content:flex-start; }
.ta-scene-centered .ta-scene-mid{ flex:1; display:flex; flex-direction:column; justify-content:center; }

@keyframes ta-aurora1{ 0%{ transform:translate(-10%,-8%) scale(1); } 50%{ transform:translate(7%,5%) scale(1.18); } 100%{ transform:translate(-10%,-8%) scale(1); } }
@keyframes ta-aurora2{ 0%{ transform:translate(9%,7%) scale(1.12); } 50%{ transform:translate(-5%,-6%) scale(0.94); } 100%{ transform:translate(9%,7%) scale(1.12); } }
@keyframes ta-aurora3{ 0%{ transform:translate(0,0) scale(1); } 50%{ transform:translate(-9%,7%) scale(1.16); } 100%{ transform:translate(0,0) scale(1); } }
@keyframes ta-cardup{ from{ opacity:0; transform:translateY(10px); } to{ opacity:1; transform:translateY(0); } }

.ta-wordmark{ color:#FDFDFC; }
/* align-self + width:fit-content keep the pill hugging its text even when the
   scene column is a flex container (sign-in / centeredScene), where flex
   children otherwise stretch to full width. */
.ta-pill{ display:inline-flex; align-self:flex-start; width:fit-content; align-items:center; gap:8px; height:28px; padding:0 12px; border-radius:0 .625rem 0 .625rem; background:rgba(255,255,255,0.06); border:1px solid rgba(255,255,255,0.14); font-size:13px; font-weight:600; color:#DCE8D9; }
.ta-pill-leaf{ display:inline-flex; color:#7aab6b; }
.ta-headline{ margin:22px 0 0; font-size:36px; line-height:1.05; font-weight:700; letter-spacing:-0.025em; color:#FDFDFC; max-width:20ch; text-wrap:balance; }
.ta-sub{ margin:18px 0 0; font-size:15px; line-height:1.6; color:#DCE8D9; max-width:40ch; }

.ta-glass{ background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.12); backdrop-filter:blur(12px); -webkit-backdrop-filter:blur(12px); border-radius:.5rem; padding:20px; }
.ta-testimonial{ margin:36px 0 0; max-width:30rem; }
.ta-quote{ margin:0; font-size:15px; line-height:1.55; color:#FDFDFC; }
.ta-figc{ margin-top:16px; display:flex; align-items:center; gap:12px; }
.ta-avatar{ width:40px; height:40px; border-radius:50%; flex-shrink:0; background:linear-gradient(140deg,#7aab6b,#425F39); display:flex; align-items:center; justify-content:center; font-weight:700; font-size:14px; color:#fff; }
.ta-figc-text{ display:flex; flex-direction:column; line-height:1.4; }
.ta-figc-name{ font-size:14px; font-weight:600; color:#FDFDFC; }
.ta-figc-role{ font-size:13px; color:#DCE8D9; }

.ta-trust{ display:flex; flex-direction:column; gap:12px; }
.ta-avatars{ display:flex; }
.ta-av{ width:28px; height:28px; border-radius:50%; border:2px solid #1E3019; }
.ta-av + .ta-av{ margin-left:-8px; }
.ta-av-more{ display:flex; align-items:center; justify-content:center; font:700 10px 'Manrope'; color:#E6EFE2; }
.ta-av-sm{ width:24px; height:24px; border:2px solid #F7F6F3; }
.ta-av-sm + .ta-av-sm{ margin-left:-7px; }
.ta-trust-line{ font-size:13px; color:#DCE8D9; line-height:1.4; }

/* ---- form column + card ---- */
.tahi-auth-form{ display:flex; align-items:center; justify-content:center; padding:40px; }
.tahi-auth-card{ position:relative; z-index:3; width:100%; max-width:440px; margin:0 auto; background:#fff; border-radius:0 1.5rem 0 1.5rem; box-shadow:0 24px 48px -24px rgba(26,25,20,0.18); padding:40px;
  /* theme-pin: the card stays light even if .dark is set on <html> */
  --color-text:#121A0F; --color-text-muted:#5D5B55; --color-text-subtle:#63615B;
  --color-bg:#ffffff; --color-bg-secondary:#F4F3EF;
  --color-border:rgba(26,25,20,0.10); --color-border-strong:rgba(26,25,20,0.16);
  --color-brand:#5A824E; --color-brand-dark:#425F39; --color-brand-deep:#2A3626; --color-brand-100:#dcefd8; }
.ta-card-enter{ animation:ta-cardup .45s cubic-bezier(.22,1,.36,1) both; animation-delay:.08s; }
.ta-card-title{ margin:0; font-size:21px; font-weight:600; letter-spacing:-0.01em; color:#121A0F; }
.ta-card-sub{ margin:6px 0 24px; font-size:14px; color:#5D5B55; }
.ta-helper{ margin:12px 0 0; font-size:13px; line-height:1.5; color:#5D5B55; }
.ta-legal{ margin:16px 0 0; font-size:12px; line-height:1.5; color:#63615B; }
.ta-legal a{ color:#5D5B55; font-weight:600; text-decoration:none; }
.ta-legal a:hover{ text-decoration:underline; }
.ta-switch{ margin-top:20px; padding-top:20px; border-top:1px solid rgba(26,25,20,0.08); text-align:center; font-size:13px; color:#5D5B55; }
.ta-swlink{ color:#425F39; font-weight:700; text-decoration:none; }
.ta-swlink:hover{ text-decoration:underline; }
.ta-trust-mobile{ display:none; }

/* wordmark: keep intrinsic ratio, never let flex/resets stretch the svg */
.ta-wordmark svg{ display:block; height:28px; width:auto; }

/* ---- Clerk widget, themed via stable cl-* classes (robust regardless of
   whether the appearance Tailwind classes get generated). Scoped to the
   card so it inherits the pinned light tokens and can't leak elsewhere. ---- */
/* overflow:visible on every Clerk wrapper: Clerk's defaults set overflow:hidden,
   which clips the Google button's top corners (and any focus ring) against the
   rounded card edge. */
.tahi-auth-card .cl-rootBox{ width:100%; overflow:visible; }
.tahi-auth-card .cl-cardBox,
.tahi-auth-card .cl-card{ width:100%; max-width:100%; margin:0; padding:0; border:0; background:transparent; box-shadow:none; overflow:visible; gap:16px; }
.tahi-auth-card .cl-footer{ display:none; }
/* Clerk owns the per-step heading (wording via localization). Style it to
   match the card. */
.tahi-auth-card .cl-header{ display:flex; flex-direction:column; gap:6px; text-align:left; margin:0 0 8px; }
.tahi-auth-card .cl-headerTitle{ font:600 21px 'Manrope',sans-serif; letter-spacing:-0.01em; color:#121A0F; }
.tahi-auth-card .cl-headerSubtitle{ font:400 14px 'Manrope',sans-serif; color:#5D5B55; line-height:1.5; }
.tahi-auth-card .cl-main{ width:100%; gap:16px; overflow:visible; }

.tahi-auth-card .cl-socialButtons{ width:100%; gap:10px; overflow:visible; }
.tahi-auth-card .cl-socialButtonsBlockButton{ width:100%; min-height:48px; overflow:visible; display:flex; align-items:center; justify-content:center; gap:10px; border:1px solid rgba(26,25,20,0.16); border-radius:.5rem; background:#fff; color:#121A0F; font:600 15px 'Manrope',sans-serif; text-transform:none; box-shadow:none; transition:background .15s, box-shadow .15s; }
.tahi-auth-card .cl-socialButtonsBlockButton:hover{ background:#F4F3EF; box-shadow:0 1px 3px rgba(26,25,20,0.1); }
.tahi-auth-card .cl-socialButtonsBlockButtonText{ font:600 15px 'Manrope',sans-serif; color:#121A0F; }

.tahi-auth-card .cl-dividerRow{ margin:4px 0; }
.tahi-auth-card .cl-dividerLine{ background:rgba(26,25,20,0.12); }
.tahi-auth-card .cl-dividerText{ color:#63615B; font-size:13px; text-transform:none; }

.tahi-auth-card .cl-form{ width:100%; gap:14px; }
.tahi-auth-card .cl-formField{ gap:8px; }
.tahi-auth-card .cl-formFieldLabel{ font:600 13px 'Manrope',sans-serif; color:#121A0F; }
.tahi-auth-card .cl-formFieldInput{ width:100%; height:48px; padding:0 14px; border:1px solid rgba(26,25,20,0.16); border-radius:.5rem; background:#fff; font:400 16px 'Manrope',sans-serif; color:#121A0F; box-shadow:none; transition:border-color .15s, box-shadow .15s; }
.tahi-auth-card .cl-formFieldInput::placeholder{ color:#9b9a94; }
.tahi-auth-card .cl-formFieldInput:focus,
.tahi-auth-card .cl-formFieldInput:focus-visible{ border-color:#5A824E; box-shadow:0 0 0 3px rgba(90,130,78,0.25); outline:none; }

.tahi-auth-card .cl-formButtonPrimary{ width:100%; height:48px; border:0; border-radius:.5rem; background:#425F39; color:#fff; font:600 16px 'Manrope',sans-serif; text-transform:none; letter-spacing:0; box-shadow:none; transition:background .2s cubic-bezier(.22,1,.36,1); }
.tahi-auth-card .cl-formButtonPrimary:hover{ background:#2A3626; }
.tahi-auth-card .cl-formButtonPrimary:focus-visible{ outline:2px solid #425F39; outline-offset:2px; }

.tahi-auth-card .cl-formFieldInputShowPasswordButton{ color:#63615B; }
.tahi-auth-card .cl-formFieldAction,
.tahi-auth-card .cl-footerActionLink,
.tahi-auth-card .cl-formResendCodeLink,
.tahi-auth-card .cl-identityPreviewEditButton{ color:#425F39; font-weight:600; }

.tahi-auth-card .cl-otpCodeFieldInputs{ gap:8px; justify-content:space-between; }
.tahi-auth-card .cl-otpCodeFieldInput{ flex:1; height:48px; border:1px solid rgba(26,25,20,0.16); border-radius:.5rem; font:600 16px 'Manrope',sans-serif; color:#121A0F; }
.tahi-auth-card .cl-otpCodeFieldInput:focus{ border-color:#5A824E; box-shadow:0 0 0 3px rgba(90,130,78,0.25); outline:none; }

.tahi-auth-card .cl-formFieldErrorText{ color:#c0463d; font-size:13px; }
.tahi-auth-card .cl-alert{ border-radius:10px; border:1px solid rgba(192,70,61,0.35); background:rgba(224,88,79,0.06); }
.tahi-auth-card .cl-alertText{ color:#a83b33; font-size:13.5px; }

/* ---- responsive ---- */
@media (max-width: 63.99rem){
  .tahi-auth{ display:flex; flex-direction:column; }
  .tahi-auth-scene{ min-height:300px; }
  .ta-scene-content{ padding:34px 26px; justify-content:flex-start; }
  .ta-scene-mid{ margin-top:18px; }
  .ta-scene-centered .ta-scene-mid{ flex:initial; display:block; }
  .ta-headline{ font-size:23px; max-width:18ch; }
  .ta-sub{ font-size:14px; margin-top:10px; }
  .ta-testimonial{ display:none; }
  .ta-trust{ display:none; }
  .tahi-auth-form{ flex-direction:column; align-items:stretch; padding:0 16px 24px; margin-top:-24px; }
  .tahi-auth-card{ border-radius:0 1.25rem 0 1.25rem; padding:24px; box-shadow:0 18px 40px -22px rgba(26,25,20,0.22); }
  .ta-trust-mobile{ display:flex; align-items:center; gap:11px; padding:18px 8px 4px; }
  .ta-trust-mobile .ta-trust-line{ color:#5D5B55; font-size:12px; }
  .ta-av-sm{ border-color:#F7F6F3; }
}

/* ---- motion safety ---- */
@media (prefers-reduced-motion: reduce){
  .ta-glow, .ta-sheen, .ta-card-enter{ animation:none !important; }
}
`

/**
 * Shared Clerk appearance preset for sign-in and sign-up. Strips Clerk's own
 * chrome (card, header, footer) so our shell owns the layout, and themes the
 * Clerk-rendered elements (Google button, inputs, primary submit, divider,
 * OTP, errors) to match the Studio Ledger card. Colours use the design's
 * values, which map to the light tokens pinned on `.tahi-auth-card`.
 */
export const tahiClerkAppearance = {
  layout: {
    // Google on top, fields below the "or" divider (matches the design).
    socialButtonsPlacement: 'top',
    showOptionalFields: true,
  },
  elements: {
    // The full visual theming lives in the scoped `.cl-*` CSS in this file
    // (more reliable than Tailwind classes injected into Clerk). Clerk owns
    // the per-step heading (sign-up / verify / sign-in); the wording comes
    // from ClerkProvider localization in app/layout.tsx. We only hide Clerk's
    // footer so our own switch link owns that row.
    footer: 'hidden',
  },
} as const
