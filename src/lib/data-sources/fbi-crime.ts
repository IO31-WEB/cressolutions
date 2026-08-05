/**
 * FBI Crime Data Explorer (CDE) API — free, requires a free api.data.gov key.
 *
 * The legacy SAPI path (`/sapi/api/summarized/agencies/...`) is unreliable /
 * often 404. The current public path is the CDE summarized agency endpoint:
 *   https://api.usa.gov/crime/fbi/cde/summarized/agency/{ORI}/{offense}
 *   ?from=MM-YYYY&to=MM-YYYY&API_KEY=...
 *
 * Crime data is at the LAW ENFORCEMENT AGENCY level, not by address. We
 * present it as county/city-level safety context, not a hyperlocal score.
 *
 * ORI codes verified against NACJD UCR look-up for Florida.
 */

const FBI_API_KEY = process.env.FBI_CRIME_API_KEY

// county FIPS (Florida, state FIPS 12) → primary reporting agency ORI
const COUNTY_TO_ORI: Record<string, { agencyName: string; ori: string }> = {
  // Tampa Bay core — city PD for downtown-dense counties where available
  '057': { agencyName: "Tampa Police Department", ori: 'FL0290200' }, // Hillsborough / Tampa PD
  '103': { agencyName: "Pinellas County Sheriff's Office", ori: 'FL0520000' },
  '101': { agencyName: "Pasco County Sheriff's Office", ori: 'FL0510000' },
  '081': { agencyName: "Manatee County Sheriff's Office", ori: 'FL0410000' },
  '021': { agencyName: "Collier County Sheriff's Office", ori: 'FL0110000' },
  '115': { agencyName: "Sarasota County Sheriff's Office", ori: 'FL0580000' },
  '053': { agencyName: "Hernando County Sheriff's Office", ori: 'FL0270000' },
  '105': { agencyName: "Polk County Sheriff's Office", ori: 'FL0530000' },
  '071': { agencyName: "Lee County Sheriff's Office", ori: 'FL0360000' },
  '015': { agencyName: "Charlotte County Sheriff's Office", ori: 'FL0080000' },
  '017': { agencyName: "Citrus County Sheriff's Office", ori: 'FL0090000' },
  '095': { agencyName: "Orange County Sheriff's Office", ori: 'FL0480000' },
  '099': { agencyName: "Palm Beach County Sheriff's Office", ori: 'FL0500000' },
  '011': { agencyName: "Broward County Sheriff's Office", ori: 'FL0060000' },
  '086': { agencyName: "Miami-Dade Police Department", ori: 'FL0130000' },
}

// Fallback ORIs if the primary returns no data (e.g. city PD sparse → sheriff)
const COUNTY_FALLBACK_ORI: Record<string, { agencyName: string; ori: string }> = {
  '057': { agencyName: "Hillsborough County Sheriff's Office", ori: 'FL0290000' },
}

export interface CrimeContext {
  agencyName: string
  violentCrimeCount: number | null
  propertyCrimeCount: number | null
  year: number | null
  trend: 'improving' | 'worsening' | 'flat' | 'unknown'
}

type YearCount = { data_year: number; actual: number }

/**
 * Parse whatever shape the CDE returns into year → count pairs.
 * Response formats have varied; be defensive.
 */
