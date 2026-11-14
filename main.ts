/**
 * Token Launch Radar — main.ts (radar-2).
 *
 * Reads a DefiLlama protocol snapshot from /input/snapshot.json (or --input
 * <file|dir>), ranks every pre-token protocol by the implied token value its
 * live-token peers suggest, and writes the board, the dashboard data and the
 * dossier into the output directory.
 *
 * Usage:
 *   node main.ts --input <snapshot.json> --output <dir>
 *   MAKEFUN_INPUT_DIR / MAKEFUN_OUTPUT_DIR set the same paths by env.
 *   With no flags, input defaults to /input and output to $MAKEFUN_OUTPUT_DIR
 *   or /output, the paths the grader mounts.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, cpSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildRadar, parseSnapshot, boardIssue, dataScript, MODEL } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** The scorer's own caps: the text cap shapes the dossier bytes, the rest refuse. */
const TEXT_MAX_BYTES = 65_536;
const SCREENSHOT_CAPS = { max: 4, max_bytes: 524_288 };
const IMAGE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

/** --name <value> out of the arguments, or the fallback. */
function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const withEquals = process.argv.find((a) => a.startsWith(`--${name}=`));
  return withEquals === undefined ? fallback : withEquals.slice(name.length + 3);
}

/** The snapshot from a file path, or an error message when it cannot be read or parsed. */
function loadSnapshot(inputPath: string): { snapshot: ReturnType<typeof parseSnapshot>['snapshot']; error: string | null } {
  let text: string;
  try {
    text = readFileSync(inputPath, 'utf8');
  } catch (e) {
    return { snapshot: null, error: `cannot read snapshot at ${inputPath}: ${(e as Error).message}` };
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (e) {
    return { snapshot: null, error: `snapshot at ${inputPath} is not valid JSON: ${(e as Error).message}` };
  }
  return parseSnapshot(value);
}

/** Every board gate failure for this radar, in one list. */
function boardErrors(radar: ReturnType<typeof buildRadar>): string[] {
  const errors: string[] = [];
  if (radar.rows.length < 100 || radar.rows.length > 4000) errors.push(`board has ${radar.rows.length} rows, expected 100 to 4000`);
  const values = radar.rows.map((r) => r.implied_value_usd);
  if (values.length > 1 && values.every((v) => v === values[0])) errors.push('every implied value is the same');
  for (let i = 1; i < radar.rows.length; i += 1) {
    if (radar.rows[i]!.implied_value_usd > radar.rows[i - 1]!.implied_value_usd) errors.push(`board is not sorted by implied value at rank ${i + 1}`);
  }
  radar.rows.forEach((row, i) => {
    const issue = boardIssue(row, i, MODEL);
    if (issue !== null) errors.push(issue);
  });
  const seen = new Set<string>();
  for (const r of radar.rows) {
    if (seen.has(r.slug)) errors.push(`duplicate slug ${r.slug}`);
    seen.add(r.slug);
  }
  return errors;
}

/** One directory's regular files copied into `to`, skipping names that start with a dot. */
function copyFiles(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(from).sort()) {
    if (name.startsWith('.')) continue;
    const path = join(from, name);
    if (!statSync(path).isFile()) continue;
    cpSync(path, join(to, name));
    copied.push(name);
  }
  return copied;
}

/** The one entry point: read, build, check, write, report. */
function main(): void {
  const inputArg = arg('input', process.env.MAKEFUN_INPUT_DIR ?? '/input');
  const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
  if (!existsSync(inputFile)) {
    console.error(`token radar: no snapshot at ${inputFile}: pass --input <snapshot.json|directory>`);
    process.exit(2);
  }
  const out = arg('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');
  console.log(`token-radar radar-2: input ${inputFile}`);
  const loaded = loadSnapshot(inputFile);
  if (loaded.error !== null || loaded.snapshot === null) {
    console.error(loaded.error ?? 'snapshot failed to load');
    process.exit(1);
  }
  const snapshot = loaded.snapshot;
  const radar = buildRadar(snapshot);
  console.log(`snapshot as_of ${radar.as_of}: ${snapshot.protocols.length} protocols, ${snapshot.watchlist.length} on the watchlist`);
  console.log(`board: ${radar.row_count} rows (${radar.watchlist_count} watchlist + ${radar.early_count} early), top ${radar.rows[0]?.name} at $${radar.rows[0]?.implied_value_usd.toLocaleString('en-US')}`);
  const errors = boardErrors(radar);
  if (errors.length > 0) {
    for (const e of errors.slice(0, 20)) console.error(`gate: ${e}`);
    process.exit(1);
  }
  mkdirSync(out, { recursive: true });
  const boardPath = join(out, 'board.json');
  const dataPath = join(out, 'data.js');
  writeFileSync(boardPath, `${JSON.stringify({ rows: radar.rows })}\n`, 'utf8');
  writeFileSync(dataPath, `${dataScript(radar)}\n`, 'utf8');
  const boardSize = statSync(boardPath).size;
  const dataSize = statSync(dataPath).size;
  if (boardSize > 8 * 1024 * 1024) {
    console.error(`gate: board.json is ${boardSize} bytes, over the 8 MiB limit`);
    process.exit(1);
  }
  const dashFiles = copyFiles(join(__dirname, 'dashboard'), join(out, 'dashboard'));
  if (dashFiles.length < 3) {
    console.error(`token radar: dashboard/ holds ${dashFiles.length} files: hand in index.html, app.css and app.js`);
    process.exit(1);
  }
  const shots = copyFiles(join(__dirname, 'screenshots'), join(out, 'screenshots'));
  if (shots.length < 3) {
    console.error(`token radar: screenshots/ holds ${shots.length} image${shots.length === 1 ? '' : 's'}: hand in 3, the board, a detail view and a filtered view`);
    process.exit(1);
  }
  for (const name of shots) {
    if (!IMAGE_NAME.test(name)) {
      console.error(`token radar: screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters`);
      process.exit(1);
    }
  }
  // The dossier is written last: the scorer rebuilds it from this /output and compares bytes.
  writeFileSync(join(out, 'dossier.json'), buildDossier(out, { text_max_bytes: TEXT_MAX_BYTES, screenshots: SCREENSHOT_CAPS, dashboard: { max_files: 400, max_bytes: 4_194_304 } }));
  const dossierSize = statSync(join(out, 'dossier.json')).size;
  console.log(`wrote ${boardPath} (${boardSize} bytes), ${dataPath} (${dataSize} bytes), dashboard/ (${dashFiles.length} files), screenshots/ (${shots.length} images), dossier.json (${dossierSize} bytes)`);
  console.log(`done: ${radar.row_count} ranked pre-token protocols, ${radar.multiples.length} category multiples`);
}

main();
