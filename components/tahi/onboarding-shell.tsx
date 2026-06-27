'use client'

/**
 * Studio Ledger onboarding shell. Shared scene + step chrome for the two
 * onboarding flows:
 *   - team "Welcome to Tahi" (components/tahi/team-welcome-content.tsx)
 *   - client onboarding      (components/tahi/onboarding-content.tsx)
 *
 * Layout mirrors the auth scene but flips the split: forest scene 42% / card
 * 58% (the card carries the stepped form here, so it gets the room). The scene
 * reuses the same neon leaf, grain, bloom and brand chrome as <AuthShell>.
 *
 * This module owns the reusable pieces: <SceneShell> + <Ledger> (left panel),
 * <Stepper> (mobile step dots), the useGrow height-animation hook, the shared
 * <TimezoneField> / <PhotoField> inputs, the Check glyph, and ONBOARDING_CSS.
 * The final cream "portal" screens from the design are intentionally omitted:
 * each flow routes into the dashboard instead (they fold into the home/tour).
 *
 * CSS is scoped under .tahi-auth / .ob-* and kept in sync with the locked
 * design (Claude design project 57bf60cf, files onboarding.css + auth.css).
 * All decorative motion yields to prefers-reduced-motion.
 */

import * as React from 'react'
import { cn } from '@/lib/utils'
import { TahiStudioWordmark, LeafIcon } from '@/components/tahi/tahi-glyphs'

// ── icon helpers ───────────────────────────────────────────────────────
type IconProps = { size?: number }
function svg(size: number | undefined, children: React.ReactNode) {
  const s = size || 16
  return (
    <svg
      width={s}
      height={s}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.4}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  )
}
export function Check({ size }: IconProps) {
  return svg(size, <path d="M20 6 9 17l-5-5" />)
}
export function Camera({ size }: IconProps) {
  return svg(
    size,
    <>
      <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
      <circle cx="12" cy="13" r="4" />
    </>,
  )
}

// ── neon leaf (canvas) ─────────────────────────────────────────────────
// Same drawing as the auth scene: the brand leaf outline sampled and drawn as
// a glowing neon line that reveals on first paint and brightens under the
// pointer. Kept isolated here so onboarding never depends on auth-shell.
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

// ── left panel ─────────────────────────────────────────────────────────
/** Decorative forest scene shell: neon leaf, grain, bloom, wordmark, then
 *  whatever scene content the flow passes (pill, headline, ledger, buddy). */
export function SceneShell({ children }: { children: React.ReactNode }) {
  return (
    <aside className="tahi-auth-scene">
      <span className="ta-nbloom" aria-hidden="true" />
      <span className="ta-grain" aria-hidden="true" />
      <NeonLeaf />
      <div className="ta-scene-content">
        <div className="ta-wordmark">
          <TahiStudioWordmark height={28} title="Tahi Studio" />
        </div>
        <div>{children}</div>
        <div />
      </div>
    </aside>
  )
}

/** Scene pill ("Joining the studio") with the brand leaf. */
export function ScenePill({ children }: { children: React.ReactNode }) {
  return (
    <span className="ta-pill">
      <span className="ta-pill-leaf" aria-hidden="true">
        <LeafIcon size={12} />
      </span>
      {children}
    </span>
  )
}

export interface LedgerStep {
  /** Stable key. */
  id: string
  /** Label shown in the ledger / step list. */
  label: string
}

/** The vertical "ledger" of steps on the scene panel (desktop). */
export function Ledger({ steps, idx, staticList }: { steps: LedgerStep[]; idx: number; staticList?: boolean }) {
  return (
    <ol className={cn('ob-ledger', staticList && 'ob-ledger-static')}>
      {steps.map((s, i) => (
        <li key={s.id} className={staticList ? '' : cn(i < idx && 'done', i === idx && 'active')}>
          <span className="dot">{!staticList && i < idx ? <Check size={11} /> : null}</span>
          {s.label}
        </li>
      ))}
    </ol>
  )
}

/** Mobile step dots (the scene ledger is hidden on small screens). */
export function Stepper({ steps, idx }: { steps: LedgerStep[]; idx: number }) {
  return (
    <div className="ob-stepper" role="group" aria-label={`Step ${idx + 1} of ${steps.length}`}>
      <span className="ob-count">Step {idx + 1} of {steps.length}</span>
      <div className="ob-nodes">
        {steps.map((s, i) => (
          <React.Fragment key={s.id}>
            {i > 0 && <span className={cn('ob-link', i <= idx && 'done')} />}
            <span
              className={cn('ob-node', i < idx && 'done', i === idx && 'active')}
              aria-current={i === idx ? 'step' : undefined}
            >
              {i < idx ? <Check size={9} /> : null}
            </span>
          </React.Fragment>
        ))}
      </div>
    </div>
  )
}

// ── height-animated card body ──────────────────────────────────────────
/**
 * Animate the card height to fit new step content while it slides in. Returns
 * [wrapRef, innerRef]: put wrapRef on the clipping wrapper (.ob-grow) and
 * innerRef on the keyed body (.ob-body). Pass a `dep` that changes per step.
 * Respects prefers-reduced-motion (snaps to auto height).
 */