function parseYearCounts(data: unknown): YearCount[] {
  if (!data || typeof data !== 'object') return []

  const root = data as Record<string, unknown>

  // Shape A: { results: [{ data_year, actual }] }  (legacy SAPI)
  if (Array.isArray(root.results)) {
    return (root.results as Array<Record<string, unknown>>)
      .map((r) => ({
        data_year: Number(r.data_year ?? r.year ?? r.dataYear),
        actual: Number(r.actual ?? r.count ?? r.value ?? r.actual_count),
      }))
      .filter((r) => Number.isFinite(r.data_year) && Number.isFinite(r.actual))
  }

  // Shape B: { offenses: { actuals: { "2022": 123, ... } } } or similar CDE
  const offenses = root.offenses as Record<string, unknown> | undefined
  if (offenses?.actuals && typeof offenses.actuals === 'object') {
    return Object.entries(offenses.actuals as Record<string, unknown>)
      .map(([year, val]) => ({ data_year: Number(year), actual: Number(val) }))
      .filter((r) => Number.isFinite(r.data_year) && Number.isFinite(r.actual))
  }

  // Shape C: top-level array of monthly/yearly rows
  if (Array.isArray(root.data)) {
    const byYear = new Map<number, number>()
    for (const row of root.data as Array<Record<string, unknown>>) {
      const y = Number(row.data_year ?? row.year ?? row.dataYear)
      const v = Number(row.actual ?? row.count ?? row.value ?? row.offense_count)
      if (!Number.isFinite(y) || !Number.isFinite(v)) continue
      byYear.set(y, (byYear.get(y) ?? 0) + v)
    }
    return Array.from(byYear.entries()).map(([data_year, actual]) => ({ data_year, actual }))
  }

  // Shape D: { "2022": { actual: n } } or { "2022": n }
  const yearKeys = Object.keys(root).filter((k) => /^\d{4}$/.test(k))
  if (yearKeys.length) {
    return yearKeys
      .map((y) => {
        const v = root[y]
        const actual =
          typeof v === 'number'
            ? v
            : Number((v as Record<string, unknown>)?.actual ?? (v as Record<string, unknown>)?.count)
        return { data_year: Number(y), actual }
      })
      .filter((r) => Number.isFinite(r.actual))
  }

  return []
}

async function fetchOffenseSummary(
  ori: string,
  offense: 'violent-crime' | 'property-crime'
): Promise<YearCount[]> {
  if (!FBI_API_KEY) return []

  const toYear = new Date().getFullYear() - 1
  const fromYear = toYear - 4

  // Primary: current CDE summarized agency endpoint
  const cdeUrl =
    `https://api.usa.gov/crime/fbi/cde/summarized/agency/${ori}/${offense}` +
    `?from=01-${fromYear}&to=12-${toYear}&API_KEY=${FBI_API_KEY}`

  try {
    const res = await fetch(cdeUrl)
    if (res.ok) {
      const data = await res.json()
      const parsed = parseYearCounts(data)
      if (parsed.length) return parsed
      console.warn(
        `CDE returned OK but no parseable counts for ${ori}/${offense}`,
        JSON.stringify(data).slice(0, 400)
      )
    } else {
      const body = await res.text().catch(() => '')
      console.error(`CDE crime API ${res.status} for ${ori}/${offense}:`, body.slice(0, 300))
    }
  } catch (e) {
    console.error(`CDE crime API network error for ${ori}/${offense}:`, e)
  }

  // Fallback: legacy SAPI path (still works for some ORIs)
  const sapiUrl =
    `https://api.usa.gov/crime/fbi/sapi/api/summarized/agencies/${ori}/${offense}` +
    `?api_key=${FBI_API_KEY}`
  try {
    const res = await fetch(sapiUrl)
    if (res.ok) {
      const data = await res.json()
      return parseYearCounts(data)
    }
  } catch {
    /* ignore */
  }

  return []
}

async function fetchAgencyCrime(
  agency: { agencyName: string; ori: string }
): Promise<CrimeContext | null> {
  const [violent, property] = await Promise.all([
    fetchOffenseSummary(agency.ori, 'violent-crime'),
    fetchOffenseSummary(agency.ori, 'property-crime'),
  ])

  const latestViolent = [...violent].sort((a, b) => b.data_year - a.data_year)[0]
  const latestProperty = [...property].sort((a, b) => b.data_year - a.data_year)[0]
  if (!latestViolent && !latestProperty) return null

  const priorViolent = violent.find((v) => v.data_year === (latestViolent?.data_year ?? 0) - 1)

  let trend: CrimeContext['trend'] = 'unknown'
  if (latestViolent && priorViolent && priorViolent.actual > 0) {
    const delta = latestViolent.actual - priorViolent.actual
    trend =
      Math.abs(delta) < priorViolent.actual * 0.03
        ? 'flat'
        : delta < 0
          ? 'improving'
          : 'worsening'
  } else if (latestProperty) {
    const priorProperty = property.find((v) => v.data_year === (latestProperty.data_year ?? 0) - 1)
    if (priorProperty && priorProperty.actual > 0) {
      const delta = latestProperty.actual - priorProperty.actual
      trend =
        Math.abs(delta) < priorProperty.actual * 0.03
          ? 'flat'
          : delta < 0
            ? 'improving'
            : 'worsening'
    }
  }

  return {
    agencyName: agency.agencyName,
    violentCrimeCount: latestViolent?.actual ?? null,
    propertyCrimeCount: latestProperty?.actual ?? null,
    year: latestViolent?.data_year ?? latestProperty?.data_year ?? null,
    trend,
  }
}

