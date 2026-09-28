# Measurement aggregate correction (2026-09-28)

New CSV summaries carry `metadata.measurementAggregationVersion: 1`. The CSV
builder computes Zone Contact using only zone swings/whiffs, excludes pitches
with missing coordinates from Chase denominators, and retains null for absent
Extension / release means. This keeps measured zero distinct from no measurement.

`repairLegacyAggregates` normalizes older summaries on reading in the browser
and public analysis API. It does not rewrite R2, bundled JSON, raw CSV, or active
version pointers. It adjusts only:

- Batter Zone Contact and Chase, plus the existing Chase percentile using the
  original PA >= 20 population, tie convention and 1–99 bounds.
- Pitcher Chase.
- An existing Extension / release mean of zero only when every corresponding
  published pitch measurement is missing. A genuine measured zero is retained.
- Copies of those fields in players and highlights.

Official batting records, expected batting, pitch quality, post-September-23
player development fields, pitches, games and unrelated aggregates are preserved.
The repair is immutable and idempotent, and skips a partial pitch container when
its length does not match metadata.pitches. Fresh version-1 summaries are skipped.

Legacy pitch coordinates have already been rounded to three decimals. Repairs
therefore use the published pitch coordinates, including boundary positions.
They are tagged `metadata.measurementAggregationRepair: published-pitches-v1`.
This is not a raw-CSV-precision rebuild. New ingestion uses raw-coordinate
precision and is protected from this read-time recalculation by the version flag.

## Impact on the v137 bundled data

| Season | Pitches | Batter Zone Contact corrected | Negative Zone Contact before → after | Batter / pitcher Chase corrected | Pitch types with missing Extension / height / side corrected |
| --- | ---: | ---: | ---: | ---: | ---: |
| 2025 fall | 8,460 | 102 | 8 → 0 | 28 / 14 | 5 / 5 / 5 |
| 2026 spring | 11,943 | 104 | 5 → 0 | 33 / 23 | 5 / 5 / 5 |
| 2026 fall | 4,134 | 80 | 9 → 0 | 7 / 6 | 1 / 1 / 1 |

There are respectively 33 / 57 / 16 published pitches on a zone-boundary
coordinate. These are not all errors; their original side of the exact boundary
cannot be recovered from three-decimal coordinates alone.

## Verification

`tests/measurement-boundaries.test.ts` covers missing versus measured-zero
semantics, count annotation, velocity / movement / direction filters, missing
batted-ball coordinates, legacy repairs and fresh-summary exclusion. It verifies
all three bundled seasons, permitting changes only at the specific paths above
and proving the input object and unrelated fields are unchanged.

Targeted command: `node --experimental-strip-types --test tests/measurement-boundaries.test.ts tests/scouting-analytics.test.ts tests/batter-profile.test.ts`

24 tests passed. Isolated full-project `tsc --noEmit --incremental false` passed.
Publication and browser checks are performed by the release owner after integration.
