/**
 * FBI Crime Data API — free, public domain, requires a free api.data.gov key.
 * Base: https://api.usa.gov/crime/fbi/sapi/api/summarized/agencies/{ORI}/{offense}
 *
 * Crime data here is reported at the LAW ENFORCEMENT AGENCY (jurisdiction)
 * level, not by address — there's no free source that's more granular than
 * that. We present it as county/city-level safety context, not a hyperlocal
 * score, which is an honest framing of what this data actually is.
 *
 * ORI codes verified against the UCR ORI-Agency Look-up Table for Florida
 * (ICPSR/NACJD: https://www.icpsr.umich.edu/files/NACJD/ORIs/12oris.html).
 * Pattern for county sheriff: FL + 3-digit UCR county code + 0000
 * (e.g. Hillsborough UCR 029 → FL0290000).
 *
 * To add more counties later, pull the full FL agency list once with:
 *   https://api.usa.gov/crime/fbi/sapi/api/agencies/byStateAbbr/FL?api_key=YOUR_KEY
 * and map county FIPS → primary sheriff ORI (prefer *COUNTY SHERIFF'S OFFICE*).
 */

const FBI_API_BASE = 'https://api.usa.gov/crime/fbi/sapi/api'
const FBI_API_KEY = process.env.FBI_CRIME_API_KEY

// county FIPS (Florida, state FIPS 12) → primary reporting agency ORI
// Verified sheriff ORIs from NACJD UCR look-up (ORI9 column).
const COUNTY_TO_ORI: Record<string, { agencyName: string; ori: string }> = {
  // Tampa Bay core service area
  '057': { agencyName: "Hillsborough County Sheriff's Office", ori: 'FL0290000' }, // was FL0290500 (DLE office — wrong)
  '103': { agencyName: "Pinellas County Sheriff's Office", ori: 'FL0520000' },
  '101': { agencyName: "Pasco County Sheriff's Office", ori: 'FL0510000' },
  '081': { agencyName: "Manatee County Sheriff's Office", ori: 'FL0410000' },
  '021': { agencyName: "Collier County Sheriff's Office", ori: 'FL0110000' },
  // Extended West / Central Florida coverage
  '115': { agencyName: "Sarasota County Sheriff's Office", ori: 'FL0580000' },
  '053': { agencyName: "Hernando County Sheriff's Office", ori: 'FL0270000' },
  '105': { agencyName: "Polk County Sheriff's Office", ori: 'FL0530000' },
  '071': { agencyName: "Lee County Sheriff's Office", ori: 'FL0360000' },
  '015': { agencyName: "Charlotte County Sheriff's Office", ori: 'FL0080000' },
  '017': { agencyName: "Citrus County Sheriff's Office", ori: 'FL0090000' },
  '095': { agencyName: "Orange County Sheriff's Office", ori: 'FL0480000' },
  '099': { agencyName: "Palm Beach County Sheriff's Office", ori: 'FL0500000' },
  '011': { agencyName: "Broward County Sheriff's Office", ori: 'FL0060000' },
  '086': { agencyName: "Miami-Dade Police Department", ori: 'FL0130000' }, // Miami-Dade FIPS
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
  if (!res.ok) {
    console.error(
      `FBI crime API failed for ${ori}/${offense}: ${res.status} ${res.statusText}`,
      await res.text().catch(() => '')
    )
    return []
  }
  const data = await res.json()
  return data?.results ?? []
}

/**
 * Returns null gracefully (rather than throwing) whenever the county isn't
 * mapped yet or the API key is missing — the grader treats missing crime
 * data as a neutral, weight-redistributed category.
 */
export async function getCrimeContext(countyFips: string): Promise<CrimeContext | null> {
  const agency = COUNTY_TO_ORI[countyFips]
  if (!agency || !agency.ori || !FBI_API_KEY) {
    if (!FBI_API_KEY) console.warn('FBI_CRIME_API_KEY not set — safety context skipped')
    else if (!agency) console.warn(`No ORI mapped for county FIPS ${countyFips}`)
    return null
  }

  const [violent, property] = await Promise.all([
    fetchOffenseSummary(agency.ori, 'violent-crime'),
    fetchOffenseSummary(agency.ori, 'property-crime'),
  ])

  const latestViolent = violent.sort((a, b) => b.data_year - a.data_year)[0]
  const latestProperty = property.sort((a, b) => b.data_year - a.data_year)[0]
  const priorViolent = violent.find((v) => v.data_year === (latestViolent?.data_year ?? 0) - 1)

  // Prefer violent-crime trend; fall back to property-crime if violent has no prior year
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

  // If the API returned nothing usable, treat as no data (don't invent a score)
  if (!latestViolent && !latestProperty) {
    console.warn(`FBI API returned no crime results for ORI ${agency.ori} (${agency.agencyName})`)
    return null
  }

  return {
    agencyName: agency.agencyName,
    violentCrimeCount: latestViolent?.actual ?? null,
    propertyCrimeCount: latestProperty?.actual ?? null,
    year: latestViolent?.data_year ?? latestProperty?.data_year ?? null,
    trend,
  }
}
