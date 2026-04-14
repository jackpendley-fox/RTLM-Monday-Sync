/**
 * Functional tests — business-logic scenarios that compose multiple functions.
 * Tests key matching, change detection, row transformation, archival, and
 * realistic API payloads.
 */

const t = require('./harness');
const {
  monday,
  buildKeyFromScraped,
  buildKeyFromMonday,
  rowToMondayValues,
  detectChanges,
  isArchivalCandidate,
  parseRtlmDateTime,
  H_IDX,
  makeRow,
  makeMondayItem,
} = require('./fixtures');

t.section('Functional Tests');

// ── Key building ──

t.test('scraped key matches Monday key (standard)', (() => {
  const row = makeRow();
  const item = makeMondayItem();
  const sKey = buildKeyFromScraped(row, H_IDX);
  const mKey = buildKeyFromMonday(item);
  return sKey === mKey && sKey === 'EP123456|FS1' &&
    sKey.split('|').length === mKey.split('|').length;
})());

t.test('B1G+ scraped matches B1G+ Monday (three-part key)', (() => {
  const row = makeRow({ callSign: 'BTNP005', mediaSource: 'DTC - BTNP005' });
  const item = makeMondayItem({ callSign: 'B1G+', mediaSource: 'BTNP005' });
  const sKey = buildKeyFromScraped(row, H_IDX);
  const mKey = buildKeyFromMonday(item);
  return sKey === mKey && sKey === 'EP123456|B1G+|BTNP005' &&
    sKey.split('|').length === 3;
})());

t.test('FOXD scraped key uses FOXDEP', (() => {
  const row = makeRow({ callSign: 'FOXD' });
  const key = buildKeyFromScraped(row, H_IDX);
  return key === 'EP123456|FOXDEP' && !key.includes('FOXD|');
})());

t.test('B1G+ key asymmetry: empty Monday media source never matches scraped', (() => {
  const row = makeRow({ callSign: 'BTNP005', mediaSource: '' });
  const item = makeMondayItem({ callSign: 'B1G+', mediaSource: '' });
  const sKey = buildKeyFromScraped(row, H_IDX);
  const mKey = buildKeyFromMonday(item);
  return sKey !== mKey &&
    sKey === 'EP123456|B1G+|BTNP005' &&
    mKey === 'EP123456|B1G+|';
})());

// ── Change detection ──

t.test('detectChanges: no changes returns null (not empty object)', (() => {
  const row = makeRow();
  const item = makeMondayItem();
  const c = detectChanges(item, row, H_IDX);
  return c === null;
})());

t.test('detectChanges: multi-field change (headline + start + foxId)', (() => {
  const startUtc = parseRtlmDateTime('04/11/26 10:00');
  const row = makeRow({ headline: 'New Game', startTime: '04/11/26 10:00', foxId: 'EPI_X' });
  const item = makeMondayItem();
  const c = detectChanges(item, row, H_IDX);
  return c && c._name === 'New Game' &&
    c[monday.COLUMN_IDS.START_TIME].date === startUtc.date &&
    c[monday.COLUMN_IDS.FOXIPEDIA_ID] === 'EPI_X';
})());

t.test('detectChanges: end time rolls past midnight', (() => {
  const row = makeRow({ endTime: '04/10/26 20:00' });
  const item = makeMondayItem();
  const c = detectChanges(item, row, H_IDX);
  return c && c[monday.COLUMN_IDS.END_TIME] &&
    c[monday.COLUMN_IDS.END_TIME].date === '2026-04-11' &&
    c[monday.COLUMN_IDS.END_TIME].time === '00:00:00';
})());

t.test('detectChanges: mediaSources aggregation overrides row', (() => {
  const row = makeRow({ mediaSource: 'DTC - BTNP001' });
  const item = makeMondayItem({ mediaSource: 'BTNP005' });
  const c = detectChanges(item, row, H_IDX, ['BTNP005', 'BTNP010']);
  return c && c[monday.COLUMN_IDS.MEDIA_SOURCE] &&
    c[monday.COLUMN_IDS.MEDIA_SOURCE].labels.includes('BTNP005') &&
    c[monday.COLUMN_IDS.MEDIA_SOURCE].labels.includes('BTNP010');
})());

t.test('detectChanges: multi-label no change when sorted equal', (() => {
  const row = makeRow({ mediaSource: 'DTC - BTNP001' });
  const item = makeMondayItem({ mediaSource: 'BTNP001, BTNP010' });
  const c = detectChanges(item, row, H_IDX, ['BTNP010', 'BTNP001']);
  return c === null || c[monday.COLUMN_IDS.MEDIA_SOURCE] === undefined;
})());

t.test('detectChanges: mediaSources array is not mutated', (() => {
  const row = makeRow({ mediaSource: 'DTC - BTNP001' });
  const item = makeMondayItem({ mediaSource: 'BTNP010, BTNP001' });
  const original = ['BTNP010', 'BTNP001'];
  const snapshot = [...original];
  detectChanges(item, row, H_IDX, original);
  return original[0] === snapshot[0] && original[1] === snapshot[1];
})());

t.test('detectChanges: Foxipedia ID emptied triggers change', (() => {
  const row = makeRow({ foxId: '' });
  const item = makeMondayItem();
  const c = detectChanges(item, row, H_IDX);
  return c && c[monday.COLUMN_IDS.FOXIPEDIA_ID] === '';
})());

