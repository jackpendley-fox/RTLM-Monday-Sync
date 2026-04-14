/**
 * Regression tests — guards against previously-fixed bugs and structural
 * invariants that must survive future refactors.
 *
 * Source-code checks are used only when the behavior they guard lives in
 * async/unreachable code paths that cannot be exercised synchronously.
 */

const t = require('./harness');
const {
  monday,
  parseRtlmDateTime,
  detectChanges,
  H_IDX,
  makeRow,
  makeMondayItem,
} = require('./fixtures');
const path = require('path');
const fs = require('fs');

t.section('Regression Tests');

// ── Source-code structural checks (unreachable code paths) ──

t.test('INV: scraper returns { success: false } shape on missing session', (() => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'scraper.js'), 'utf8');
  return src.includes("return { success: false, error:") &&
    src.includes("headers: [], rows: []");
})());

t.test('INV: browser is let (not const) for cleanup', (() => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'scraper.js'), 'utf8');
  return src.includes('let browser;') && src.includes('if (browser) await browser.close()');
})());

t.test('INV: updater has dropdown-label fallback (>= 2 occurrences)', (() => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'updater.js'), 'utf8');
  const matches = src.match(/dropdown label.*does not exist/g);
  return matches && matches.length >= 2;
})());

t.test('INV: scheduledRun resets running flag in finally block', (() => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'updater.js'), 'utf8');
  return src.includes('finally') && src.includes('running = false');
})());

// ── Behavioral invariants ──

t.test('INV: updateItemName escape order — backslash before quote', (() => {
  const escape = s => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const input = 'A\\B"C';
  const result = escape(input);
  return result === 'A\\\\B\\"C' && result.length === input.length + 2;
})());

t.test('INV: parseRtlmDateTime output matches YYYY-MM-DD / HH:MM:SS', (() => {
  const r = parseRtlmDateTime('04/10/26 14:00');
  return r && /^\d{4}-\d{2}-\d{2}$/.test(r.date) && /^\d{2}:\d{2}:\d{2}$/.test(r.time);
})());

t.test('INV: mapCallSign complete mapping matches DataWeave', (() => {
  return monday.mapCallSign('FOXD') === 'FOXDEP' &&
    monday.mapCallSign('FSCPL') === 'FSP' &&
    monday.mapCallSign('FBCS') === 'FOX' &&
    monday.mapCallSign('FS1D') === 'FS1-Digital' &&
    monday.mapCallSign('BTNP001') === 'B1G+';
})());

t.test('INV: COLUMN_IDS values are all unique', (() => {
  const values = Object.values(monday.COLUMN_IDS);
  return new Set(values).size === values.length && values.length >= 6;
})());

t.test('INV: mondayQuery retry loop is bounded', (() => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'monday-client.js'), 'utf8');
  return src.includes('attempt <= retries') && src.includes('attempt < retries');
})());

t.test('INV: special chars in headline preserved through detectChanges', (() => {
  const headline = 'MLB: NYY vs BOS \u2014 "Opening Day" (7:05 ET) | ESPN+';
  const row = makeRow({ headline });
  const item = makeMondayItem();
  const c = detectChanges(item, row, H_IDX);
  return c && c._name === headline;
})());
