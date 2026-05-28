# Not built — by design.

Google's public Indexing API (`/v3/urlNotifications:publish`) is officially
restricted to two content types:

- JobPosting structured data
- BroadcastEvent (live-stream) structured data

Submitting any other URL (including blog posts) is silently ignored at best,
or risks an API key suspension at worst.

What we use instead:

- IndexNow → covers Bing + Yandex. See `../indexnow/route.ts`.
- Google → no programmatic resubmission. We rely on:
  1. A healthy sitemap (Webflow generates one automatically at
     https://www.tahi.studio/sitemap.xml)
  2. Internal linking (Slice 6 will surface orphan posts)
  3. Manual "Request indexing" in Google Search Console for high-priority
     posts (one-off, can't be automated)
  4. Genuine recrawl from inbound links

If Google ever opens the Indexing API to general content, drop a route here.
For now: do not build this.

Reference: https://developers.google.com/search/apis/indexing-api/v3/quickstart