/**
 * Returns null gracefully when the county isn't mapped, the key is missing,
 * or both primary and fallback ORIs return no data.
 */

async function fetchStateOffenseSummary(
  offense: 'violent-crime' | 'property-crime'
): Promise<YearCount[]> {
  if (!FBI_API_KEY) return []
  const toYear = new Date().getFullYear() - 1
  const fromYear = toYear - 4
  const url =
    `https://api.usa.gov/crime/fbi/cde/summarized/state/FL/${offense}` +
    `?from=01-${fromYear}&to=12-${toYear}&API_KEY=${FBI_API_KEY}`
  try {
    const res = await fetch(url)
    if (!res.ok) {
      console.error(`CDE state crime API ${res.status} for FL/${offense}:`, (await res.text()).slice(0, 300))
      return []
    }
    const data = await res.json()
    const parsed = parseYearCounts(data)
    if (!parsed.length) {
      console.warn(`CDE state OK but unparseable for FL/${offense}:`, JSON.stringify(data).slice(0, 500))
    }
    return parsed
  } catch (e) {
    console.error('CDE state network error', e)
    return []
  }
}

export async function getCrimeContext(countyFips: string): Promise<CrimeContext | null> {
  if (!FBI_API_KEY) {
    console.warn('FBI_CRIME_API_KEY not set — safety context skipped')
    return null
  }

  const primary = COUNTY_TO_ORI[countyFips]
  if (!primary) {
    console.warn(`No ORI mapped for county FIPS ${countyFips}`)
    return null
  }

  const primaryResult = await fetchAgencyCrime(primary)
  if (primaryResult) return primaryResult

  const fallback = COUNTY_FALLBACK_ORI[countyFips]
  if (fallback) {
    console.warn(`Primary ORI ${primary.ori} returned no data; trying fallback ${fallback.ori}`)
    const fallbackResult = await fetchAgencyCrime(fallback)
    if (fallbackResult) return fallbackResult
  }

  // Last resort: Florida statewide estimates so Safety is not blank for FL sites
  // when local ORIs return nothing (common for NIBRS-only agencies).
  console.warn(
    `Agency ORIs returned no data for FIPS ${countyFips}; trying FL statewide estimates`
  )
  const stateCounts = await fetchStateOffenseSummary('violent-crime')
  const stateProp = await fetchStateOffenseSummary('property-crime')
  const latestV = [...stateCounts].sort((a, b) => b.data_year - a.data_year)[0]
  const latestP = [...stateProp].sort((a, b) => b.data_year - a.data_year)[0]
  if (latestV || latestP) {
    const priorV = stateCounts.find((v) => v.data_year === (latestV?.data_year ?? 0) - 1)
    let trend: CrimeContext['trend'] = 'unknown'
    if (latestV && priorV && priorV.actual > 0) {
      const delta = latestV.actual - priorV.actual
      trend =
        Math.abs(delta) < priorV.actual * 0.03
          ? 'flat'
          : delta < 0
            ? 'improving'
            : 'worsening'
    }
    return {
      agencyName: 'State of Florida (statewide estimate)',
      violentCrimeCount: latestV?.actual ?? null,
      propertyCrimeCount: latestP?.actual ?? null,
      year: latestV?.data_year ?? latestP?.data_year ?? null,
      trend,
    }
  }

  console.warn(
    `No crime data for county FIPS ${countyFips} (tried ${primary.ori}${fallback ? ` and ${fallback.ori}` : ''} and FL state)`
  )
  return null
}
