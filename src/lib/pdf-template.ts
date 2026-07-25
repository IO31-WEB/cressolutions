/**
 * Renders the report as an HTML string for Puppeteer to print to PDF.
 *
 * Design: navy/gold, editorial-serif headers over clean sans body — the
 * same register as an institutional CRE offering memorandum, not a
 * consumer-facing marketing page. Easy to reskin once her new site's exact
 * brand palette is finalized; every color lives in the CSS vars at the top.
 */

import type { GradeWeights } from './grader'
import { CATEGORY_LABELS, scoreToGrade } from './grader'
import { LOGO_DATA_URI } from './logo'

interface TemplateData {
  formattedAddress: string
  overallGrade: string
  overallScore: number
  categoryScores: Record<keyof GradeWeights, number>
  generatedDate: string
  rawData: {
    demographics: {
      population: number
      populationGrowth5yr: number
      medianAge: number
      medianHouseholdIncome: number
      medianHomeValue: number
      ownerOccupiedPct: number
      bachelorsPlusPct: number
    } | null
    trafficCounts: Array<{ aadt: number; roadway: string | null; distanceMiles: number }>
    anchors: Array<{ name: string; distanceMiles: number; impact: string }>
    flood: { zone: string; isSpecialFloodHazardArea: boolean; description: string } | null
    crime: { agencyName: string; trend: string } | null
    spendEstimate: { estimatedAnnualHouseholdSpend: number; estimatedTradeAreaSpendTotal: number } | null
  }
  narrative: {
    summary: string
    strengths: string[]
    risks: string[]
    recommendation: string
  } | null
}

function gradeColor(grade: string): string {
  if (grade.startsWith('A')) return '#1E7B4D'
  if (grade.startsWith('B')) return '#3B7DBF'
  if (grade.startsWith('C')) return '#C9A961'
  if (grade.startsWith('D')) return '#C97A2B'
  return '#B3402E'
}

