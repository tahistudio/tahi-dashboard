/** Compact NZD for the shared cash-flow caption. Safe in browser bundles. */
export function formatCompactNzd(nzd: number): string {
  const sign = nzd < 0 ? '-' : ''
  const abs = Math.abs(nzd)
  if (abs >= 1000) {
    const k = abs / 1000
    const num = k >= 100 ? String(Math.round(k)) : k.toFixed(1).replace(/\.0$/, '')
    return `${sign}NZ$${num}k`
  }
  return `${sign}NZ$${Math.round(abs)}`
}

/** One basis for the forecast API and home caption. */
export function cashFlowBasisLine(
  parts: { retainerNzd: number; projectRunRateNzd: number },
  format: (nzd: number) => string = formatCompactNzd,
): string {
  return `Retainers ${format(parts.retainerNzd)} + project run-rate ${format(parts.projectRunRateNzd)}`
    + ' + weighted pipeline, minus commitments'
}
