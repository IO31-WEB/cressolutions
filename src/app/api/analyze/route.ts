import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { and, eq, gte } from 'drizzle-orm'
import { db } from '@/lib/db'
import { reports } from '@/lib/db/schema'
import { geocodeAddress } from '@/lib/data-sources/geocode'
import { getTractDemographics } from '@/lib/data-sources/census'
import { getNearbyRetailers } from '@/lib/data-sources/places'
import { getNearbyTrafficCounts } from '@/lib/data-sources/fdot-traffic'
import { getFloodZone } from '@/lib/data-sources/fema-flood'
import { getCrimeContext } from '@/lib/data-sources/fbi-crime'
import { estimateTradeAreaSpend } from '@/lib/data-sources/spend-estimate'
import {
  DEFAULT_WEIGHTS,
  redistributeWeights,
  computeOverallScore,
  scoreToGrade,
  scoreTraffic,
  scoreConsumerSpend,
  scoreDemographics,
  scoreAnchorTenants,
  scoreFloodRisk,
  scoreCrimeContext,
  generateGradeNarrative,
  type GradeWeights,
} from '@/lib/grader'

const CACHE_DAYS = 60
const COORD_PRECISION = 4 // ~11m — same building, different phrasing of the address

const requestSchema = z.object({
  address: z.string().min(5).max(200),
})

function round(n: number): number {
  const factor = 10 ** COORD_PRECISION
  return Math.round(n * factor) / factor
}

export async function POST(req: NextRequest) {
  let parsed: z.infer<typeof requestSchema>
  try {
    parsed = requestSchema.parse(await req.json())
  } catch {
    return NextResponse.json({ error: 'Provide a valid street address.' }, { status: 400 })
  }

  let geo
  try {
    geo = await geocodeAddress(parsed.address)
  } catch {
    return NextResponse.json(
      { error: "Couldn't locate that address. Try including city and state." },
      { status: 422 }
    )
  }

  const latRounded = round(geo.lat)
  const lngRounded = round(geo.lng)

  // Serve from cache if we've already built this exact report recently —
  // this is the main cost control: a repeat lookup costs $0.
  const cached = await db.query.reports.findFirst({
    where: and(
      eq(reports.latRounded, latRounded),
      eq(reports.lngRounded, lngRounded),
      gte(reports.expiresAt, new Date())
    ),
  })
  if (cached) {
    return NextResponse.json({ reportId: cached.id, cached: true, ...serialize(cached) })
  }

  // Fan out to every free data source in parallel. Each is wrapped so one
  // source going down doesn't take out the whole report — missing data
  // gets redistributed in the scoring weights instead.
  const [demographics, retailers, trafficCounts, flood, crime] = await Promise.all([
    geo.usedFallback
      ? Promise.resolve(null)
      : getTractDemographics(geo).catch(() => null),
    getNearbyRetailers(geo.lat, geo.lng).catch(() => []),
    getNearbyTrafficCounts(geo.lat, geo.lng).catch(() => []),
    getFloodZone(geo.lat, geo.lng).catch(() => null),
    geo.countyFips ? getCrimeContext(geo.countyFips).catch(() => null) : Promise.resolve(null),
  ])

  const spendEstimate = demographics
    ? estimateTradeAreaSpend(demographics.medianHouseholdIncome, demographics.population)
    : null

  const traffic = scoreTraffic(trafficCounts)
  const spend = scoreConsumerSpend(spendEstimate)
  const demo = scoreDemographics(demographics)
  const anchor = scoreAnchorTenants(retailers)
  const flood_ = scoreFloodRisk(flood)
  const crime_ = scoreCrimeContext(crime)

  const categoryScores: Record<keyof GradeWeights, number> = {
    traffic: traffic.score,
    consumerSpend: spend.score,
    demographics: demo.score,
    anchorTenant: anchor.score,
    floodRisk: flood_.score,
    crime: crime_.score,
  }

  const missing = (Object.entries({
    traffic: traffic.hasData, consumerSpend: spend.hasData, demographics: demo.hasData,
    anchorTenant: anchor.hasData, floodRisk: flood_.hasData, crime: crime_.hasData,
  })
    .filter(([, hasData]) => !hasData)
    .map(([key]) => key)) as Array<keyof GradeWeights>

  const weights = redistributeWeights(DEFAULT_WEIGHTS, missing)
  const overallScore = computeOverallScore(categoryScores, weights)
  const overallGrade = scoreToGrade(overallScore)

  const narrative = await generateGradeNarrative({
    address: geo.formattedAddress,
    overallGrade,
    overallScore,
    categoryScores,
    anchors: anchor.anchors,
    demographics,
    trafficCounts,
    flood,
    crime,
    spendEstimate,
  }).catch(() => null)

  const rawData = { demographics, trafficCounts, anchors: anchor.anchors, flood, crime, spendEstimate }

  const [inserted] = await db
    .insert(reports)
    .values({
      inputAddress: parsed.address,
      formattedAddress: geo.formattedAddress,
      lat: geo.lat,
      lng: geo.lng,
      latRounded,
      lngRounded,
      county: geo.countyName || null,
      stateFips: geo.stateFips || null,
      countyFips: geo.countyFips || null,
      tractFips: geo.tractFips || null,
      overallScore,
      overallGrade,
      categoryScores,
      rawData,
      narrative,
      expiresAt: new Date(Date.now() + CACHE_DAYS * 24 * 60 * 60 * 1000),
    })
    .returning()

  return NextResponse.json({ reportId: inserted.id, cached: false, ...serialize(inserted) })
}

function serialize(report: typeof reports.$inferSelect) {
  return {
    formattedAddress: report.formattedAddress,
    overallScore: report.overallScore,
    overallGrade: report.overallGrade,
    categoryScores: report.categoryScores,
    rawData: report.rawData,
    narrative: report.narrative,
  }
}