export function useGrow(dep: string): [React.RefObject<HTMLDivElement | null>, React.RefObject<HTMLDivElement | null>] {
  const wrap = React.useRef<HTMLDivElement>(null)
  const inner = React.useRef<HTMLDivElement>(null)
  const prev = React.useRef<number | null>(null)
  React.useLayoutEffect(() => {
    const w = wrap.current, n = inner.current
    if (!w || !n) return
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches
    const start = prev.current
    if (reduce || start == null) { prev.current = n.offsetHeight; w.style.height = 'auto'; w.style.overflow = ''; return }
    let cleared = false, raf1 = 0, raf2 = 0, t = 0
    w.style.overflow = 'hidden'
    w.style.height = start + 'px'; void w.offsetHeight
    raf1 = requestAnimationFrame(() => {
      const target = n.offsetHeight; prev.current = target
      if (Math.abs(start - target) <= 1) { w.style.height = 'auto'; w.style.overflow = ''; return }
      raf2 = requestAnimationFrame(() => { w.style.height = target + 'px' })
    })
    const finish = () => {
      if (cleared) return; cleared = true
      w.removeEventListener('transitionend', done)
      const real = n.offsetHeight, cur = w.getBoundingClientRect().height; prev.current = real
      if (Math.abs(real - cur) > 2) {
        w.style.height = cur + 'px'; void w.offsetHeight
        requestAnimationFrame(() => { w.style.height = real + 'px' })
        setTimeout(() => { if (!wrap.current) return; wrap.current.style.height = 'auto'; wrap.current.style.overflow = '' }, 300)
      } else { w.style.height = 'auto'; w.style.overflow = '' }
    }
    const done = (e: TransitionEvent) => { if (e.propertyName === 'height') finish() }
    w.addEventListener('transitionend', done)
    t = window.setTimeout(finish, 760)
    return () => { cancelAnimationFrame(raf1); cancelAnimationFrame(raf2); clearTimeout(t); w.removeEventListener('transitionend', done) }
  }, [dep])
  return [wrap, inner]
}

// ── shared fields ──────────────────────────────────────────────────────
function tzAll(): string[] {
  try { return (Intl as unknown as { supportedValuesOf: (k: string) => string[] }).supportedValuesOf('timeZone') }
  catch { return ['Pacific/Auckland', 'Australia/Sydney', 'Asia/Singapore', 'Asia/Kolkata', 'Europe/London', 'Europe/Berlin', 'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'Asia/Tokyo'] }
}
function tzOffset(tz: string): string {
  try {
    const p = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'shortOffset' }).formatToParts(new Date())
    const o = p.find(x => x.type === 'timeZoneName')
    return o ? o.value.replace('GMT', 'UTC') : 'UTC'
  } catch { return 'UTC' }
}

/** Timezone select, defaulted to the visitor's detected zone. */
export function TimezoneField({ value, onChange }: { value?: string; onChange?: (v: string) => void }) {
  const detected = React.useMemo(() => {
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone } catch { return 'Pacific/Auckland' }
  }, [])
  const opts = React.useMemo(
    () => tzAll().map(z => ({ v: z, label: `(${tzOffset(z)}) ${z.replace(/_/g, ' ').replace('/', ' / ')}` })),
    [],
  )
  const [tz, setTz] = React.useState(value ?? detected)
  return (
    <div className="ob-field">
      <label className="ob-label">
        Your timezone <span className="ob-auto"><Check size={10} /> Auto-detected</span>
      </label>
      <select className="ob-select" value={tz} onChange={e => { setTz(e.target.value); onChange?.(e.target.value) }}>
        {opts.map(o => <option key={o.v} value={o.v}>{o.label}</option>)}
      </select>
    </div>
  )
}

/** Photo upload with a live local preview. `photo` is an object URL or null. */
export function PhotoField({
  photo,
  setPhoto,
  fallback,
  title = 'Add a photo',
  hint = 'So the team knows who to look for. Optional.',
}: {
  photo: string | null
  setPhoto: (url: string) => void
  fallback: string
  title?: string
  hint?: string
}) {
  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files && e.target.files[0]
    if (f) setPhoto(URL.createObjectURL(f))
  }
  return (
    <div className="ob-photo">
      <span className="ob-photo-av">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {photo ? <img src={photo} alt="" /> : fallback}
      </span>
      <div className="ob-photo-t"><b>{title}</b><small>{hint}</small></div>
      <label className="ob-drop">
        <Camera size={14} /> {photo ? 'Change' : 'Upload'}
        <input type="file" accept="image/*" onChange={onFile} hidden />
      </label>
    </div>
  )
}

// ── scoped CSS ─────────────────────────────────────────────────────────
const GRAIN =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='200'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.55'/%3E%3C/svg%3E\")"

