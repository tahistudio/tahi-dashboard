/** Wallet exposure uses converted values, and excludes base-valued yield rows. */
export function computeWalletForex(
  balances: readonly { accountId: string; currency: string | null; availableBalance: number }[],
  toNzd: (amount: number, currency: string) => number,
) {
  const byCurrency = new Map<string, number>()
  for (const balance of balances) {
    if (balance.accountId.startsWith('yield:')) continue
    const currency = balance.currency ?? 'NZD'
    byCurrency.set(currency, (byCurrency.get(currency) ?? 0) + balance.availableBalance)
  }
  const values = [...byCurrency].map(([currency, available]) => ({ currency, available, nzd: Math.max(0, toNzd(available, currency)) }))
  const totalNzd = values.reduce((sum, value) => sum + value.nzd, 0)
  if (totalNzd <= 0) return { items: [], nzdShare: 0 }
  const items = values.map(value => ({ currency: value.currency, available: value.available, share: totalNzd > 0 ? value.nzd / totalNzd : 0 }))
  return { items, nzdShare: items.find(value => value.currency === 'NZD')?.share ?? 0 }
}
