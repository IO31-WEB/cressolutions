import {
  pgTable,
  text,
  timestamp,
  doublePrecision,
  jsonb,
  serial,
  boolean,
  index,
} from 'drizzle-orm/pg-core'

/**
 * A generated report, cached by rounded lat/lng so a repeat lookup of the
 * same building never re-triggers Places/Claude calls. Rounding to 4 decimal
 * places (~11m precision) is tight enough to distinguish neighboring parcels
 * while still catching "same address typed slightly differently."
 */
export const reports = pgTable(
  'reports',
  {
    id: serial('id').primaryKey(),
    inputAddress: text('input_address').notNull(),
    formattedAddress: text('formatted_address').notNull(),
    lat: doublePrecision('lat').notNull(),
    lng: doublePrecision('lng').notNull(),
    latRounded: doublePrecision('lat_rounded').notNull(),
    lngRounded: doublePrecision('lng_rounded').notNull(),
    county: text('county'),
    stateFips: text('state_fips'),
    countyFips: text('county_fips'),
    tractFips: text('tract_fips'),

    overallScore: doublePrecision('overall_score').notNull(),
    overallGrade: text('overall_grade').notNull(),

    // Per-category 0-100 scores
    categoryScores: jsonb('category_scores').notNull(),

    // Raw normalized data pulled from each source, kept for the PDF and
    // for debugging/re-rendering without re-fetching
    rawData: jsonb('raw_data').notNull(),

    // Claude-generated narrative
    narrative: jsonb('narrative'),

    createdAt: timestamp('created_at').defaultNow().notNull(),
    expiresAt: timestamp('expires_at').notNull(), // cache TTL, default +60d
  },
  (table) => ({
    locationIdx: index('reports_location_idx').on(table.latRounded, table.lngRounded),
  })
)

/**
 * Simple sliding-window rate limit — one row per IP per UTC day.
 * Avoids standing up Redis for a volume this low.
 */
export const rateLimits = pgTable('rate_limits', {
  id: serial('id').primaryKey(),
  ip: text('ip').notNull(),
  day: text('day').notNull(), // 'YYYY-MM-DD'
  count: integer('count').default(1).notNull(),
  blocked: boolean('blocked').default(false).notNull(),
})

export type Report = typeof reports.$inferSelect
export type NewReport = typeof reports.$inferInsert