export const ONBOARDING_CSS = `
.ob-stage{ min-height:100vh; }
.ob-bg{ position:fixed; inset:0; z-index:-1; background:#E7E5DF; }
.ob-frame{ width:100%; }

/* ---- scene (forest, always dark) ---- */
.tahi-auth{ min-height:100vh; display:grid; grid-template-columns:42% 58%; background:#F7F6F3; font-family:'Manrope',var(--font-sans, sans-serif); overflow-x:hidden; }
.tahi-auth *{ box-sizing:border-box; }
.tahi-auth-scene{ position:relative; overflow:hidden; background-color:#13200C;
  background-image:radial-gradient(125% 100% at 50% 118%, #0c1607 0%, rgba(12,22,7,0) 58%), linear-gradient(162deg, #1F3719 0%, #172810 46%, #0E1C09 100%); }
.ta-nbloom{ position:absolute; right:-60px; bottom:-50px; width:460px; height:520px; z-index:0; pointer-events:none; background:radial-gradient(circle at 60% 60%, rgba(86,220,140,0.10) 0%, rgba(86,220,140,0) 62%); filter:blur(30px); }
.ta-neon{ position:absolute; inset:0; z-index:1; width:100%; height:100%; pointer-events:none; }
.ta-grain{ position:absolute; inset:0; pointer-events:none; z-index:1; background-image:${GRAIN}; background-size:200px 200px; mix-blend-mode:soft-light; opacity:.4; }
.ta-scene-content{ position:relative; z-index:2; height:100%; padding:56px; display:flex; flex-direction:column; justify-content:space-between; }
.ta-wordmark{ color:#FDFDFC; }
.ta-wordmark svg{ display:block; height:28px; width:auto; }
.ta-pill{ display:inline-flex; align-self:flex-start; width:fit-content; align-items:center; gap:8px; height:28px; padding:0 12px; border-radius:0 .625rem 0 .625rem; background:rgba(255,255,255,0.06); border:1px solid rgba(255,255,255,0.14); font-size:13px; font-weight:600; color:#DCE8D9; }
.ta-pill-leaf{ display:inline-flex; color:#7aab6b; }
.ta-headline{ margin:22px 0 0; font-size:27px; line-height:1.08; font-weight:700; letter-spacing:-0.025em; color:#FDFDFC; max-width:22ch; text-wrap:balance; }

/* ---- scene ledger ---- */
.ob-ledger{ list-style:none; margin:30px 0 0; padding:0; display:flex; flex-direction:column; }
.ob-ledger li{ display:flex; align-items:center; gap:12px; padding:11px 0; border-top:1px solid rgba(255,255,255,0.10); font-size:14.5px; color:#9DB394; transition:color .3s cubic-bezier(.22,1,.36,1); }
.ob-ledger li:last-child{ border-bottom:1px solid rgba(255,255,255,0.10); }
.ob-ledger .dot{ width:9px; height:9px; border-radius:50%; border:1.5px solid #5d7a52; flex-shrink:0; display:flex; align-items:center; justify-content:center; }
.ob-ledger li.done{ color:#C9DAC0; }
.ob-ledger li.done .dot{ border:none; background:none; color:#7aab6b; }
.ob-ledger li.active{ color:#FDFDFC; font-weight:600; }
.ob-ledger li.active .dot{ border-color:#7aab6b; background:#7aab6b; box-shadow:0 0 0 3px rgba(122,171,107,0.20); animation:ob-pulse 2.4s cubic-bezier(.22,1,.36,1) infinite; }
@keyframes ob-pulse{ 0%,100%{ box-shadow:0 0 0 3px rgba(122,171,107,0.22); } 50%{ box-shadow:0 0 0 7px rgba(122,171,107,0.04); } }
.ob-ledger-static li{ opacity:.55; }
.ob-ledger-static li .dot{ background:transparent; border:1.5px solid rgba(253,253,252,0.4); }

.ob-lead{ margin-top:28px; display:flex; align-items:center; gap:12px; }
.ob-lead-av{ width:38px; height:38px; border-radius:50%; flex-shrink:0; overflow:hidden; background:linear-gradient(140deg,#7aab6b,#425F39); display:flex; align-items:center; justify-content:center; font:700 13px 'Manrope',sans-serif; color:#fff; border:2px solid rgba(255,255,255,0.14); }
.ob-lead-av img{ width:100%; height:100%; object-fit:cover; object-position:50% 16%; display:block; }
.ob-lead-t{ display:flex; flex-direction:column; line-height:1.4; }
.ob-lead-t b{ font-size:13.5px; font-weight:600; color:#FDFDFC; }
.ob-lead-t span{ font-size:12.5px; color:#DCE8D9; }

/* ---- form column + card ---- */
.tahi-auth-form{ display:flex; align-items:center; justify-content:center; padding:40px; }
.tahi-auth-card{ position:relative; z-index:3; width:100%; max-width:560px; margin:0 auto; background:#fff; border-radius:0 1.5rem 0 1.5rem; box-shadow:0 24px 48px -24px rgba(26,25,20,0.18); padding:40px;
  --ob-cream:#F7F6F3; --ob-card:#fff; --ob-text:#121A0F; --ob-muted:#5D5B55; --ob-subtle:#63615B;
  --ob-border:rgba(26,25,20,0.10); --ob-border-strong:rgba(26,25,20,0.16);
  --ob-brand:#5A824E; --ob-brand-dark:#425F39; --ob-brand-deep:#2A3626; --ob-brand-light:#7aab6b; --ob-brand-50:#f0f7ee;
  --ob-brand-wash:rgba(90,130,78,0.05); --ob-ease:cubic-bezier(.22,1,.36,1); }
.tahi-auth-card.ob-wide{ max-width:640px; }

/* ---- stepper (mobile) ---- */
.ob-stepper{ display:flex; align-items:center; gap:10px; margin-bottom:22px; }
.ob-stepper .ob-count{ font-size:12px; font-weight:700; letter-spacing:.04em; color:var(--ob-subtle); white-space:nowrap; }
.ob-nodes{ display:flex; align-items:center; gap:0; flex:1; }
.ob-node{ width:11px; height:11px; border-radius:50%; border:1.5px solid var(--ob-border-strong); flex-shrink:0; display:flex; align-items:center; justify-content:center; color:#fff; background:#fff; }
.ob-node.done{ background:var(--ob-brand); border-color:var(--ob-brand); }
.ob-node.active{ background:var(--ob-brand); border-color:var(--ob-brand); box-shadow:0 0 0 3px rgba(90,130,78,0.18); }
.ob-link{ flex:1; height:1.5px; background:var(--ob-border-strong); }
.ob-link.done{ background:var(--ob-brand); }

/* ---- headings + body animation ---- */
.ob-h1{ margin:0; font-size:22px; font-weight:600; letter-spacing:-0.01em; color:var(--ob-text); text-wrap:pretty; }
.ob-sub{ margin:7px 0 22px; font-size:14px; line-height:1.55; color:var(--ob-muted); }
.ob-grow{ transition:height .52s cubic-bezier(.22,1,.36,1); overflow:visible; }
@keyframes ob-in-up{ from{ opacity:0; transform:translateY(12px); } to{ opacity:1; transform:none; } }
@keyframes ob-in-down{ from{ opacity:0; transform:translateY(-12px); } to{ opacity:1; transform:none; } }
.ob-in-up{ animation:ob-in-up .5s cubic-bezier(.22,1,.36,1); }
.ob-in-down{ animation:ob-in-down .5s cubic-bezier(.22,1,.36,1); }
@keyframes ob-stagger{ from{ transform:translateY(9px); } to{ transform:none; } }
.ob-in-up > *, .ob-in-down > *{ animation:ob-stagger .5s cubic-bezier(.22,1,.36,1) both; }
.ob-in-up > *:nth-child(1),.ob-in-down > *:nth-child(1){ animation-delay:.02s; }
.ob-in-up > *:nth-child(2),.ob-in-down > *:nth-child(2){ animation-delay:.07s; }
.ob-in-up > *:nth-child(3),.ob-in-down > *:nth-child(3){ animation-delay:.12s; }
.ob-in-up > *:nth-child(4),.ob-in-down > *:nth-child(4){ animation-delay:.17s; }
.ob-in-up > *:nth-child(5),.ob-in-down > *:nth-child(5){ animation-delay:.22s; }
.ob-in-up > *:nth-child(n+6),.ob-in-down > *:nth-child(n+6){ animation-delay:.27s; }

/* ---- footer buttons ---- */
.ob-footer{ display:flex; align-items:center; gap:12px; margin-top:26px; }
.ob-footer.end{ justify-content:flex-end; }
.ob-back{ height:46px; padding:0 18px; border:1px solid var(--ob-border-strong); border-radius:.5rem; background:#fff; font:600 14px 'Manrope',sans-serif; color:var(--ob-text); cursor:pointer; transition:background .15s; }
.ob-back:hover{ background:#F4F3EF; }
.ob-next{ flex:1; height:48px; border:none; border-radius:.5rem; background:var(--ob-brand-dark); color:#fff; font:600 15px 'Manrope',sans-serif; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:9px; transition:background .2s var(--ob-ease); }
.ob-next:hover{ background:var(--ob-brand-deep); }
.ob-next[disabled]{ opacity:.7; cursor:default; }
.ob-skip{ background:none; border:none; padding:0; font:500 13px 'Manrope',sans-serif; color:var(--ob-subtle); cursor:pointer; }
.ob-skip:hover{ color:var(--ob-muted); text-decoration:underline; }

/* ---- fields ---- */
.ob-label{ display:block; font-size:12px; font-weight:600; text-transform:uppercase; letter-spacing:.08em; color:var(--ob-subtle); margin-bottom:7px; }
.ob-input, .ob-select{ width:100%; height:48px; padding:0 14px; border:1px solid var(--ob-border-strong); border-radius:.5rem; background:#fff; font:400 16px 'Manrope',sans-serif; color:var(--ob-text); outline:none; transition:border-color .15s, box-shadow .15s; }
.ob-input::placeholder{ color:#9b9a94; }
.ob-input:focus, .ob-select:focus{ border-color:var(--ob-brand); box-shadow:0 0 0 3px rgba(90,130,78,0.22); }
.ob-textarea{ width:100%; min-height:84px; padding:12px 14px; border:1px solid var(--ob-border-strong); border-radius:.5rem; background:#fff; font:400 15px 'Manrope',sans-serif; color:var(--ob-text); outline:none; resize:vertical; }
.ob-textarea:focus{ border-color:var(--ob-brand); box-shadow:0 0 0 3px rgba(90,130,78,0.22); }
.ob-row2{ display:flex; gap:12px; }
.ob-row2 > *{ flex:1; min-width:0; }
.ob-field{ margin-bottom:16px; }
.ob-identity{ display:flex; align-items:center; gap:12px; padding:12px 14px; border:1px solid var(--ob-border); border-radius:.625rem; background:#F7F6F3; margin-bottom:18px; }
.ob-identity-av{ width:40px; height:40px; border-radius:50%; flex-shrink:0; background:linear-gradient(140deg,#7aab6b,#425F39); display:flex; align-items:center; justify-content:center; font:700 14px 'Manrope',sans-serif; color:#fff; }
.ob-identity-t{ display:flex; flex-direction:column; line-height:1.4; }
.ob-identity-t b{ font-size:14.5px; color:var(--ob-text); }
.ob-identity-t small{ font-size:12.5px; color:var(--ob-muted); }
.ob-identity-tag{ margin-left:auto; font-size:11px; font-weight:600; color:var(--ob-subtle); background:#fff; border:1px solid var(--ob-border); padding:3px 8px; border-radius:50px; white-space:nowrap; }
.ob-auto{ display:inline-flex; align-items:center; gap:4px; margin-left:8px; font-size:10px; font-weight:700; letter-spacing:.02em; color:var(--ob-brand-dark); background:var(--ob-brand-50); padding:2px 7px; border-radius:50px; text-transform:none; vertical-align:middle; }
.ob-auto svg{ color:var(--ob-brand); }

/* ---- summary rows ---- */
.ob-ccy{ margin-bottom:14px; }
.ob-summary{ border:1px solid var(--ob-border-strong); border-radius:.625rem; padding:16px 18px; }
.ob-srow{ display:flex; justify-content:space-between; align-items:baseline; font-size:14px; color:var(--ob-muted); padding:5px 0; }
.ob-srow b{ color:var(--ob-text); font-variant-numeric:tabular-nums; }
.ob-srow.total{ border-top:1px solid var(--ob-border); margin-top:6px; padding-top:11px; font-size:15px; color:var(--ob-text); font-weight:600; }
.ob-srow.total b{ font-size:18px; }

/* ---- plan cards ---- */
.ob-plans{ display:flex; gap:12px; }
.ob-plan{ flex:1; min-width:0; position:relative; text-align:left; padding:18px; border:1px solid var(--ob-border-strong); border-radius:.75rem; background:#fff; cursor:pointer; transition:border-color .2s var(--ob-ease), box-shadow .2s var(--ob-ease), transform .2s var(--ob-ease); }
.ob-plan:hover{ border-color:var(--ob-brand-light); }
.ob-plan.rec{ border-color:var(--ob-brand-light); }
.ob-plan.sel{ border-color:var(--ob-brand); box-shadow:0 0 0 2px var(--ob-brand); transform:translateY(-2px); }
.ob-plan-pill{ position:absolute; top:-9px; right:14px; font-size:10.5px; font-weight:700; letter-spacing:.04em; padding:3px 9px; border-radius:0 .5rem 0 .5rem; background:var(--ob-brand-50); color:var(--ob-brand-dark); }
.ob-plan-out{ font-size:14px; font-weight:600; color:var(--ob-text); }
.ob-plan-price{ margin:10px 0 2px; font-size:24px; font-weight:700; letter-spacing:-0.02em; color:var(--ob-text); font-variant-numeric:tabular-nums; }
.ob-plan-price span{ font-size:13px; font-weight:500; color:var(--ob-muted); }
.ob-plan-gst{ font-size:12px; color:var(--ob-subtle); }
.ob-plan ul{ list-style:none; margin:14px 0 0; padding:0; display:flex; flex-direction:column; gap:7px; }
.ob-plan li{ display:flex; gap:8px; font-size:13px; color:var(--ob-muted); line-height:1.35; }
.ob-plan li svg{ flex-shrink:0; color:var(--ob-brand); margin-top:1px; }
.ob-plan-sel{ margin-top:14px; display:flex; align-items:center; gap:6px; font-size:12.5px; font-weight:600; color:var(--ob-brand-dark); opacity:0; transition:opacity .15s; }
.ob-plan.sel .ob-plan-sel{ opacity:1; }
.ob-anchor{ margin:16px 0 0; font-size:12.5px; line-height:1.5; color:var(--ob-subtle); padding:11px 13px; background:#F7F6F3; border-radius:.5rem; }
.ob-cycle{ margin-top:14px; font-size:12.5px; color:var(--ob-subtle); }
.ob-addon{ width:100%; display:flex; align-items:center; gap:13px; text-align:left; margin-top:14px; padding:15px 16px; border:1px solid var(--ob-border-strong); border-radius:.75rem; background:#fff; cursor:pointer; transition:border-color .15s, background .15s; }
.ob-addon.on{ border-color:var(--ob-brand); background:#fbfdfa; }
.ob-addon-check{ width:22px; height:22px; border-radius:6px; flex-shrink:0; border:1.5px solid var(--ob-border-strong); display:flex; align-items:center; justify-content:center; color:#fff; }
.ob-addon.on .ob-addon-check{ background:var(--ob-brand); border-color:var(--ob-brand); }
.ob-addon-t{ flex:1; min-width:0; }
.ob-addon-t b{ display:flex; align-items:center; gap:8px; font-size:14px; color:var(--ob-text); font-weight:600; }
.ob-addon-tag{ font:700 10px 'Manrope',sans-serif; letter-spacing:.04em; text-transform:uppercase; color:var(--ob-brand-dark); background:var(--ob-brand-50); padding:2px 7px; border-radius:50px; }
.ob-addon-t small{ display:block; margin-top:3px; font-size:12.5px; color:var(--ob-muted); line-height:1.45; }
.ob-addon-price{ font:700 15px 'Manrope',sans-serif; color:var(--ob-text); white-space:nowrap; }
.ob-addon-price i{ font-style:normal; font-weight:500; font-size:12px; color:var(--ob-muted); }

/* ---- payment ---- */
.ob-pe{ margin-top:16px; display:flex; flex-direction:column; gap:10px; }
.ob-pe-field{ position:relative; }
.ob-pe-tab{ display:flex; gap:8px; margin-bottom:4px; }
.ob-pe-tab .t{ flex:1; display:flex; align-items:center; justify-content:center; gap:7px; height:42px; border:1px solid var(--ob-border-strong); border-radius:.5rem; font:600 13px 'Manrope'; color:var(--ob-text); background:#fff; }
.ob-pe-tab .t.on{ border-color:var(--ob-brand); box-shadow:0 0 0 2px rgba(90,130,78,0.2); }
.ob-pe input{ width:100%; height:46px; padding:0 14px; border:1px solid var(--ob-border-strong); border-radius:.5rem; background:#fff; font:400 15px 'Manrope'; color:var(--ob-text); outline:none; }
.ob-pe input:focus{ border-color:var(--ob-brand); box-shadow:0 0 0 3px rgba(90,130,78,0.22); }
.ob-pe .card-icon{ position:absolute; right:12px; top:50%; transform:translateY(-50%); font:800 11px 'Manrope',sans-serif; letter-spacing:.1em; color:#1a3aa0; background:#eef1fb; padding:4px 7px; border-radius:4px; }
.ob-pe input.ob-cardno{ padding-right:64px; font-variant-numeric:tabular-nums; letter-spacing:.06em; }
.ob-pe .ob-row2 input{ font-variant-numeric:tabular-nums; }
.ob-trust{ margin:14px 0 0; font-size:12.5px; color:var(--ob-subtle); display:flex; align-items:center; gap:6px; }
.ob-fallback{ margin:8px 0 0; font-size:12.5px; color:var(--ob-subtle); }
.ob-fallback a{ color:var(--ob-brand-dark); font-weight:600; text-decoration:none; cursor:pointer; }
.ob-decline{ display:flex; align-items:center; gap:9px; padding:11px 13px; border:1px solid rgba(220,38,38,0.35); background:rgba(220,38,38,0.06); border-radius:.5rem; color:#b91c1c; font-size:13px; margin-bottom:14px; }

/* ---- capture / invite / kickoff ---- */
.ob-slot{ display:flex; align-items:center; gap:14px; padding:13px 0; border-top:1px solid var(--ob-border); }
.ob-slot:first-child{ border-top:none; }
.ob-slot-l{ flex:1; min-width:0; }
.ob-slot-l b{ display:block; font-size:13.5px; color:var(--ob-text); }
.ob-slot-l small{ font-size:12px; color:var(--ob-subtle); }
.ob-drop{ height:42px; padding:0 14px; display:flex; align-items:center; gap:8px; border:1.5px dashed var(--ob-border-strong); border-radius:.5rem; background:#fff; font:600 13px 'Manrope'; color:var(--ob-muted); cursor:pointer; white-space:nowrap; }
.ob-drop:hover{ border-color:var(--ob-brand-light); color:var(--ob-brand-dark); }
.ob-invite-add{ display:flex; gap:10px; }
.ob-invite-add .ob-input{ flex:1; }
.ob-invite-add button{ flex:none; padding:0 18px; height:48px; border:1px solid var(--ob-border-strong); border-radius:.5rem; background:#fff; font:600 14px 'Manrope',sans-serif; color:var(--ob-brand-dark); cursor:pointer; }
.ob-invite-add button:hover{ background:#F4F3EF; }
.ob-invite-empty{ display:flex; align-items:center; gap:11px; margin-top:14px; padding:15px; border:1px dashed var(--ob-border-strong); border-radius:.625rem; color:var(--ob-muted); font-size:13px; line-height:1.4; }
.ob-invite-empty svg{ color:var(--ob-brand-light); flex-shrink:0; }
.ob-inv-av{ width:28px; height:28px; border-radius:50%; flex-shrink:0; background:var(--ob-brand-50); color:var(--ob-brand-dark); display:flex; align-items:center; justify-content:center; font:700 12px 'Manrope',sans-serif; }
.ob-invite-note{ margin:14px 0 0; font-size:12.5px; color:var(--ob-subtle); }
.ob-invites{ list-style:none; margin:14px 0 0; padding:0; display:flex; flex-direction:column; }
.ob-invites li{ display:flex; align-items:center; gap:10px; padding:11px 0; border-top:1px solid var(--ob-border); font-size:13.5px; }
.ob-invites .em{ font-weight:600; color:var(--ob-text); }
.ob-invites .act{ background:none; border:none; color:var(--ob-brand-dark); font-weight:600; font-size:12.5px; cursor:pointer; }
.ob-pill{ font-size:11px; font-weight:700; padding:3px 9px; border-radius:50px; }
.ob-pill.info{ background:rgba(96,165,250,0.16); color:#1d4ed8; }
.ob-pill.ok{ background:rgba(74,222,128,0.18); color:#15803d; }
.ob-kickoff-lead{ display:flex; align-items:center; gap:13px; padding:13px 15px; border:1px solid var(--ob-border-strong); border-radius:.75rem; background:var(--ob-brand-wash); margin-bottom:16px; }
.ob-kickoff-av{ width:42px; height:42px; border-radius:50%; flex-shrink:0; overflow:hidden; display:flex; align-items:center; justify-content:center; background:var(--ob-brand-dark); color:#fff; font:700 14px 'Manrope'; }
.ob-kickoff-av img{ width:100%; height:100%; object-fit:cover; object-position:50% 30%; }
.ob-kickoff-t{ display:flex; flex-direction:column; }
.ob-kickoff-t b{ font-size:14.5px; color:var(--ob-text); font-weight:600; }
.ob-kickoff-t small{ font-size:12.5px; color:var(--ob-muted); }
.ob-cal{ display:grid; grid-template-columns:repeat(4,1fr); gap:10px; }
.ob-cal-day{ display:flex; flex-direction:column; gap:8px; }
.ob-cal-d{ text-align:center; padding-bottom:4px; }
.ob-cal-d b{ display:block; font-size:13px; color:var(--ob-text); font-weight:700; }
.ob-cal-d span{ font-size:11.5px; color:var(--ob-muted); }
.ob-slots{ display:flex; flex-direction:column; gap:8px; }
.ob-slot-chip{ height:38px; border-radius:.5rem; border:1px solid var(--ob-border-strong); background:#fff; font:600 12.5px 'Manrope'; color:var(--ob-text); cursor:pointer; transition:border-color .12s, background .12s, color .12s; }
.ob-slot-chip:hover{ border-color:var(--ob-brand); }
.ob-slot-chip.on{ background:var(--ob-brand-dark); border-color:var(--ob-brand-dark); color:#fff; }

/* ---- welcome card + loom ---- */
.ob-welcomecard{ border:1px solid var(--ob-border-strong); border-radius:.875rem; padding:18px; background:var(--ob-brand-wash); }
.ob-wc-lead{ display:flex; align-items:center; gap:12px; }
.ob-wc-lead b{ display:block; font-size:14.5px; color:var(--ob-text); font-weight:650; }
.ob-wc-lead small{ font-size:12.5px; color:var(--ob-muted); }
.ob-wc-note{ font-size:14.5px; line-height:1.5; color:var(--ob-text); margin:14px 0 16px; }
.ob-loom{ display:flex; align-items:center; gap:12px; width:100%; text-align:left; padding:11px 13px; border:1px solid var(--ob-border-strong); border-radius:.625rem; background:#fff; cursor:pointer; transition:border-color .14s; }
.ob-loom:hover{ border-color:var(--ob-brand); }
.ob-loom-play{ width:34px; height:34px; flex-shrink:0; border-radius:50%; background:var(--ob-brand-dark); color:#fff; display:flex; align-items:center; justify-content:center; padding-left:2px; }
.ob-loom-t{ flex:1; min-width:0; }
.ob-loom-t b{ display:block; font-size:13.5px; color:var(--ob-text); font-weight:600; }
.ob-loom-t small{ font-size:12px; color:var(--ob-muted); }
.ob-loom-dur{ font:600 12px 'Manrope'; color:var(--ob-muted); flex-shrink:0; }

/* ---- gear preview + photo (team) ---- */
.ob-photo{ display:flex; align-items:center; gap:14px; padding:14px; border:1px solid var(--ob-border-strong); border-radius:.875rem; background:var(--ob-brand-wash); margin-bottom:16px; }
.ob-photo-av{ width:52px; height:52px; flex-shrink:0; border-radius:50%; overflow:hidden; display:flex; align-items:center; justify-content:center; background:var(--ob-brand-dark); color:#fff; font:700 16px 'Manrope'; }
.ob-photo-av img{ width:100%; height:100%; object-fit:cover; }
.ob-photo-t{ flex:1; min-width:0; }
.ob-photo-t b{ display:block; font-size:14px; color:var(--ob-text); font-weight:650; }
.ob-photo-t small{ font-size:12.5px; color:var(--ob-muted); }
.ob-photo .ob-drop{ cursor:pointer; }
.ob-gear{ display:flex; align-items:center; gap:13px; padding:14px 15px; border:1px solid var(--ob-border-strong); border-radius:.875rem; background:#fff; }
.ob-gear-ic{ width:44px; height:44px; flex-shrink:0; border-radius:.625rem; background:var(--ob-brand-wash); color:var(--ob-brand-dark); display:flex; align-items:center; justify-content:center; }
.ob-gear-t{ flex:1; min-width:0; }
.ob-gear-t b{ display:block; font-size:14px; color:var(--ob-text); font-weight:650; }
.ob-gear-t small{ font-size:12.5px; line-height:1.4; color:var(--ob-muted); }

/* ---- success / spinner ---- */
.ob-success{ display:flex; flex-direction:column; align-items:center; text-align:center; padding:14px 0; }
.ob-success .ring{ width:64px; height:64px; border-radius:0 1.5rem 0 1.5rem; background:rgba(90,130,78,0.12); display:flex; align-items:center; justify-content:center; color:var(--ob-brand-dark); animation:ob-pop .4s var(--ob-ease); }
@keyframes ob-pop{ from{ opacity:0; transform:scale(.8); } to{ opacity:1; transform:none; } }
.ob-success h2{ margin:18px 0 0; font-size:19px; font-weight:600; color:var(--ob-text); }
.ob-success p{ margin:6px 0 0; font-size:13.5px; color:var(--ob-muted); }
.ob-spin{ width:18px; height:18px; border:2px solid rgba(66,95,57,0.25); border-top-color:#425F39; border-radius:50%; animation:ob-rot .8s linear infinite; }
@keyframes ob-rot{ to{ transform:rotate(360deg); } }
.ob-fd-options{ display:flex; flex-direction:column; gap:12px; margin:4px 0 6px; }
.ob-fd-opt{ display:flex; align-items:center; gap:14px; width:100%; text-align:left; padding:18px; border:1px solid var(--ob-border-strong); border-radius:.875rem; background:#fff; cursor:pointer; transition:border-color .14s, box-shadow .14s, transform .14s; }
.ob-fd-opt:hover{ border-color:var(--ob-brand); box-shadow:0 8px 24px -16px rgba(26,25,20,0.4); transform:translateY(-1px); }
.ob-fd-opt.rec{ border-color:var(--ob-brand-dark); background:var(--ob-brand-wash); }
.ob-fd-ic{ width:46px; height:46px; flex-shrink:0; border-radius:.75rem; display:flex; align-items:center; justify-content:center; background:var(--ob-brand-dark); color:#fff; }
.ob-fd-opt:not(.rec) .ob-fd-ic{ background:rgba(26,25,20,0.06); color:var(--ob-brand-dark); }
.ob-fd-t{ flex:1; min-width:0; display:flex; flex-direction:column; gap:2px; }
.ob-fd-t b{ font-size:15.5px; color:var(--ob-text); font-weight:650; }
.ob-fd-t small{ font-size:13px; color:var(--ob-muted); }
.ob-fd-go{ color:var(--ob-muted); flex-shrink:0; }
.ob-fd-opt:hover .ob-fd-go{ color:var(--ob-brand-dark); }
.ob-fd-note{ font-size:13px; color:var(--ob-muted); text-align:center; margin:14px 0 0; }
.ob-fd-note a{ color:var(--ob-brand-dark); font-weight:600; cursor:pointer; }

/* ---- responsive (the scene ledger/lead hide; rows stack) ---- */
@media (max-width: 63.99rem){
  .tahi-auth{ display:flex; flex-direction:column; }
  .tahi-auth-scene{ min-height:260px; }
  .ta-scene-content{ padding:36px 26px 30px; }
  .ob-ledger, .ob-lead{ display:none; }
  .ta-headline{ font-size:23px; }
  .tahi-auth-form{ padding:0 16px 28px; margin-top:-24px; }
  .tahi-auth-card{ border-radius:0 1.25rem 0 1.25rem; padding:24px; box-shadow:0 18px 40px -22px rgba(26,25,20,0.22); }
  .ob-plans{ flex-direction:column; }
  .ob-row2{ flex-direction:column; gap:16px; }
  .ob-addon{ flex-wrap:wrap; }
  .ob-addon-price{ width:100%; margin-left:35px; margin-top:4px; }
  .ob-photo{ flex-wrap:wrap; }
  .ob-photo .ob-drop{ width:100%; margin-left:0; justify-content:center; }
  .ob-cal{ grid-template-columns:repeat(2,1fr); }
  .ob-pe-tab{ flex-wrap:wrap; }
}

/* ---- motion safety ---- */
@media (prefers-reduced-motion: reduce){
  .ob-in-up, .ob-in-down, .ob-in-up > *, .ob-in-down > *, .ob-success .ring, .ob-ledger li.active .dot{ animation:none !important; }
  .ob-grow{ transition:none !important; }
}
`
