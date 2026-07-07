'use client'

/**
 * <Money> - the one way to render money in the dashboard.
 *
 * Every monetary figure should go through this component so it automatically
 * participates in the nav-bar display-currency toggle (Decision #042). No page
 * has to wire useDisplayCurrency by hand, and nothing can silently freeze to a
 * single currency. Pass the amount in whatever shape you have it:
 *
 *   <Money nzd={1500} />                     base NZD, converted live to the
 *                                            chosen display currency.
 *   <Money native={1200} currency="GBP" />   preserve a billed currency (an
 *                                            invoice actually charged in GBP).
 *   <Money native={1200} currency="GBP" withDisplay />
 *                                            billed GBP plus " approx NZ$X" when
 *                                            the display currency differs.
 *
 * Add `sensitive` to any figure that should blur under Private view (screen
 * share safe). It tags the node with data-private, the same convention <Private>
 * uses, so money and identity blur through one mechanism.
 */

import type { CSSProperties } from 'react'
import { useDisplayCurrency } from '@/lib/display-currency-context'

type MoneyElement = 'span' | 'b' | 'strong' | 'div' | 'p'

interface MoneyBaseProps {
  /** Blur this figure under Private view (adds data-private). */
  sensitive?: boolean
  /** Element to render. Default 'span'. */
  as?: MoneyElement
  className?: string
  style?: CSSProperties
}

interface MoneyNzdProps extends MoneyBaseProps {
  /** Amount stored in NZD (the base currency). Converted to the display currency. */
  nzd: number
  native?: never
  currency?: never
  withDisplay?: never
}

interface MoneyNativeProps extends MoneyBaseProps {
  /** A native-currency amount to show as billed (the primary is not converted). */
  native: number
  /** ISO currency code for `native` (e.g. 'GBP'). */
  currency: string
  /** Also append the display-currency equivalent when it differs. */
  withDisplay?: boolean
  nzd?: never
}

export type MoneyProps = MoneyNzdProps | MoneyNativeProps

export function Money(props: MoneyProps) {
  const { format, formatNative, formatNativeWithDisplay } = useDisplayCurrency()
  const { as: As = 'span', className, style, sensitive } = props

  let text: string
  if (typeof props.nzd === 'number') {
    text = format(props.nzd)
  } else {
    text = props.withDisplay
      ? formatNativeWithDisplay(props.native, props.currency)
      : formatNative(props.native, props.currency)
  }

  return (
    <As className={className} style={style} data-private={sensitive ? '' : undefined}>
      {text}
    </As>
  )
}
