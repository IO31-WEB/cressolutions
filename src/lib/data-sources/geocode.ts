import { geocodeWithCensus, CensusError, type CensusGeography } from './census'

const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY

/**
 * Census geocoder fails on maybe 5-10% of real-world addresses (new
 * construction, nonstandard formatting, some rural routes). Google
 * Geocoding is the fallback — small per-call cost, but it only fires on
 * the minority of lookups the free option can't handle.
 *
 * NOTE: the Google fallback path returns lat/lng but NOT tract/county FIPS
 * codes (Google doesn't expose those). When this path is used, Census
 * demographics/tract lookups will be skipped for that report — logged so
 * you can see how often this happens in practice.
 */
export async function geocodeAddress(address: string): Promise<CensusGeography & { usedFallback: boolean }> {
  try {
    const result = await geocodeWithCensus(address)
    return { ...result, usedFallback: false }
  } catch (err) {
    if (!(err instanceof CensusError)) throw err
    if (!GOOGLE_API_KEY) throw err

    console.warn(`Census geocoder failed for "${address}", falling back to Google`, err.message)

    const url = new URL('https://maps.googleapis.com/maps/api/geocode/json')
    url.searchParams.set('address', address)
    url.searchParams.set('key', GOOGLE_API_KEY)

    const res = await fetch(url.toString())
    const data = await res.json()
    const match = data.results?.[0]
    if (!match) throw new Error(`Neither Census nor Google could geocode: ${address}`)

    return {
      lat: match.geometry.location.lat,
      lng: match.geometry.location.lng,
      formattedAddress: match.formatted_address,
      stateFips: '',
      countyFips: '',
      tractFips: '',
      countyName: '',
      usedFallback: true,
    }
  }
}
