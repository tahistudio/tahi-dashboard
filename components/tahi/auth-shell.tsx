'use client'

/**
 * <AuthShell>. The "Studio Ledger" auth scene for Tahi sign-in / sign-up.
 *
 * Layout: a two-column split on the cream canvas.
 *   Desktop (>= 64rem): forest panel 58% (immersive gradient + drifting
 *     glows + film grain + slow sheen, carrying the brand: wordmark, pill,
 *     headline, subcopy, peer testimonial, trust row) and a floating white
 *     card 42% holding the Clerk widget.
 *   Mobile (< 64rem): the forest collapses to a centred top band (wordmark
 *     hidden); the white card sits below it, pulled up -24px so it overlaps
 *     the seam; condensed trust proof renders under the card.
 *
 * The forest scene is an always-dark branded surface (like the sidebar):
 * its colours are hardcoded so they never flip with the app theme. The
 * white card is theme-pinned to light tokens so a visitor with dark mode
 * saved still gets a readable card (the (auth) group never applies .dark
 * to the card). Clerk renders the real form fields (Google, inputs,
 * submit, verification code, forgot-password, MFA); we only theme them via
 * `tahiClerkAppearance` and the scoped `.cl-*` CSS below.
 *
 * CSS kept in sync with the locked design "Tahi Auth" (Claude design project
 * 57bf60cf). All decorative motion yields to prefers-reduced-motion.
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
  /** Pill label on the forest panel ("Your workspace"). */
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

// The leaf outline (same shape as the brand leaf glyph), sampled and drawn as
// a glowing neon line on a canvas in the forest scene. It draws itself on
// first paint and brightens along the path under the pointer.
const NEON_LEAF =
  'M11.68 4.45C11.58 6.13 11.17 7.78 10.38 9.27C8.63 12.56 5.35 14.15 1.85 14.94C2.91 11.61 4.91 8.51 7.29 5.97C7.35 5.91 7.4 5.86 7.45 5.8L7.45 5.8C7.23 6.12 6.83 6.29 6.54 6.52C6.16 6.82 5.8 7.18 5.46 7.52C3.99 9.01 2.83 10.78 1.83 12.61C1.6 13.04 1.37 13.48 1.16 13.92C1.06 14.11 0.95 14.31 0.87 14.51C0.81 14.66 0.66 15 0.73 15.17C0.66 14.86 0.6 14.55 0.54 14.24C0.14 11.85 0.14 9.29 1.21 7.07C1.93 5.56 3.1 4.29 4.46 3.3C6.46 1.84 8.86 0.87 11.23 0.18C11.36 0.14 11.36 0.23 11.37 0.3C11.65 1.65 11.77 3.06 11.68 4.45Z'