t.test('detectChanges: real Monday API shape with dropdown IDs in value', (() => {
  const row = makeRow();
  const item = {
    id: '1234567890',
    name: 'UFL - Test Game',
    column_values: [
      { id: 'text4', text: 'EP123456', value: '"EP123456"' },
      { id: 'dropdown', text: 'FS1', value: '{"ids":[47835]}' },
      { id: 'date4', text: '2026-04-10 18:00:00', value: '{"date":"2026-04-10","time":"18:00:00"}' },
      { id: 'date_mkzc3q4b', text: '2026-04-10 21:00:00', value: '{"date":"2026-04-10","time":"21:00:00"}' },
      { id: 'text__1', text: 'EPI789', value: '"EPI789"' },
      { id: 'dropdown9', text: 'RTLM - FS1', value: '{"ids":[58921]}' },
    ],
  };
  return detectChanges(item, row, H_IDX) === null;
})());

// ── Realistic failure scenarios ──

t.test('detectChanges: uses value (UTC) not text (board tz) for dates', (() => {
  const row = makeRow();
  const item = {
    id: '99999',
    name: 'UFL - Test Game',
    column_values: [
      { id: 'text4', text: 'EP123456', value: null },
      { id: 'dropdown', text: 'FS1', value: null },
      { id: 'date4', text: '2026-04-10 14:00:00', value: '{"date":"2026-04-10","time":"18:00:00"}' },
      { id: 'date_mkzc3q4b', text: '2026-04-10 17:00:00', value: '{"date":"2026-04-10","time":"21:00:00"}' },
      { id: 'text__1', text: 'EPI789', value: null },
      { id: 'dropdown9', text: 'RTLM - FS1', value: null },
    ],
  };
  return detectChanges(item, row, H_IDX) === null;
})());

t.test('detectChanges: null text in Monday date columns handled', (() => {
  const row = makeRow();
  const item = {
    id: '99999',
    name: 'UFL - Test Game',
    column_values: [
      { id: 'text4', text: 'EP123456', value: null },
      { id: 'dropdown', text: 'FS1', value: null },
      { id: 'date4', text: null, value: null },
      { id: 'date_mkzc3q4b', text: null, value: null },
      { id: 'text__1', text: 'EPI789', value: null },
      { id: 'dropdown9', text: 'RTLM - FS1', value: null },
    ],
  };
  const c = detectChanges(item, row, H_IDX);
  return c !== null && c[monday.COLUMN_IDS.START_TIME] !== undefined;
})());

t.test('detectChanges: missing column in Monday response', (() => {
  const row = makeRow();
  const item = {
    id: '99999',
    name: 'UFL - Test Game',
    column_values: [
      { id: 'text4', text: 'EP123456', value: null },
      { id: 'dropdown', text: 'FS1', value: null },
      { id: 'date4', text: '2026-04-10 18:00:00', value: '{"date":"2026-04-10","time":"18:00:00"}' },
      { id: 'date_mkzc3q4b', text: '2026-04-10 21:00:00', value: '{"date":"2026-04-10","time":"21:00:00"}' },
      { id: 'text__1', text: 'EPI789', value: null },
    ],
  };
  const c = detectChanges(item, row, H_IDX);
  return c !== null && c[monday.COLUMN_IDS.MEDIA_SOURCE] !== undefined;
})());

// ── rowToMondayValues ──

t.test('rowToMondayValues: standard row includes all 5 core columns', (() => {
  const vals = rowToMondayValues(makeRow(), H_IDX, []);
  const ids = monday.COLUMN_IDS;
  return ids.START_TIME in vals && ids.END_TIME in vals &&
    ids.CALL_SIGN in vals && ids.TMS_ID in vals && ids.FOXIPEDIA_ID in vals &&
    vals[ids.START_TIME].date === '2026-04-10' &&
    vals[ids.START_TIME].time === '18:00:00' &&
    vals[ids.CALL_SIGN].labels[0] === 'FS1' &&
    vals[ids.TMS_ID] === 'EP123456';
})());

t.test('rowToMondayValues: aggregated mediaSources override row fallback', (() => {
  const vals = rowToMondayValues(makeRow(), H_IDX, ['BTNP005', 'BTNP010']);
  return vals[monday.COLUMN_IDS.MEDIA_SOURCE].labels.length === 2 &&
    vals[monday.COLUMN_IDS.MEDIA_SOURCE].labels.includes('BTNP005');
})());

// ── Archival eligibility ──

t.test('isArchivalCandidate: within window true, past excluded', (() => {
  const tomorrow = new Date(Date.now() + 86_400_000);
  const dateStr = tomorrow.toISOString().split('T')[0] + ' 14:00:00';
  return isArchivalCandidate(makeMondayItem({ startTime: dateStr })) &&
    !isArchivalCandidate(makeMondayItem({ startTime: '2020-01-01 10:00:00' }));
})());

t.test('isArchivalCandidate: invalid date returns false (NaN guard)', (() => {
  return !isArchivalCandidate(makeMondayItem({ startTime: 'not-a-date' })) &&
    !isArchivalCandidate(makeMondayItem({ startTime: '' }));
})());

t.test('channel change: old channel stale, new channel created', (() => {
  const tomorrow = new Date(Date.now() + 86_400_000);
  const dateStr = tomorrow.toISOString().split('T')[0] + ' 14:00:00';
  const oldItem = makeMondayItem({ tmsId: 'EP123', callSign: 'FS1', startTime: dateStr });
  const newRow = makeRow({ tmsId: 'EP123', callSign: 'FS2' });
  const rtlmMap = new Map();
  rtlmMap.set(buildKeyFromScraped(newRow, H_IDX), newRow);
  const mondayMap = new Map();
  mondayMap.set(buildKeyFromMonday(oldItem), oldItem);
  const newKey = buildKeyFromScraped(newRow, H_IDX);
  const oldKey = buildKeyFromMonday(oldItem);
  return newKey !== oldKey && !mondayMap.has(newKey) && !rtlmMap.has(oldKey) &&
    isArchivalCandidate(oldItem);
})());
