// Token Radar model radar-2: one sealed DefiLlama snapshot in, one ranked board out.
//
// The board covers every slug in the snapshot's watchlist (the floor, never a ceiling) and adds
// every other rankable pre-token protocol outside the watchlist: the discovery rows the radar exists to
// find. A protocol is pre-token when its record carries no token (no market cap, no CoinGecko
// id, no symbol); live-token protocols are kept apart and shown with the market's own values,
// never mixed into the ranked board.
//
// Implied value is derived only from the snapshot's own figures, and every input is shown in
// the dashboard so a reader can check the arithmetic:
//
//   catMult  = median mcap/TVL of the live-token protocols in the same category (n >= 5),
//              clamped to [0.05, 0.55]; categories with fewer live protocols use the
//              whole-snapshot median instead. A multiple is what the market already pays
//              for a token in this line of business, not a number the model invents.
//   base     = tvl_usd x catMult
//   growth   = clamp(change_7d, -60, 120) per cent
//   growthMult = 1 + (growth / 100) x 0.5
//   maturity = 0.6 + min(age_days, 1095) / 1095 x 0.4   (age unknown: 365 days)
//   breadth  = 1 + 0.02 x min(chains - 1, 10)           (up to 1.20: a launch that
//              reaches more chains reaches more buyers)
//   implied  = max(1, round(base x growthMult x maturity x breadth))
//
// No protocol name is ever special-cased: the same function scores every row.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, as the dashboard states them. */
export interface ModelConstants {
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  multiple_floor: number;
  multiple_cap: number;
  multiple_min_live: number;
  breadth_step: number;
  breadth_cap: number;
}

export const MODEL: ModelConstants = {
  growth_weight: 0.5,
  growth_floor: -60,
  growth_cap: 120,
  maturity_floor: 0.6,
  maturity_range: 0.4,
  maturity_days: 1095,
  unknown_age_days: 365,
  multiple_floor: 0.05,
  multiple_cap: 0.55,
  multiple_min_live: 5,
  breadth_step: 0.02,
  breadth_cap: 10,
};

/** The model's version label: the dashboard names it. */
export const MODEL_VERSION = 'radar-2';

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/** How many live comparables the detail view shows per category. */
export const COMPARABLE_ROWS = 5;

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  model: {
    category_multiple: number;
    category_live_n: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    breadth_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** A live-token protocol used as a comparable for its category. */
export interface ComparableRow {
  slug: string;
  name: string;
  tvl_usd: number;
  mcap_usd: number;
  ratio: number;
}

/** One category's multiple, with the live evidence behind it. */
export interface CategoryMultiple {
  category: string;
  multiple: number;
  live_n: number;
  median_ratio: number | null;
}

/** The dashboard's compact view of one row, with its farm plan and comparables. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  category_multiple: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  breadth_multiplier: number;
  farm_steps: string[];
}

/** A live-token protocol: it already trades, so the board shows the market's own value. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** Everything the dashboard needs: the board, the live set, the multiples and the model. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  multiples: CategoryMultiple[];
  rows: RadarRow[];
  live: LiveRow[];
  comparables: Record<string, ComparableRow[]>;
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** The median of a non-empty sorted list, or null. */
function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid]!;
  return (sorted[mid - 1]! + sorted[mid]!) / 2;
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Whether a protocol is one the board may rank: pre-token, not an exchange, not a versioned pool. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && p.category !== 'CEX' && !VERSIONED.test(p.name);
}

/** The live-token protocols grouped by category, for the multiples and the comparables. */
function liveByCategory(snapshot: Snapshot): Map<string, SnapshotProtocol[]> {
  const byCat = new Map<string, SnapshotProtocol[]>();
  for (const p of snapshot.protocols) {
    if (isPreToken(p) || p.mcap_usd === null || p.tvl_usd <= 0) continue;
    const key = p.category ?? 'Other';
    const list = byCat.get(key) ?? [];
    list.push(p);
    byCat.set(key, list);
  }
  return byCat;
}

/**
 * Every category's multiple: the median market-cap-per-TVL of its live-token protocols
 * (at least `multiple_min_live` of them), clamped to [multiple_floor, multiple_cap].
 * A category with too few live protocols borrows the whole snapshot's median instead.
 */
