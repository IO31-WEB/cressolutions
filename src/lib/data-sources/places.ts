/**
 * Google Places API (New) — Nearby Search, anchor tenant + retail density.
 *
 * Adapted from ListOps' places-enrichment.ts. One change that matters for
 * cost: the field mask below intentionally OMITS `rating`/`userRatingCount`.
 * Requesting those bumps every call from the Pro SKU ($32/1,000) to the
 * Enterprise SKU ($35-40/1,000) for data we don't actually use in scoring.
 * Pro tier also carries a larger free monthly allotment (5,000 calls) —
 * at this site's expected volume that should mean $0/month in practice.
 */

const PLACES_API_KEY = process.env.GOOGLE_API_KEY
const SEARCH_RADIUS_METERS = 2414 // 1.5 miles

export type RetailerCategory =
  | 'big_box'
  | 'grocery'
  | 'pharmacy'
  | 'fast_food'
  | 'fast_casual'
  | 'other'

export interface Retailer {
  name: string
  distanceMiles: number
  category: RetailerCategory
}

export class PlacesError extends Error {
  constructor(
    message: string,
    public readonly code: 'NO_API_KEY' | 'GEOCODE_FAILED' | 'PLACES_FAILED'
  ) {
    super(message)
    this.name = 'PlacesError'
  }
}

const TYPE_CATEGORY_MAP: Record<string, RetailerCategory> = {
  department_store: 'big_box',
  furniture_store: 'big_box',
  hardware_store: 'big_box',
  home_goods_store: 'big_box',
  electronics_store: 'big_box',
  shopping_mall: 'big_box',
  supermarket: 'grocery',
  pharmacy: 'pharmacy',
  drugstore: 'pharmacy',
  fast_food_restaurant: 'fast_food',
  meal_takeaway: 'fast_food',
  restaurant: 'fast_casual',
  cafe: 'fast_casual',
}

const BIG_BOX_NAMES = [
  'walmart', 'target', 'costco', "sam's club", "bj's wholesale",
  'home depot', "lowe's", 'best buy', "dick's sporting goods",
  'tj maxx', 't.j. maxx', 'marshalls', 'ross', 'burlington',
  'five below', 'dollar tree', 'dollar general', 'family dollar',
]
const GROCERY_NAMES = [
  'publix', 'kroger', 'whole foods', 'trader joe', 'aldi', 'sprouts',
  'winn-dixie', 'food lion', 'safeway', 'wegmans', 'heb', 'sedano',
]
const FAST_CASUAL_NAMES = [
  'chipotle', 'panera', 'five guys', 'shake shack', 'sweetgreen',
  "chick-fil-a", "raising cane's", 'wingstop', 'panda express',
]
const FAST_FOOD_NAMES = [
  "mcdonald's", 'burger king', 'wendy', 'taco bell', 'subway',
  'domino', 'pizza hut', 'papa john', 'kfc', 'popeyes', 'sonic',
]

function classifyByName(name: string): RetailerCategory | null {
  const lower = name.toLowerCase()
  if (BIG_BOX_NAMES.some((n) => lower.includes(n))) return 'big_box'
  if (GROCERY_NAMES.some((n) => lower.includes(n))) return 'grocery'
  if (FAST_CASUAL_NAMES.some((n) => lower.includes(n))) return 'fast_casual'
  if (FAST_FOOD_NAMES.some((n) => lower.includes(n))) return 'fast_food'
  return null
}

function haversineMiles(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 3958.8
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLng = ((lng2 - lng1) * Math.PI) / 180
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

async function searchNearbyPlaces(lat: number, lng: number): Promise<any[]> {
  if (!PLACES_API_KEY) throw new PlacesError('GOOGLE_API_KEY is not configured', 'NO_API_KEY')

  const res = await fetch('https://places.googleapis.com/v1/places:searchNearby', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': PLACES_API_KEY,
      // Pro-tier field mask only — no rating/reviews/atmosphere fields.
      'X-Goog-FieldMask': 'places.displayName,places.types,places.location',
    },
    body: JSON.stringify({
      includedTypes: [
        'supermarket', 'department_store', 'hardware_store', 'home_goods_store',
        'electronics_store', 'pharmacy', 'drugstore', 'shopping_mall',
        'furniture_store', 'fast_food_restaurant', 'meal_takeaway', 'restaurant', 'cafe',
      ],
      maxResultCount: 20,
      locationRestriction: {
        circle: { center: { latitude: lat, longitude: lng }, radius: SEARCH_RADIUS_METERS },
      },
      rankPreference: 'DISTANCE',
    }),
  })

  if (!res.ok) {
    throw new PlacesError(`Places API error ${res.status}: ${await res.text()}`, 'PLACES_FAILED')
  }
  const data = await res.json()
  return data.places ?? []
}

export async function getNearbyRetailers(lat: number, lng: number): Promise<Retailer[]> {
  const places = await searchNearbyPlaces(lat, lng)

  return places
    .map((p): Retailer | null => {
      const name = p.displayName?.text
      const placeLat = p.location?.latitude
      const placeLng = p.location?.longitude
      if (!name || !placeLat || !placeLng) return null

      const nameCategory = classifyByName(name)
      const typeCategory = p.types
        ?.map((t: string) => TYPE_CATEGORY_MAP[t])
        .find(Boolean) as RetailerCategory | undefined
      const category = nameCategory ?? typeCategory ?? 'other'
      if (category === 'other' && !nameCategory) return null

      return {
        name,
        distanceMiles: Math.round(haversineMiles(lat, lng, placeLat, placeLng) * 100) / 100,
        category,
      }
    })
    .filter((r): r is Retailer => r !== null)
    .filter((r, i, arr) => arr.findIndex((x) => x.name.toLowerCase() === r.name.toLowerCase()) === i)
    .sort((a, b) => a.distanceMiles - b.distanceMiles)
}