function fmtMoney(n: number): string {
  return n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(1)}M` : `$${Math.round(n).toLocaleString()}`
}

function renderGauge(score: number, grade: string): string {
  const r = 52
  const circumference = 2 * Math.PI * r
  const dash = circumference * Math.min(score, 100) / 100
  const color = gradeColor(grade)
  return `
    <svg width="120" height="120" viewBox="0 0 120 120">
      <circle cx="60" cy="60" r="${r}" fill="none" stroke="rgba(255,255,255,0.15)" stroke-width="10" />
      <circle cx="60" cy="60" r="${r}" fill="none" stroke="${color}" stroke-width="10"
        stroke-dasharray="${dash} ${circumference - dash}" stroke-dashoffset="${circumference * 0.25}"
        stroke-linecap="round" transform="rotate(-90 60 60)" />
      <text x="60" y="56" text-anchor="middle" font-size="30" font-weight="700" fill="white" font-family="'Helvetica Neue', Arial, sans-serif">${grade}</text>
      <text x="60" y="75" text-anchor="middle" font-size="10.5" fill="rgba(255,255,255,0.65)" font-family="'Helvetica Neue', Arial, sans-serif">${score.toFixed(1)} / 100</text>
    </svg>`
}

/** Cover-page "skimmable" chips — the 3 numbers an investor looks for first. */
function renderHighlights(rawData: TemplateData['rawData']): string {
  const chips: string[] = []

  const topTraffic = rawData.trafficCounts[0]
  if (topTraffic) {
    chips.push(`<div class="chip"><div class="chip-value">${topTraffic.aadt.toLocaleString()}</div><div class="chip-label">Vehicles/Day (AADT)</div></div>`)
  }
  if (rawData.demographics) {
    chips.push(`<div class="chip"><div class="chip-value">${rawData.demographics.population.toLocaleString()}</div><div class="chip-label">Tract Population</div></div>`)
  }
  if (rawData.spendEstimate) {
    chips.push(`<div class="chip"><div class="chip-value">${fmtMoney(rawData.spendEstimate.estimatedTradeAreaSpendTotal)}</div><div class="chip-label">Est. Annual Spend Power</div></div>`)
  }
  if (rawData.flood) {
    chips.push(`<div class="chip"><div class="chip-value">${rawData.flood.zone}</div><div class="chip-label">FEMA Flood Zone</div></div>`)
  }

  return chips.length ? `<div class="chip-row">${chips.join('')}</div>` : ''
}

export function renderReportHtml(data: TemplateData): string {
  const {
    formattedAddress, overallGrade, overallScore, categoryScores,
    generatedDate, rawData, narrative,
  } = data

  const categoryRows = (Object.keys(categoryScores) as Array<keyof GradeWeights>)
    .map((key) => {
      const score = categoryScores[key]
      const color = gradeColor(scoreToGrade(score))
      return `
        <div class="cat-row">
          <div class="cat-dot" style="background:${color}"></div>
          <div class="cat-label">${CATEGORY_LABELS[key]}</div>
          <div class="cat-bar-track">
            <div class="cat-bar-fill" style="width:${score}%; background:${color}"></div>
          </div>
          <div class="cat-score" style="color:${color}">${score.toFixed(0)}</div>
        </div>`
    })
    .join('')

  const demo = rawData.demographics
  const demoBlock = demo
    ? `
    <div class="stat-grid">
      <div class="stat"><div class="stat-value">${demo.population.toLocaleString()}</div><div class="stat-label">Census Tract Population</div></div>
      <div class="stat"><div class="stat-value">${demo.populationGrowth5yr > 0 ? '+' : ''}${demo.populationGrowth5yr}%</div><div class="stat-label">5-Year Population Growth</div></div>
      <div class="stat"><div class="stat-value">$${demo.medianHouseholdIncome.toLocaleString()}</div><div class="stat-label">Median Household Income</div></div>
      <div class="stat"><div class="stat-value">${demo.medianAge}</div><div class="stat-label">Median Age</div></div>
      <div class="stat"><div class="stat-value">${demo.bachelorsPlusPct}%</div><div class="stat-label">Bachelor's Degree+</div></div>
      <div class="stat"><div class="stat-value">${demo.ownerOccupiedPct}%</div><div class="stat-label">Owner-Occupied Housing</div></div>
    </div>`
    : `<p class="muted">Demographic data unavailable for this location.</p>`

  const trafficBlock = rawData.trafficCounts.length
    ? `<ul class="plain-list">${rawData.trafficCounts.slice(0, 3).map(t =>
        `<li><strong>${t.aadt.toLocaleString()} AADT</strong> — ${t.roadway ?? 'nearby roadway'} (${t.distanceMiles} mi)</li>`
      ).join('')}</ul>`
    : `<p class="muted">No FDOT traffic count stations within range of this address.</p>`

  const anchorsBlock = rawData.anchors.length
    ? `<ul class="plain-list">${rawData.anchors.slice(0, 8).map(a =>
        `<li><strong>${a.name}</strong> — ${a.distanceMiles} mi <span class="impact-${a.impact}">(${a.impact})</span></li>`
      ).join('')}</ul>`
    : `<p class="muted">No major anchor tenants detected within 1.5 miles.</p>`

  const floodBlock = rawData.flood
    ? `<div class="callout ${rawData.flood.isSpecialFloodHazardArea ? 'callout-warn' : 'callout-good'}">
        <strong>FEMA Zone ${rawData.flood.zone}</strong> — ${rawData.flood.description}
      </div>`
    : `<p class="muted">FEMA flood zone data unavailable for this location.</p>`

  const crimeBlock = rawData.crime
    ? `<p>${rawData.crime.agencyName} jurisdiction — crime trend: <strong>${rawData.crime.trend}</strong></p>`
    : `<p class="muted">Jurisdiction-level crime data not yet available for this county.</p>`

  const spendBlock = rawData.spendEstimate
    ? `<div class="callout callout-neutral">
        <strong>Est. ${fmtMoney(rawData.spendEstimate.estimatedTradeAreaSpendTotal)}</strong> annual spending power in the surrounding census tract
        <div class="fine-print">Estimated from Census income data + BLS Consumer Expenditure Survey benchmarks — a planning-level estimate, not a reported figure.</div>
      </div>`
    : `<p class="muted">Spending estimate unavailable.</p>`

  const narrativeBlock = narrative
    ? `
      <p class="summary">${narrative.summary}</p>
      <div class="two-col">
        <div>
          <h3>Strengths</h3>
          <ul class="plain-list">${narrative.strengths.map(s => `<li>${s}</li>`).join('')}</ul>
        </div>
        <div>
          <h3>Considerations</h3>
          <ul class="plain-list">${narrative.risks.map(r => `<li>${r}</li>`).join('')}</ul>
        </div>
      </div>
      <div class="callout callout-neutral"><strong>Recommendation:</strong> ${narrative.recommendation}</div>`
    : ''

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<style>
  @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;600&family=Inter:wght@400;500;600;700&display=swap');
  :root {
    --navy: #0B1F3A;
    --navy-light: #16305A;
    --gold: #C9A961;
    --ink: #1C1F26;
    --muted: #6B7280;
    --border: #E5E7EB;
    --bg: #FFFFFF;
  }
  * { box-sizing: border-box; }
  body {
    font-family: 'Playfair Display', Georgia, serif;
    color: var(--ink);
    margin: 0;
    background: var(--bg);
  }
  .sans { font-family: 'Inter', 'Helvetica Neue', Arial, sans-serif; }
  .cover {
    background: linear-gradient(135deg, var(--navy) 0%, var(--navy-light) 100%);
    color: white;
    padding: 48px 56px 40px;
    position: relative;
  }
  .cover .brand-logo { position: absolute; top: 36px; right: 56px; height: 64px; width: 64px; border-radius: 50%; }
  .cover .eyebrow { font-family: 'Inter', sans-serif; letter-spacing: 3px; text-transform: uppercase; font-size: 11px; color: var(--gold); margin-bottom: 16px; }
  .cover h1 { font-size: 28px; margin: 0 0 8px; font-weight: 600; line-height: 1.25; }
  .cover .address { font-family: 'Inter', sans-serif; font-size: 13.5px; color: rgba(255,255,255,0.7); margin-bottom: 30px; }
  .grade-row { display: flex; align-items: center; gap: 24px; margin-bottom: 28px; }
  .grade-meta .sq-label { font-family: 'Inter', sans-serif; font-size: 11.5px; letter-spacing: 1px; color: rgba(255,255,255,0.6); text-transform: uppercase; }
  .grade-meta .sq-sub { font-family: 'Inter', sans-serif; font-size: 12.5px; color: rgba(255,255,255,0.75); margin-top: 4px; max-width: 320px; line-height: 1.5; }
  .chip-row { display: flex; gap: 12px; flex-wrap: wrap; }
  .chip { background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.15); border-radius: 8px; padding: 10px 16px; font-family: 'Inter', sans-serif; }
  .chip-value { font-size: 16px; font-weight: 700; color: var(--gold); }
  .chip-label { font-size: 10px; color: rgba(255,255,255,0.65); margin-top: 2px; text-transform: uppercase; letter-spacing: 0.5px; }
  .content { padding: 36px 56px 8px; }
  section { margin-bottom: 30px; page-break-inside: avoid; }
  h2 { font-size: 16px; font-family: 'Inter', sans-serif; font-weight: 600; color: var(--navy); border-bottom: 2px solid var(--gold); padding-bottom: 8px; margin-bottom: 16px; }
  h3 { font-size: 12.5px; font-family: 'Inter', sans-serif; font-weight: 600; color: var(--navy); margin: 0 0 8px; }
  .cat-row { display: flex; align-items: center; gap: 12px; margin-bottom: 10px; font-family: 'Inter', sans-serif; page-break-inside: avoid; }
  .cat-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
  .cat-label { width: 182px; font-size: 12px; color: var(--ink); }
  .cat-bar-track { flex: 1; height: 7px; background: #EEF0F3; border-radius: 4px; overflow: hidden; }
  .cat-bar-fill { height: 100%; border-radius: 4px; }
  .cat-score { width: 30px; text-align: right; font-size: 12px; font-weight: 700; }
  .stat-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; }
  .stat { background: #F7F8FA; border-radius: 6px; padding: 13px 15px; font-family: 'Inter', sans-serif; page-break-inside: avoid; }
  .stat-value { font-size: 19px; font-weight: 700; color: var(--navy); }
  .stat-label { font-size: 10.5px; color: var(--muted); margin-top: 2px; }
  .plain-list { font-family: 'Inter', sans-serif; font-size: 12.5px; padding-left: 18px; margin: 0; }
  .plain-list li { margin-bottom: 6px; }
  .impact-positive { color: #1E7B4D; font-weight: 600; } .impact-negative { color: #B3402E; font-weight: 600; } .impact-neutral { color: var(--muted); }
  .callout { font-family: 'Inter', sans-serif; font-size: 12.5px; border-radius: 6px; padding: 14px 16px; border-left: 4px solid var(--navy); background: #F7F8FA; page-break-inside: avoid; }
  .callout-good { border-left-color: #1E7B4D; }
  .callout-warn { border-left-color: #C97A2B; }
  .callout-neutral { border-left-color: var(--gold); }
  .fine-print { font-size: 10.5px; color: var(--muted); margin-top: 6px; }
  .summary { font-size: 14px; line-height: 1.65; font-family: 'Inter', sans-serif; }
  .two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 26px; margin: 16px 0; }
  .muted { color: var(--muted); font-family: 'Inter', sans-serif; font-size: 12.5px; }
</style>
</head>
<body>
  <div class="cover">
    <img class="brand-logo" src="${LOGO_DATA_URI}" alt="CRES Solutions" />
    <div class="eyebrow">Site Quality Report</div>
    <h1>Commercial Property Analysis</h1>
    <div class="address">${formattedAddress} &nbsp;·&nbsp; Prepared ${generatedDate}</div>
    <div class="grade-row">
      ${renderGauge(overallScore, overallGrade)}
      <div class="grade-meta">
        <div class="sq-label">Site Quality Score</div>
        <div class="sq-sub">A due-diligence starting point synthesized from public Census, FDOT, FEMA, FBI, and retail-density data.</div>
      </div>
    </div>
    ${renderHighlights(rawData)}
  </div>

  <div class="content">
    <section>
      <h2>Score Breakdown</h2>
      ${categoryRows}
    </section>

    <section>
      <h2>Executive Summary</h2>
      ${narrativeBlock}
    </section>

    <section>
      <h2>Traffic Exposure</h2>
      ${trafficBlock}
    </section>

    <section>
      <h2>Demographics — Census Tract</h2>
      ${demoBlock}
    </section>

    <section>
      <h2>Estimated Spending Power</h2>
      ${spendBlock}
    </section>

    <section>
      <h2>Anchor Tenants &amp; Nearby Retail</h2>
      ${anchorsBlock}
    </section>

    <section>
      <h2>Flood Resilience</h2>
      ${floodBlock}
    </section>

    <section>
      <h2>Safety Context</h2>
      ${crimeBlock}
    </section>
  </div>
</body>
</html>`
}