export function categoryMultiples(snapshot: Snapshot, model: ModelConstants = MODEL): CategoryMultiple[] {
  const byCat = liveByCategory(snapshot);
  const allRatios: number[] = [];
  for (const list of byCat.values()) for (const p of list) allRatios.push(p.mcap_usd! / p.tvl_usd);
  const overall = median(allRatios) ?? 0.17;
  const out: CategoryMultiple[] = [];
  for (const [category, list] of [...byCat.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const ratios = list.map((p) => p.mcap_usd! / p.tvl_usd);
    const med = median(ratios);
    const multiple =
      med !== null && list.length >= model.multiple_min_live
        ? Math.min(model.multiple_cap, Math.max(model.multiple_floor, med))
        : Math.min(model.multiple_cap, Math.max(model.multiple_floor, overall));
    out.push({ category, multiple: round4(multiple), live_n: list.length, median_ratio: med === null ? null : round4(med) });
  }
  return out;
}

/** The multiple one category gets, from the table `categoryMultiples` built. */
function multipleFor(category: string | null, multiples: CategoryMultiple[], fallback: number): { multiple: number; live_n: number } {
  const row = multiples.find((m) => m.category === (category ?? 'Other'));
  if (row !== undefined) return { multiple: row.multiple, live_n: row.live_n };
  return { multiple: fallback, live_n: 0 };
}

/** The multipliers and the implied value one protocol gets under `model`. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  multiples: CategoryMultiple[],
  fallbackMultiple: number,
  model: ModelConstants = MODEL,
): { implied: number; categoryMultiple: number; categoryLiveN: number; growthPct: number; growthMult: number; maturityMult: number; breadthMult: number; age: number | null } {
  const age = ageDays(asOf, protocol.listed_at);
  const { multiple, live_n } = multipleFor(protocol.category, multiples, fallbackMultiple);
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult = model.maturity_floor + (Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
  const breadthMult = 1 + model.breadth_step * Math.min(Math.max(protocol.chains.length - 1, 0), model.breadth_cap);
  const base = protocol.tvl_usd * multiple;
  const implied = Math.max(1, Math.round(base * growthMult * maturityMult * breadthMult));
  return { implied, categoryMultiple: multiple, categoryLiveN: live_n, growthPct, growthMult, maturityMult, breadthMult, age };
}

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The category's main action, in the words a farmer can follow. */
function mainActionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Supply $${capital} of USDC to ${name} on ${chain} as collateral and keep the loan-to-value below 50%.`;
  if (c.includes('dex') || c.includes('leveraged farm')) return `Provide $${capital} of liquidity to ${name}'s largest pool on ${chain} and keep the position open.`;
  if (c.includes('bridge')) return `Bridge $${capital} of USDC to ${chain} through ${name} and use the bridged funds in its app.`;
  if (c.includes('staking') || c.includes('restak')) return `Stake $${capital} of the chain's staking asset through ${name} and keep the receipt token.`;
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('options')) return `Deposit $${capital} of USDC as margin on ${name} and open one small hedged position.`;
  if (c.includes('prediction')) return `Fund $${capital} and place one market position on ${name}.`;
  if (c.includes('curator') || c.includes('allocator')) return `Deposit $${capital} into a ${name} vault on ${chain} and keep the shares.`;
  if (c.includes('stable')) return `Mint $${capital} of the stable asset through ${name} on ${chain} and hold it.`;
  if (c.includes('rwa')) return `Mint $${capital} of ${name}'s yield-bearing asset on ${chain} and hold it.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy active.`;
  if (c.includes('yield') || c.includes('farm') || c.includes('leveraged')) return `Deposit $${capital} of USDC into ${name}'s highest-yield vault on ${chain}.`;
  if (c.includes('launchpad')) return `Join one launch on ${name} with $${capital} and hold the allocation.`;
  if (c.includes('payment')) return `Route $${capital} of a real payment through ${name} on ${chain}.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

/** The category's second qualifying action: a different verb from the main one. */
function secondActionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Borrow a small amount against the deposit, then repay it in full to record both sides of the market.`;
  if (c.includes('dex') || c.includes('leveraged farm')) return `Swap a small amount through ${name} each week so the wallet shows trading as well as liquidity.`;
  if (c.includes('bridge')) return `Bridge a small amount back the other way once, so the wallet shows two-way use.`;
  if (c.includes('staking') || c.includes('restak')) return `Use the receipt token once in a lending or liquidity pool on ${chain} so the stake is visibly productive.`;
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('options')) return `Close and reopen a small position once a week to stay active without growing exposure.`;
  if (c.includes('prediction')) return `Settle or close one position a week to keep the account active.`;
  if (c.includes('curator') || c.includes('allocator')) return `Move a small amount between two of the protocol's vaults once to show active allocation.`;
  if (c.includes('stable')) return `Use the minted stable asset in one swap or deposit so the mint is visibly used.`;
  if (c.includes('rwa')) return `Reinvest one yield payout back into the same asset instead of withdrawing it.`;
  if (c.includes('insurance')) return `Renew or extend the cover once before it lapses.`;
  if (c.includes('yield') || c.includes('farm') || c.includes('leveraged')) return `Harvest and compound the yield once a week instead of letting it sit unclaimed.`;
  if (c.includes('launchpad')) return `Vote or stake in one launch-related pool if the protocol offers it.`;
  if (c.includes('payment')) return `Repeat a payment weekly so the volume is steady rather than one-off.`;
  return `Use one more feature of the app each week, such as a swap, a deposit or a vote.`;
}

