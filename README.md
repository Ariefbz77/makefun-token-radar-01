# Token Launch Radar

Every pre-token protocol on DefiLlama, ranked by the token value its own
category's live tokens suggest — so a farmer can see, before a launch, which
protocols are worth qualifying for and exactly what to do.

## The idea

A launch is worth farming when the protocol is big and its category's tokens
are priced richly. This radar prices every pre-token protocol the way its
category is priced today:

```
implied value = TVL × category multiple × growth × maturity × breadth
```

- **Category multiple** — the median market-cap-per-TVL of the live-token
  protocols in the same category (at least 5 live protocols, clamped to
  0.05–0.55). A lending protocol is priced like lending, a DEX like a DEX.
  Categories with too few live protocols borrow the snapshot-wide median.
- **Growth** — the protocol's 7-day TVL change, clamped to −60%…+120%,
  weighted at half strength: `1 + change × 0.5`.
- **Maturity** — older protocols earn a higher multiplier, from 0.60 at
  launch to 1.00 after three years; unknown listing dates sit in the middle.
- **Breadth** — 2% per extra chain, capped at +20%, because a launch that
  spans chains reaches more users.

The board covers **all 40 watchlist protocols** plus **every other rankable
pre-token protocol** — 249 more rows, 289 in total — not just the top 40. Each row carries a concrete 7-step farm plan
(main action, a second qualifying action, a weekly rhythm, a hold period,
record-keeping, a points-page check, and a snapshot proof step), tailored to
the protocol's category.

## What is in this repo

- `main.ts` — reads `/input/snapshot.json`, writes the ranked board to
  `/output/board.json`, the dashboard data to `/output/data.js`, and copies
  the dashboard and screenshots into `/output`.
- `lib/model.ts` — the whole model: category multiples from live comparables,
  the implied-value formula, the category-tailored farm steps, and the board
  checks.
- `dashboard/` — the standalone dashboard (no network): podium top-3, the
  category-multiples table, search, category / chain / min-TVL filters,
  watchlist and discovery toggles, sortable columns, and a detail view with the
  full model breakdown, the farm plan and the live comparables.
- `screenshots/` — the three dashboard screenshots.
- `vendor/makefun-board.ts` — the board dossier builder, vendored from the
  competition kit as the rules require.

## Run it

```sh
node main.ts --input input/snapshot.json --output out
```

Node 22 or newer. The snapshot is the DefiLlama protocols list fetched
2026-11-14 (758 protocols, 342 pre-token, 40 on the watchlist).

## Why this radar, not a fixed ratio

A fixed 0.25× multiple (the starter) prices a bridge like a lending
protocol. Real multiples differ by an order of magnitude across categories
(liquid staking ~0.03×, canonical bridges ~0.75×). Using each category's own
median keeps the ranking honest — and the dashboard shows the multiple and
its live comparables next to every row, so the number can be checked.
