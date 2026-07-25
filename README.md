# CRE Site Scorecard — Standalone Property Analysis Tool

Built for cressolutions.com. Mari enters a Florida commercial address →
tool pulls free/public data sources → Claude synthesizes a scored report →
she downloads a polished PDF. Single-user internal tool — no lead capture,
no email gate, sits behind a simple password.


## Why this architecture

No paid data aggregator (ATTOM, ESRI, Placer.ai, SafeGraph) is used anywhere
in this pipeline. Every external data source below is either free public-domain
government data, or a metered API billed at effectively $0 at this volume.
That keeps your ongoing cost near-zero while you're covering it out of pocket.

## Data sources (all legally clean — no scraping)

| Category | Source | Auth | Cost |
|---|---|---|---|
| Geocode + tract lookup | Census Geocoder (`geocoding.geo.census.gov`) | none | free |
| Geocode fallback | Google Geocoding API | API key | ~$5/1,000, free tier covers normal volume |
| Demographics, income, age, education | Census ACS 5-Year API | free key (instant signup) | free |
| Anchor tenants / retail density | Google Places API (New) — Nearby Search, **Pro tier only** (no `rating` field, keep it there) | API key | 5,000 free calls/mo; a single-agent site won't clear that |
| Vehicle traffic (AADT) | FDOT ArcGIS REST — `RCI_Layers/FeatureServer/0` | none | free |
| Flood risk | FEMA NFHL ArcGIS REST — `NFHL/MapServer` flood hazard layer | none | free |
| Crime/safety context | FBI Crime Data API | free key from api.data.gov | free |
| Consumer spending power | **Estimated** from Census income × BLS Consumer Expenditure Survey (South region) | n/a (static published tables) | free |
| Narrative + grading synthesis | Claude API (Sonnet) | your existing key | pennies per report |

Every "estimated" figure is labeled as such in the UI and PDF — this matters
both for honesty and because Florida restricts the word "appraisal"/"valuation"
to licensed appraisers. The tool outputs a **Site Quality Score**, not a
valuation, and the PDF carries a disclaimer to that effect.

## Cost control

- Every completed report is cached in Postgres by rounded lat/lng (≈ same
  building) for 60 days — a repeat lookup costs $0.
- The whole site sits behind HTTP Basic Auth (`middleware.ts`) using
  `SITE_USERNAME`/`SITE_PASSWORD` — since this is a single-user internal
  tool, not a public lead-gen page, that's sufficient to keep it off random
  bots' radar and keep API usage to what Mari actually generates.
- PDF generation reads from the cached report data — no external API calls
  happen on a re-download, only the Puppeteer render.

## Stack

Next.js 15 (App Router) · TypeScript · Tailwind · Drizzle + Neon Postgres
(free tier, used as a cache) · Puppeteer + `@sparticuz/chromium` (PDF
render, Vercel-serverless compatible)

## What's in this drop

- `middleware.ts` — HTTP Basic Auth gate for the whole site
- `src/lib/db/schema.ts` — report cache table
- `src/lib/data-sources/` — geocode, Census, Places, FDOT traffic, FEMA
  flood, FBI crime, BLS-derived spend estimate
- `src/lib/grader.ts` — scoring engine + Claude narrative generation
- `src/lib/pdf-template.ts` — the PDF's HTML/CSS design
- `src/app/api/analyze/route.ts` — orchestrates every data source, scores,
  caches, and generates the narrative
- `src/app/api/report/[id]/pdf/route.ts` — renders the cached report to PDF
- `src/app/page.tsx` — the single input-and-results page

This is a complete, deployable first version. Remaining polish items:

1. **`fbi-crime.ts` ORI codes are placeholders** — see the note in that file.
   Without them, the Safety Context category just returns "no data" and its
   weight gets redistributed to the other five categories, so the tool
   works fine without this, it just skips that section.
2. FDOT/FEMA field names are noted as needing a live-hit sanity check.
3. The PDF/UI color palette is a placeholder navy/gold — swap the CSS vars
   in `pdf-template.ts` and `tailwind.config.js` once her new site's brand
   colors are final.

## Setup notes

1. `npm install`
2. Copy `.env.example` → `.env.local` and fill in keys (Neon, Google, Census,
   FBI, Claude, plus `SITE_USERNAME`/`SITE_PASSWORD` for the Basic Auth gate)
3. `npx drizzle-kit push` to create the cache table on your Neon database
4. Deploy to Vercel, set the same env vars there, and set
   `NEXT_PUBLIC_APP_URL` to wherever it's hosted (e.g. a `scorecard.` subdomain)
5. FBI crime lookups only cover Hillsborough, Pinellas, Pasco, and Manatee
   counties out of the box (matches her site's existing service area) — the
   ORI map in `fbi-crime.ts` is a 10-minute job to extend to more FL counties
   later, or skip it entirely (the tool degrades gracefully without it).