/** Seven concrete farm steps for one protocol, every one a different action. */
export function farmSteps(p: SnapshotProtocol, age: number | null, model: ModelConstants = MODEL): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const holdDays = holdDaysFor(age);
  const weeks = Math.max(4, Math.ceil(holdDays / 7));
  const capText = `$${capital} of capital`;
  return [
    { text: mainActionFor(p, capital, chain), cost: `${capText}, plus gas`, time: 'One session' },
    { text: secondActionFor(p, capital, chain), cost: 'Gas only', time: 'One session' },
    { text: `Repeat one qualifying action each week for ${weeks} weeks so the activity forms a steady pattern instead of a single burst.`, cost: 'Gas only', time: `${weeks} weeks` },
    { text: `Keep the position open for at least ${holdDays} days; do not exit the day a token announcement appears.`, cost: 'No new cost', time: `${holdDays} days` },
    { text: `Record the transaction hash and the wallet address in one note after every action so the whole history can be proven later.`, cost: 'Free', time: 'Five minutes per action' },
    { text: `Open ${p.name}'s own points or airdrop page once a week and check that this wallet appears as a participant.`, cost: 'Free', time: 'Five minutes a week' },
    { text: `If a snapshot is announced, take a screenshot of the open position and keep it with the transaction hashes.`, cost: 'Free', time: 'Five minutes' },
  ];
}

/** One live-token comparable: its market cap per TVL and its market cap, for the detail view. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string;
  tvl_usd: number;
  mcap_usd: number;
  ratio: number;
}

/** Every live-token protocol in `category`, highest market cap first. */
export function liveRows(snapshot: Snapshot, category: string): LiveRow[] {
  const rows: LiveRow[] = [];
  for (const p of snapshot.protocols) {
    if (isPreToken(p) || p.mcap_usd === null || p.tvl_usd <= 0) continue;
    if ((p.category ?? 'Other') !== category) continue;
    rows.push({ slug: p.slug, name: p.name, category: category, tvl_usd: p.tvl_usd, mcap_usd: p.mcap_usd, ratio: p.mcap_usd / p.tvl_usd });
  }
  rows.sort((a, b) => b.mcap_usd - a.mcap_usd);
  return rows;
}

/** One board row, with the model breakdown the dashboard shows. */
export interface BoardRow {
  slug: string;
  name: string;
  category: string;
  chains: string[];
  rank: number;
  tvl_usd: number;
  implied_value_usd: number;
  category_multiple: number;
  category_live_n: number;
  growth_pct_7d: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  breadth_multiplier: number;
  age_days: number | null;
  farm_steps: string[];
  in_watchlist: boolean;
}

/** The ranked board: every watchlist protocol, then every rankable pre-token protocol, ranked by implied value. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const multiples = categoryMultiples(snapshot, model);
  const fallback = round4(median(multiples.map((m) => m.multiple)) ?? 0.17);
  const rows: BoardRow[] = [];
  const seen = new Set<string>();
  for (const p of snapshot.protocols) {
    if (!isRankable(p, snapshot)) continue;
    if (seen.has(p.slug)) continue;
    seen.add(p.slug);
    const iv = impliedValue(p, snapshot.as_of, multiples, fallback, model);
    rows.push({
      slug: p.slug,
      name: p.name,
      category: p.category ?? 'Other',
      chains: p.chains,
      rank: 0,
      tvl_usd: p.tvl_usd,
      implied_value_usd: iv.implied,
      category_multiple: iv.categoryMultiple,
      category_live_n: iv.categoryLiveN,
      growth_pct_7d: iv.growthPct,
      growth_multiplier: round4(iv.growthMult),
      maturity_multiplier: round4(iv.maturityMult),
      breadth_multiplier: round4(iv.breadthMult),
      age_days: iv.age,
      farm_steps: farmSteps(p, iv.age, model).map((s) => stepText(s)),
      in_watchlist: snapshot.watchlist.includes(p.slug),
    });
  }
  rows.sort((a, b) => b.implied_value_usd - a.implied_value_usd || a.slug.localeCompare(b.slug));
  rows.forEach((r, i) => { r.rank = i + 1; });
  return rows;
}

/** One category's comparables for the dashboard: its multiple, its live count, and its live rows. */
export interface CategoryComparable {
  category: string;
  multiple: number;
  live_n: number;
  live_rows: LiveRow[];
}

