/**
 * FBI Crime Data API — free, public domain, requires a free api.data.gov key.
 * Base: https://api.usa.gov/crime/fbi/sapi/api/summarized/agencies/{ORI}/{offense}
 *
 * Crime data here is reported at the LAW ENFORCEMENT AGENCY (jurisdiction)
 * level, not by address — there's no free source that's more granular than
 * that. We present it as county/city-level safety context, not a hyperlocal
 * score, which is an honest framing of what this data actually is.
 *
 * IMPORTANT — action needed before shipping:
 * The ORI (Originating Agency Identifier) codes below are placeholders and
 * MUST be replaced with real codes before this goes live. Getting this wrong
 * would silently attribute the wrong agency's crime data to a report, which
 * is worse than showing no data at all. Look up real ORIs in ~5 min at
 * https://cde.ucr.cjis.gov/LATEST/webapp/#/pages/downloads — search by
 * agency name, the ORI is shown on each agency's profile page. Do this for
 * at minimum: Tampa PD, St. Petersburg PD, Clearwater PD, Bradenton PD, and
 * the Hillsborough/Pinellas/Pasco/Manatee County Sheriff's Offices.
 */

const FBI_API_BASE = 'https://api.usa.gov/crime/fbi/sapi/api'
const FBI_API_KEY = process.env.FBI_CRIME_API_KEY

// county FIPS (Florida, state FIPS 12) → primary reporting agency ORI
// TODO: replace with verified ORIs — see note above.
const COUNTY_TO_ORI: Record<string, { agencyName: string; ori: string }> = {
  '057': { agencyName: 'Hillsborough County Sheriff\'s Office', ori: '' }, // Hillsborough
  '103': { agencyName: 'Pinellas County Sheriff\'s Office', ori: '' },     // Pinellas
  '101': { agencyName: 'Pasco County Sheriff\'s Office', ori: '' },        // Pasco
  '081': { agencyName: 'Manatee County Sheriff\'s Office', ori: '' },      // Manatee
}

export interface CrimeContext {
  agencyName: string
  violentCrimeCount: number | null
  propertyCrimeCount: number | null
  year: number | null
  trend: 'improving' | 'worsening' | 'flat' | 'unknown'
}

async function fetchOffenseSummary(
  ori: string,
  offense: 'violent-crime' | 'property-crime'
): Promise<Array<{ data_year: number; actual: number }>> {
  const url = `${FBI_API_BASE}/summarized/agencies/${ori}/${offense}?api_key=${FBI_API_KEY}`
  const res = await fetch(url)
  if (!res.ok) return []
  const data = await res.json()
  return data?.results ?? []
}

/**
 * Returns null gracefully (rather than throwing) whenever the county isn't
 * mapped yet or the ORI is still a placeholder — the grader treats missing
 * crime data as a neutral, weight-redistributed category, same pattern as
 * ListOps handles missing anchor-tenant data.
 */
export async function getCrimeContext(countyFips: string): Promise<CrimeContext | null> {
  const agency = COUNTY_TO_ORI[countyFips]
  if (!agency || !agency.ori || !FBI_API_KEY) return null

  const [violent, property] = await Promise.all([
    fetchOffenseSummary(agency.ori, 'violent-crime'),
    fetchOffenseSummary(agency.ori, 'property-crime'),
  ])

  const latestViolent = violent.sort((a, b) => b.data_year - a.data_year)[0]
  const latestProperty = property.sort((a, b) => b.data_year - a.data_year)[0]
  const priorViolent = violent.find((v) => v.data_year === (latestViolent?.data_year ?? 0) - 1)

  let trend: CrimeContext['trend'] = 'unknown'
  if (latestViolent && priorViolent) {
    const delta = latestViolent.actual - priorViolent.actual
    trend = Math.abs(delta) < priorViolent.actual * 0.03 ? 'flat' : delta < 0 ? 'improving' : 'worsening'
  }

  return {
    agencyName: agency.agencyName,
    violentCrimeCount: latestViolent?.actual ?? null,
    propertyCrimeCount: latestProperty?.actual ?? null,
    year: latestViolent?.data_year ?? latestProperty?.data_year ?? null,
    trend,
  }
}
