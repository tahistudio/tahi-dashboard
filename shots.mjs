import { chromium } from 'playwright'
import { readdirSync } from 'node:fs'
const dir = 'C:/Users/Work/Projects/tahi-dashboard/.claude/qa/email-previews'
const keys = readdirSync(dir).filter(f => f.endsWith('.html')).map(f => f.slice(0, -5))
const browser = await chromium.launch()
for (const [name, width] of [['desktop', 640], ['mobile', 375]]) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, deviceScaleFactor: 1 })
  const page = await ctx.newPage()
  for (const k of keys) {
    await page.goto(`file:///${dir}/${k}.html`, { waitUntil: 'load' })
    await page.waitForTimeout(150)
    const sw = await page.evaluate(() => document.documentElement.scrollWidth)
    const overflow = sw > width ? ` OVERFLOW scrollWidth=${sw}` : ''
    await page.screenshot({ path: `${dir}/${k}-${name}.png`, fullPage: true })
    console.log(`${k}-${name}${overflow}`)
  }
  await ctx.close()
}
await browser.close()