/** The comparables for every category on the board. */
export function comparables(snapshot: Snapshot, multiples: CategoryMultiple[]): CategoryComparable[] {
  const cats = new Set<string>();
  for (const p of snapshot.protocols) if (isRankable(p, snapshot)) cats.add(p.category ?? 'Other');
  const out: CategoryComparable[] = [];
  for (const cat of [...cats].sort()) {
    const m = multiples.find((x) => x.category === cat);
    out.push({ category: cat, multiple: m?.multiple ?? 0.17, live_n: m?.live_n ?? 0, live_rows: liveRows(snapshot, cat) });
  }
  return out;
}

/** Everything the dashboard needs: the board, the multiples, the comparables, and the snapshot facts. */
export interface RadarData {
  version: number;
  model: ModelConstants;
  as_of: string;
  source: string;
  floor_usd: number;
  row_count: number;
  watchlist_count: number;
  early_count: number;
  multiples: CategoryMultiple[];
  comparables: CategoryComparable[];
  rows: BoardRow[];
  generated_at: string;
}

/** The radar from one snapshot: board, multiples and comparables in one object. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): RadarData {
  const multiples = categoryMultiples(snapshot, model);
  const rows = buildBoard(snapshot, model);
  const watchlistCount = rows.filter((r) => r.in_watchlist).length;
  return {
    version: 2,
    model,
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    row_count: rows.length,
    watchlist_count: watchlistCount,
    early_count: rows.length - watchlistCount,
    multiples,
    comparables: comparables(snapshot, multiples),
    rows,
    generated_at: new Date().toISOString(),
  };
}

/** `window.TOKEN_RADAR = ...` as one line, so the dashboard runs with no network at all. */
export function dataScript(radar: RadarData): string {
  return `window.TOKEN_RADAR=${JSON.stringify(radar)};`;
}

/** The reason one row would fail the board gate, or null when it passes. */
export function boardIssue(row: BoardRow, index: number, model: ModelConstants = MODEL): string | null {
  if (!row.slug || typeof row.slug !== 'string') return 'row has no slug';
  if (!row.name || row.name.trim().length === 0) return `${row.slug}: name is empty`;
  if (!Number.isInteger(row.rank) || row.rank !== index + 1) return `${row.slug}: rank is ${row.rank}, expected ${index + 1}`;
  if (!Number.isInteger(row.implied_value_usd) || row.implied_value_usd <= 0 || row.implied_value_usd > 1e14) return `${row.slug}: implied value ${row.implied_value_usd} is not a positive whole number below 1e14`;
  if (!Array.isArray(row.farm_steps) || row.farm_steps.length < model.farm_steps_min || row.farm_steps.length > model.farm_steps_max) return `${row.slug}: ${row.farm_steps?.length ?? 0} farm steps, expected ${model.farm_steps_min} to ${model.farm_steps_max}`;
  for (const [i, s] of row.farm_steps.entries()) {
    const t = typeof s === 'string' ? s.trim() : '';
    if (t.length < 20 || t.length > 600) return `${row.slug}: farm step ${i + 1} is ${t.length} characters, expected 20 to 600`;
  }
  return null;
}

/** The snapshot from one parsed JSON value, or an error message when it is not one. */
export function parseSnapshot(value: unknown): { snapshot: Snapshot | null; error: string | null } {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return { snapshot: null, error: 'snapshot JSON is not an object' };
  const v = value as Record<string, unknown>;
  if (typeof v.as_of !== 'string' || v.as_of.trim().length === 0) return { snapshot: null, error: 'snapshot has no as_of date' };
  if (!Array.isArray(v.protocols) || v.protocols.length === 0) return { snapshot: null, error: 'snapshot has no protocols' };
  for (const [i, raw] of v.protocols.entries()) {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return { snapshot: null, error: `protocol at index ${i} is not an object` };
    const p = raw as Record<string, unknown>;
    if (typeof p.slug !== 'string' || p.slug.trim().length === 0) return { snapshot: null, error: `protocol at index ${i} has no slug` };
    if (typeof p.name !== 'string' || p.name.trim().length === 0) return { snapshot: null, error: `protocol at index ${i} has no name` };
    if (typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) return { snapshot: null, error: `protocol ${p.slug} has no numeric tvl_usd` };
  }
  if (!Array.isArray(v.watchlist)) return { snapshot: null, error: 'snapshot has no watchlist array' };
  const snapshot = {
    as_of: v.as_of as string,
    source: typeof v.source === 'string' ? v.source : '',
    floor_usd: typeof v.floor_usd === 'number' ? v.floor_usd : 50_000_000,
    protocols: v.protocols as SnapshotProtocol[],
    watchlist: v.watchlist as string[],
  };
  return { snapshot, error: null };
}
