// Live account identities and BankSummary layout reported on 2026-10-14.
export const LIVE_YIELD_USD_ID = '73e91625-1db3-4a1c-9479-b5366530a08c'
export const LIVE_YIELD_AUD_ID = '486b3a1f-6b4c-41f9-ae4e-8ac8a35149ee'
export const LIVE_YIELD_USD_NAME = 'AWX_TAHI STUDIO LIMI_Yield_USD'
export const LIVE_YIELD_AUD_NAME = 'AWX_TAHI STUDIO LIMI_Yield_AUD'

export const liveXeroYieldAccounts = {
  Accounts: [
    { AccountID: LIVE_YIELD_USD_ID, Name: LIVE_YIELD_USD_NAME, Type: 'BANK', Status: 'ACTIVE', CurrencyCode: 'USD' },
    { AccountID: LIVE_YIELD_AUD_ID, Name: LIVE_YIELD_AUD_NAME, Type: 'BANK', Status: 'ACTIVE', CurrencyCode: 'AUD' },
    { AccountID: 'wallet-nzd', Name: 'Airwallex NZD', Type: 'BANK', Status: 'ACTIVE', CurrencyCode: 'NZD' },
  ],
}

export const liveXeroYieldOrganisation = { Organisations: [{ BaseCurrency: 'NZD' }] }

export function liveXeroYieldSummary(usd = '44689.56', aud = '666.77') {
  const row = (name: string, id: string, balance: string) => ({
    RowType: 'Row',
    Cells: [
      { Value: name, Attributes: [{ Id: 'accountID', Value: id }] },
      { Value: '0.00' }, { Value: '0.00' }, { Value: '0.00' }, { Value: '0.00' }, { Value: balance },
    ],
  })
  return { Reports: [{ Rows: [
    { RowType: 'Header', Cells: [
      { Value: 'Bank Account' }, { Value: 'Opening Balance' }, { Value: 'Cash Received' },
      { Value: 'Cash Spent' }, { Value: 'FX Gain' }, { Value: 'Closing Balance' },
    ] },
    { RowType: 'Section', Rows: [
      row(LIVE_YIELD_USD_NAME, LIVE_YIELD_USD_ID, usd),
      row(LIVE_YIELD_AUD_NAME, LIVE_YIELD_AUD_ID, aud),
      row('Airwallex NZD', 'wallet-nzd', '999999.99'),
    ] },
  ] }] }
}
