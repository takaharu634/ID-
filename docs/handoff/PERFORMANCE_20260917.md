# Daily analysis performance candidate — 2026-09-17

Status: published as Sites 102 on 2026-09-17; deployment succeeded and 52 delivered files match the validated build. No production data or access settings were changed. The publication record is kept in CHANGELOG.md after Sites confirms deployment.

## Scope

This candidate starts from published/main source and contains lossless data transport and repeated-computation reductions, plus the compatible dependency updates and code-check repairs recorded below. The older `qa/print-game-video-20260915` branch is preserved separately; its PDF/video/report changes are not included or represented as completed.

Both apps index players by ID for batting pitch-type aggregation, build defensive-shift groups in one pass, and memoize unchanged player filters and leaderboard configuration. Data formulas and original CSV/JSON, auth/API, game engine, storage/recovery and print CSS remain unchanged. Savant also precomputes pie-chart arcs without changing rendered markup; an unused analytics helper was removed. All three seasons have unique player IDs.

`node scripts/verify-analysis-performance.mjs BASELINE_SHA` checks every batting pitch-type result, the exact React server-rendered HTML of three real leaderboard views, player pitcher/batter/catcher views, and the shift view for all three seasons. 21 view comparisons per site pass; data mutation checks pass. Timing is a CPU-only microbenchmark (15 warmups, 50 alternating samples), not end-to-end page or mobile latency.

## Publication follow-up — 2026-09-17

The initial candidate stopped on dependency audit findings and Savant lint errors. On the user's subsequent publication request:

- Upgraded `next` and matching `eslint-config-next` from 16.2.6 to 16.3.5, plus compatible lockfile updates. Updated `baseline-browser-mapping` within its existing version range. Final online `npm audit --omit=dev`: exit 0, 0 vulnerabilities on both sites.
- Savant's pie-chart arcs are computed before JSX; all 329 batter/season report markups across three seasons match the original exactly. This is React markup equality, not final PDF visual QA.
- Removed unused function/import/parameter references and gave runner/worker test events explicit types. The existing heterogeneous `Row` boundary retains its legacy `any` with one documented line-level exception; no global lint rules were disabled or type-safety migration claimed.
- Full lint exits 0 on both sites (Lab: 7 warnings; Savant: 4 warnings). The upgraded Next rule advises client navigation instead of existing full-page navigation. Existing auth/admin/recovery navigation behavior is preserved. No errors remain. Typecheck passes both.
- Final data/regression tests: Lab engine 224/224 and autumn 23/23; Savant unit 51/51, autumn 24/24, batter report 5/5. Both have exact parity for all batting pitch-type rows and 21 rendered analysis views; original data mutation checks pass.
- Sites standard production build and artifact validation: exit 0. Post-build rendered HTML checks: 12/12.
- No migration, database write, external dataset pointer update, auth change, or old QA-branch merge. This is a bounded performance/dependency release. Historical migration/ownership acceptance items are not relabeled PASS. The user has explicitly authorized publication.
- No final PDF artifact visual QA or installed-PWA/physical-phone test is claimed. Existing supervised browser observations below predate the dependency update; production build/deploy and post-publication checks are recorded separately.

## Savant

Baseline/live: `cc00755623907327491111cc481fff558a6249d0`, Sites 101.

Existing compact data transport is retained. This candidate reduces repeated CPU work only, including stable filtered profile inputs.

| Season | Pitches | Aggregation median before → after |
|---|---:|---:|
| 2026 spring | 11,943 | 17.538 → 7.447 ms |
| 2026 autumn | 2,364 | 1.896 → 0.677 ms |
| 2025 autumn | 8,460 | 11.934 → 4.499 ms |

Initial candidate checks: `test:unit` 51/51; `test:autumn` 24/24; typecheck pass; Sites production build pass; rendered HTML 12/12; diff whitespace check pass. Changed app/performance script lint: 0 errors, one unchanged unused `navigate` warning.

The previous candidate's whole-project lint failures are resolved as described above. Original datasets, API/save code and print CSS are unchanged. The pie-chart refactor is covered by exact markup equality for all 329 batter/season combinations.

Browser (supervised preview, real UI): autumn home 2,364 pitches / 8 games; 石野蓮授 detail 57 pitches, left-pitcher filter 40 pitches; pitch-type tab reflects the filter; profile changes from 133.8 km/h (left, 5 valid contacts) to 141.7 km/h (all, 9 contacts) after reset. Batting pitch-type leaderboard filters by 國學院大學 + 石野 and returns 6 pitch-type rows. Spring switch reaches 11,943 pitches / 40 games, SHIFT shows 16 infield candidates. These are browser observations, separate from CPU timing and SSR parity. No PDF export or real-device PWA claim.

Publication follow-up browser check after dependency update: autumn 2,364 pitches / 8 games; Ishino left-pitcher filter 40 pitches, 133.8 km/h and 5 valid contacts; reset 57 pitches, 141.7 km/h and 9 contacts. Sites 102 source: `fb264c5648d63cd2c7123fe6fffc4aec73479dde`; rollback: Sites 101. Deployment and post-publication evidence are recorded in CHANGELOG.md.
