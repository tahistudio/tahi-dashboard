/**
 * lib/theme-boot-script.ts
 *
 * The blocking <head> script app/layout.tsx inlines so the stored theme is on
 * <html> before first paint: `.dark` from localStorage['tahi-theme'] and
 * `.reduce-motion` from localStorage['tahi-reduce-motion'].
 *
 * Paths under `publicDocumentPrefix` (the /p/ proposal, schedule and contract
 * viewers) never get `.dark`: those documents carry their own slide theming
 * for an external reader, and the dashboard's stored preference used to
 * paint them dark until app/p/layout.tsx removed the class after hydration.
 * Reduced motion still applies there; it is an accessibility preference,
 * not a theme.
 *
 * Lives here rather than in the layout so a test can run the exact string.
 */
export function themeBootScript(publicDocumentPrefix: string): string {
  const prefix = JSON.stringify(publicDocumentPrefix)
  return `try{if(location.pathname.indexOf(${prefix})!==0&&localStorage.getItem('tahi-theme')==='dark'){document.documentElement.classList.add('dark')}if(localStorage.getItem('tahi-reduce-motion')==='true'){document.documentElement.classList.add('reduce-motion')}}catch(e){}`
}