function NeonLeaf() {
  const ref = React.useRef<HTMLCanvasElement>(null)
  React.useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const scene = canvas.parentElement
    if (!scene) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const DPR = Math.min(2, window.devicePixelRatio || 1)
    const NS = 'http://www.w3.org/2000/svg'
    const tsvg = document.createElementNS(NS, 'svg')
    tsvg.style.cssText = 'position:absolute;left:-9999px;top:-9999px;width:0;height:0'
    const sp = document.createElementNS(NS, 'path')
    sp.setAttribute('d', NEON_LEAF)
    tsvg.appendChild(sp)
    document.body.appendChild(tsvg)
    const total = sp.getTotalLength()
    const N = 340
    const raw: { x: number; y: number }[] = []
    for (let i = 0; i < N; i++) {
      const pt = sp.getPointAtLength((total * i) / (N - 1))
      raw.push({ x: pt.x, y: pt.y })
    }
    document.body.removeChild(tsvg)
    let minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9
    raw.forEach(p => { minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y) })
    const cxL = (minX + maxX) / 2, cyL = (minY + maxY) / 2
    const pts = raw.map(() => ({ rx: 0, ry: 0 }))
    const connect = new Array<boolean>(N).fill(true)
    let cssW = 0, cssH = 0
    const rot = (-8 * Math.PI) / 180, cosR = Math.cos(rot), sinR = Math.sin(rot)
    function layout() {
      cssW = scene!.clientWidth; cssH = scene!.clientHeight
      if (!cssW || !cssH) return
      canvas!.width = Math.round(cssW * DPR); canvas!.height = Math.round(cssH * DPR)
      ctx!.setTransform(DPR, 0, 0, DPR, 0, 0)
      const scale = (cssH * 0.58) / (maxY - minY), ax = cssW * 0.8, ay = cssH * 0.83
      for (let i = 0; i < N; i++) {
        const lx = (raw[i].x - cxL) * scale, ly = (raw[i].y - cyL) * scale
        pts[i].rx = lx * cosR - ly * sinR + ax; pts[i].ry = lx * sinR + ly * cosR + ay
      }
      const gaps: number[] = []
      for (let i = 1; i < N; i++) gaps.push(Math.hypot(pts[i].rx - pts[i - 1].rx, pts[i].ry - pts[i - 1].ry))
      const med = [...gaps].sort((a, b) => a - b)[Math.floor(gaps.length / 2)] || 1
      connect[0] = false
      for (let i = 1; i < N; i++) {
        let ok = Math.hypot(pts[i].rx - pts[i - 1].rx, pts[i].ry - pts[i - 1].ry) < med * 2.8
        if (ok && i > 1) {
          const a1x = pts[i - 1].rx - pts[i - 2].rx, a1y = pts[i - 1].ry - pts[i - 2].ry
          const a2x = pts[i].rx - pts[i - 1].rx, a2y = pts[i].ry - pts[i - 1].ry
          const m1 = Math.hypot(a1x, a1y), m2 = Math.hypot(a2x, a2y)
          if (m1 > 0 && m2 > 0 && (a1x * a2x + a1y * a2y) / (m1 * m2) < -0.55) ok = false
        }
        connect[i] = ok
      }
      for (let pass = 0; pass < 2; pass++) {
        const sx = pts.map(p => p.rx), sy = pts.map(p => p.ry)
        for (let i = 1; i < N - 1; i++) {
          if (connect[i] && connect[i + 1]) {
            pts[i].rx = sx[i] * 0.5 + (sx[i - 1] + sx[i + 1]) * 0.25
            pts[i].ry = sy[i] * 0.5 + (sy[i - 1] + sy[i + 1]) * 0.25
          }
        }
      }
    }
    layout()
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => layout()) : null
    if (ro) ro.observe(scene)
    const mouse = { x: 0, y: 0, on: false, r: 95 }
    const fade = { x: 0, y: 0, a: 0 }
    const onMove = (e: PointerEvent) => {
      const r = scene!.getBoundingClientRect()
      mouse.x = e.clientX - r.left; mouse.y = e.clientY - r.top
      if (!mouse.on) { fade.x = mouse.x; fade.y = mouse.y }
      mouse.on = true
    }
    const onLeave = () => { mouse.on = false }
    scene.addEventListener('pointermove', onMove)
    scene.addEventListener('pointerleave', onLeave)
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    let prog = reduce ? 1 : 0
    let pt0: number | null = null
    let raf = 0
    const pDelay = 300, pDur = 2000
    function frame(ts: number) {
      if (scene!.clientWidth !== cssW || scene!.clientHeight !== cssH) layout()
      if (!reduce) { if (pt0 === null) pt0 = ts; const e = ts - pt0 - pDelay; prog = e <= 0 ? 0 : Math.min(1, e / pDur) }
      const active = Math.max(2, Math.floor(prog * N))
      fade.a += ((mouse.on ? 1 : 0) - fade.a) * 0.12
      fade.x += (mouse.x - fade.x) * 0.2; fade.y += (mouse.y - fade.y) * 0.2
      ctx!.clearRect(0, 0, cssW, cssH); ctx!.lineCap = 'round'; ctx!.lineJoin = 'round'
      let pen = false
      ctx!.beginPath()
      for (let i = 0; i < active; i++) { const p = pts[i]; if (connect[i] && pen) ctx!.lineTo(p.rx, p.ry); else ctx!.moveTo(p.rx, p.ry); pen = true }
      ctx!.shadowColor = 'rgba(74,200,132,0.9)'
      ctx!.shadowBlur = 22; ctx!.strokeStyle = 'rgba(70,196,128,0.26)'; ctx!.lineWidth = 3.4; ctx!.stroke()
      ctx!.shadowBlur = 12; ctx!.strokeStyle = 'rgba(120,224,158,0.55)'; ctx!.lineWidth = 2.0; ctx!.stroke()
      ctx!.shadowColor = 'rgba(150,240,180,0.95)'
      ctx!.shadowBlur = 4; ctx!.strokeStyle = 'rgba(225,255,236,0.96)'; ctx!.lineWidth = 1.0; ctx!.stroke()
      ctx!.shadowBlur = 0
      if (fade.a > 0.01) {
        ctx!.globalCompositeOperation = 'lighter'
        const rg = ctx!.createRadialGradient(fade.x, fade.y, 0, fade.x, fade.y, mouse.r)
        rg.addColorStop(0, 'rgba(214,255,230,' + (0.65 * fade.a).toFixed(3) + ')')
        rg.addColorStop(0.5, 'rgba(130,232,172,' + (0.26 * fade.a).toFixed(3) + ')')
        rg.addColorStop(1, 'rgba(130,232,172,0)')
        let pen2 = false
        ctx!.beginPath()
        for (let i = 0; i < active; i++) { const p = pts[i]; if (connect[i] && pen2) ctx!.lineTo(p.rx, p.ry); else ctx!.moveTo(p.rx, p.ry); pen2 = true }
        ctx!.lineCap = 'round'; ctx!.lineJoin = 'round'; ctx!.strokeStyle = rg
        ctx!.shadowColor = 'rgba(150,240,180,0.9)'; ctx!.shadowBlur = 6 * fade.a; ctx!.lineWidth = 2.4; ctx!.stroke()
        ctx!.shadowBlur = 2 * fade.a; ctx!.lineWidth = 1.0; ctx!.stroke()
        ctx!.shadowBlur = 0; ctx!.globalCompositeOperation = 'source-over'
      }
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => {
      cancelAnimationFrame(raf)
      if (ro) ro.disconnect()
      scene!.removeEventListener('pointermove', onMove)
      scene!.removeEventListener('pointerleave', onLeave)
    }
  }, [])
  return <canvas className="ta-neon" ref={ref} aria-hidden="true" />
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
        <span className="ta-nbloom" aria-hidden="true" />
        <span className="ta-grain" aria-hidden="true" />
        <NeonLeaf />

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
// avatars/logos when available). The last entry is the "+N" count chip.
export const TAHI_TRUST_AVATARS: TrustAvatar[] = [
  { bg: '#C99A6A' },
  { bg: '#7aab6b' },
  { bg: '#5b7da0' },
  { bg: '#b06a8a' },
  { bg: '#3C5733', more: '+40' },
]

// ──────────────────────────────────────────────────────────────────────
// Scene + card CSS, scoped under .tahi-auth. Forest colours are hardcoded
// (always-dark surface, like the sidebar); the card pins light tokens so it
// survives a dark-mode-saved visitor. The .cl-* block themes the real Clerk
// widget via its stable class names. Mirrors the locked "Tahi Auth" design.
// ──────────────────────────────────────────────────────────────────────
const GRAIN =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='200'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.55'/%3E%3C/svg%3E\")"

const AUTH_CSS = `
.tahi-auth{ min-height:100vh; display:grid; grid-template-columns:58% 42%; background:#F7F6F3; font-family:'Manrope',var(--font-sans, sans-serif); overflow-x:hidden; }
.tahi-auth *{ box-sizing:border-box; }

/* ---- scene ---- */
.tahi-auth-scene{ position:relative; overflow:hidden; background-color:#13200C;
  background-image:radial-gradient(125% 100% at 50% 118%, #0c1607 0%, rgba(12,22,7,0) 58%), linear-gradient(162deg, #1F3719 0%, #172810 46%, #0E1C09 100%); }
/* neon bloom behind the leaf + the canvas the leaf is drawn on */
.ta-nbloom{ position:absolute; right:-60px; bottom:-50px; width:460px; height:520px; z-index:0; pointer-events:none; background:radial-gradient(circle at 60% 60%, rgba(86,220,140,0.10) 0%, rgba(86,220,140,0) 62%); filter:blur(30px); }
.ta-neon{ position:absolute; inset:0; z-index:1; width:100%; height:100%; pointer-events:none; }
.ta-grain{ position:absolute; inset:0; pointer-events:none; z-index:1; background-image:${GRAIN}; background-size:200px 200px; mix-blend-mode:soft-light; opacity:.4; }
.ta-scene-content{ position:relative; z-index:2; height:100%; padding:56px; display:flex; flex-direction:column; justify-content:space-between; }
.ta-scene-centered{ justify-content:flex-start; }
.ta-scene-centered .ta-scene-mid{ flex:1; display:flex; flex-direction:column; justify-content:center; }

@keyframes ta-cardup{ from{ opacity:0; transform:translateY(10px); } to{ opacity:1; transform:translateY(0); } }

.ta-wordmark{ color:#FDFDFC; }
.ta-wordmark svg{ display:block; height:28px; width:auto; }
/* align-self + width:fit-content keep the pill hugging its text even when the
   scene column is a flex container (sign-in / centeredScene). */
.ta-pill{ display:inline-flex; align-self:flex-start; width:fit-content; align-items:center; gap:8px; height:28px; padding:0 12px; border-radius:0 .625rem 0 .625rem; background:rgba(255,255,255,0.06); border:1px solid rgba(255,255,255,0.14); font-size:13px; font-weight:600; color:#DCE8D9; }
.ta-pill-leaf{ display:inline-flex; color:#7aab6b; }
.ta-headline{ margin:22px 0 0; font-size:36px; line-height:1.05; font-weight:700; letter-spacing:-0.025em; color:#FDFDFC; max-width:20ch; text-wrap:balance; }
.ta-sub{ margin:18px 0 0; font-size:15px; line-height:1.6; color:#DCE8D9; max-width:40ch; }

.ta-glass{ background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.12); backdrop-filter:blur(12px); -webkit-backdrop-filter:blur(12px); border-radius:.5rem; padding:20px; }
.ta-testimonial{ margin:36px 0 0; max-width:30rem; }
.ta-quote{ margin:0; font-size:15px; line-height:1.55; color:#FDFDFC; }
.ta-figc{ margin-top:16px; display:flex; align-items:center; gap:12px; }
.ta-avatar{ width:40px; height:40px; border-radius:50%; flex-shrink:0; object-fit:cover; background:linear-gradient(140deg,#7aab6b,#425F39); display:flex; align-items:center; justify-content:center; font-weight:700; font-size:14px; color:#fff; }
.ta-figc-text{ display:flex; flex-direction:column; line-height:1.4; }
.ta-figc-name{ font-size:14px; font-weight:600; color:#FDFDFC; }
.ta-figc-role{ font-size:13px; color:#DCE8D9; }

.ta-trust{ display:flex; flex-direction:column; gap:12px; }
.ta-avatars{ display:flex; }
.ta-av{ width:28px; height:28px; border-radius:50%; border:2px solid #1E3019; object-fit:cover; background:#26331d; }
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
.ta-helper{ margin:12px 0 0; font-size:13px; line-height:1.5; color:#5D5B55; }
.ta-legal{ margin:16px 0 0; font-size:12px; line-height:1.5; color:#63615B; }
.ta-legal a{ color:#5D5B55; font-weight:600; text-decoration:none; cursor:pointer; }
.ta-legal a:hover{ text-decoration:underline; }
.ta-switch{ margin-top:20px; padding-top:20px; border-top:1px solid rgba(26,25,20,0.08); text-align:center; font-size:13px; color:#5D5B55; }
.ta-swlink{ color:#425F39; font-weight:700; text-decoration:none; cursor:pointer; background:none; border:none; font:inherit; padding:0; }
.ta-swlink:hover{ text-decoration:underline; }
.ta-trust-mobile{ display:none; }

/* ---- Clerk widget, themed via stable cl-* classes (kept in sync with the
   locked design). overflow:visible on the wrappers stops Clerk's default
   overflow:hidden clipping the Google button corners against the card. ---- */
.tahi-auth-card .cl-rootBox{ width:100%; overflow:visible; }
.tahi-auth-card .cl-cardBox,
.tahi-auth-card .cl-card{ width:100%; max-width:100%; margin:0; padding:0; border:0; background:transparent; box-shadow:none; overflow:visible; display:flex; flex-direction:column; gap:16px; }
.tahi-auth-card .cl-footer{ display:none; }
/* Clerk owns the per-step heading (wording via localization). */
.tahi-auth-card .cl-header{ display:flex; flex-direction:column; gap:6px; text-align:left; margin:0 0 8px; }
.tahi-auth-card .cl-headerTitle{ font:600 21px 'Manrope',sans-serif; letter-spacing:-0.01em; color:#121A0F; margin:0; }
.tahi-auth-card .cl-headerSubtitle{ font:400 14px 'Manrope',sans-serif; color:#5D5B55; line-height:1.5; margin:0; }
.tahi-auth-card .cl-main{ width:100%; display:flex; flex-direction:column; gap:16px; overflow:visible; }

.tahi-auth-card .cl-socialButtons{ width:100%; display:flex; flex-direction:column; gap:10px; overflow:visible; }
.tahi-auth-card .cl-socialButtonsBlockButton{ width:100%; min-height:48px; overflow:visible; display:flex; align-items:center; justify-content:center; gap:10px; border:1px solid rgba(26,25,20,0.16); border-radius:.5rem; background:#fff; color:#121A0F; font:600 15px 'Manrope',sans-serif; text-transform:none; box-shadow:none; cursor:pointer; transition:background .15s, box-shadow .15s; }
.tahi-auth-card .cl-socialButtonsBlockButton:hover{ background:#F4F3EF; box-shadow:0 1px 3px rgba(26,25,20,0.1); }
.tahi-auth-card .cl-socialButtonsBlockButton:focus-visible{ outline:2px solid #425F39; outline-offset:2px; }
.tahi-auth-card .cl-socialButtonsBlockButtonText{ font:600 15px 'Manrope',sans-serif; color:#121A0F; }

.tahi-auth-card .cl-dividerRow{ display:flex; align-items:center; gap:14px; margin:4px 0; color:#63615B; font-size:13px; }
.tahi-auth-card .cl-dividerLine{ flex:1; height:1px; background:rgba(26,25,20,0.12); }
.tahi-auth-card .cl-dividerText{ color:#63615B; font-size:13px; text-transform:none; }

.tahi-auth-card .cl-form{ width:100%; display:flex; flex-direction:column; gap:14px; }
.tahi-auth-card .cl-formFieldRow{ display:flex; gap:12px; }
.tahi-auth-card .cl-formField{ display:flex; flex-direction:column; gap:8px; flex:1; min-width:0; }
.tahi-auth-card .cl-formFieldLabelRow{ display:flex; align-items:baseline; justify-content:space-between; }
.tahi-auth-card .cl-formFieldLabel{ font:600 13px 'Manrope',sans-serif; color:#121A0F; }
.tahi-auth-card .cl-formFieldAction{ font-size:13px; color:#5D5B55; text-decoration:none; cursor:pointer; }
.tahi-auth-card .cl-formFieldAction:hover{ text-decoration:underline; }
.tahi-auth-card .cl-formFieldInputGroup{ position:relative; }
.tahi-auth-card .cl-formFieldInput{ width:100%; height:48px; padding:0 14px; border:1px solid rgba(26,25,20,0.16); border-radius:.5rem; background:#fff; font:400 16px 'Manrope',sans-serif; color:#121A0F; box-shadow:none; outline:none; transition:border-color .15s, box-shadow .15s; }
.tahi-auth-card .cl-formFieldInput::placeholder{ color:#9b9a94; }
.tahi-auth-card .cl-formFieldInput:focus,
.tahi-auth-card .cl-formFieldInput:focus-visible{ border-color:#5A824E; box-shadow:0 0 0 3px rgba(90,130,78,0.25); outline:none; }
.tahi-auth-card .cl-formFieldInput[aria-invalid="true"],
.tahi-auth-card .cl-formFieldInput[data-invalid]{ border-color:#e0584f; box-shadow:0 0 0 3px rgba(224,88,79,0.16); }
.tahi-auth-card .cl-formFieldInputShowPasswordButton{ position:absolute; right:8px; top:50%; transform:translateY(-50%); width:32px; height:32px; display:flex; align-items:center; justify-content:center; border:none; background:none; color:#63615B; cursor:pointer; border-radius:6px; }
.tahi-auth-card .cl-formFieldInputShowPasswordButton:hover{ background:rgba(26,25,20,0.05); }

.tahi-auth-card .cl-formButtonPrimary{ width:100%; height:48px; border:0; border-radius:.5rem; background:#425F39; color:#fff; font:600 16px 'Manrope',sans-serif; text-transform:none; letter-spacing:0; box-shadow:none; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:10px; transition:background .2s cubic-bezier(.22,1,.36,1); }
.tahi-auth-card .cl-formButtonPrimary:hover{ background:#2A3626; }
.tahi-auth-card .cl-formButtonPrimary:focus-visible{ outline:2px solid #425F39; outline-offset:2px; }
.tahi-auth-card .cl-formButtonPrimary[disabled]{ opacity:.85; cursor:default; }

.tahi-auth-card .cl-identityPreview{ display:flex; align-items:center; justify-content:space-between; gap:10px; padding:10px 12px; border:1px solid rgba(26,25,20,0.12); border-radius:.5rem; background:#F7F6F3; font-size:14px; color:#121A0F; }
.tahi-auth-card .cl-identityPreviewText{ overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.tahi-auth-card .cl-formResendCodeLink,
.tahi-auth-card .cl-footerActionLink,
.tahi-auth-card .cl-identityPreviewEditButton{ color:#425F39; font-weight:600; background:none; border:none; cursor:pointer; font:inherit; padding:0; }

.tahi-auth-card .cl-otpCodeFieldInputs{ display:flex; gap:8px; justify-content:space-between; }
.tahi-auth-card .cl-otpCodeFieldInput{ flex:1; min-width:0; height:48px; text-align:center; padding:0; border:1px solid rgba(26,25,20,0.16); border-radius:.5rem; font:600 16px 'Manrope',sans-serif; color:#121A0F; background:#fff; outline:none; transition:border-color .15s, box-shadow .15s; }
.tahi-auth-card .cl-otpCodeFieldInput:focus{ border-color:#5A824E; box-shadow:0 0 0 3px rgba(90,130,78,0.25); outline:none; }

.tahi-auth-card .cl-formFieldErrorText{ display:flex; align-items:center; gap:6px; color:#c0463d; font-size:13px; margin:0; }
.tahi-auth-card .cl-alert{ display:flex; align-items:center; gap:10px; padding:12px 14px; border-radius:10px; border:1px solid rgba(192,70,61,0.35); background:rgba(224,88,79,0.06); }
.tahi-auth-card .cl-alertText{ color:#a83b33; font-size:13.5px; }

/* ---- responsive: mobile band is centred and drops the wordmark ---- */
@media (max-width: 63.99rem){
  .tahi-auth{ display:flex; flex-direction:column; }
  .tahi-auth-scene{ min-height:300px; }
  .ta-scene-content{ padding:40px 26px 34px; justify-content:flex-start; align-items:center; text-align:center; }
  .ta-scene-mid{ margin-top:34px; display:flex; flex-direction:column; align-items:center; }
  .ta-pill{ align-self:center; }
  .ta-wordmark{ display:none; }
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
  /* the neon leaf checks prefers-reduced-motion itself: it paints fully drawn
     and skips the draw-on reveal. */
  .ta-card-enter{ animation:none !important; }
}
`

/**
 * Shared Clerk appearance preset for sign-in and sign-up. The full visual
 * theming lives in the scoped `.cl-*` CSS above; these keys set social-button
 * placement and hide Clerk's footer so our own switch link owns that row. The
 * per-step heading wording comes from ClerkProvider localization in
 * app/layout.tsx.
 */
export const tahiClerkAppearance = {
  layout: {
    socialButtonsPlacement: 'top',
    showOptionalFields: true,
  },
  elements: {
    footer: 'hidden',
  },
} as const
