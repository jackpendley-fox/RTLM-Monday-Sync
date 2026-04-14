/**
 * Unit tests — pure-function correctness.
 * Each test covers a distinct code path; overlapping inputs are merged.
 */

const t = require('./harness');
const {
  monday,
  getEtOffsetMinutes,
  parseRtlmDateTime,
  parseMondayDateValue,
  dateTimeToMs,
  headerIndex,
} = require('./fixtures');

t.section('Unit Tests');

// ── parseRtlmDateTime ──

t.test('parseRtlmDateTime EDT conversion + output shape', (() => {
  const r = parseRtlmDateTime('04/10/26 14:00');
  return r && r.date === '2026-04-10' && r.time === '18:00:00' &&
    /^\d{4}-\d{2}-\d{2}$/.test(r.date) && /^\d{2}:\d{2}:\d{2}$/.test(r.time);
})());

t.test('parseRtlmDateTime EST midnight rolls to next day/year', (() => {
  const r = parseRtlmDateTime('12/31/25 23:59');
  return r && r.date === '2026-01-01' && r.time === '04:59:00';
})());

t.test('parseRtlmDateTime invalid inputs return null', (() => {
  return parseRtlmDateTime(null) === null &&
    parseRtlmDateTime('') === null &&
    parseRtlmDateTime('bad') === null &&
    parseRtlmDateTime('03/27/26') === null &&
    parseRtlmDateTime('aa/bb/cc dd:ee') === null;
})());

t.test('parseRtlmDateTime DST spring-forward non-existent time', (() => {
  const r = parseRtlmDateTime('03/08/26 02:30');
  return r && r.date === '2026-03-08' && r.time === '06:30:00';
})());

// ── getEtOffsetMinutes ──

t.test('getEtOffsetMinutes DST spring-forward boundary (March)', (() => {
  return getEtOffsetMinutes(2026, 3, 7) === 300 &&
    getEtOffsetMinutes(2026, 3, 9) === 240;
})());

t.test('getEtOffsetMinutes DST fall-back boundary (November)', (() => {
  return getEtOffsetMinutes(2026, 10, 31) === 240 &&
    getEtOffsetMinutes(2026, 11, 1) === 300;
})());

// ── parseMondayDateValue ──

t.test('parseMondayDateValue valid JSON', (() => {
  const r = parseMondayDateValue('{"date":"2026-04-10","time":"18:00:00"}');
  return r && r.date === '2026-04-10' && r.time === '18:00:00';
})());

t.test('parseMondayDateValue HH:MM time passthrough (phantom update risk)', (() => {
  const r = parseMondayDateValue('{"date":"2026-04-10","time":"18:00"}');
  return r && r.time === '18:00';
})());

t.test('parseMondayDateValue invalid inputs all return null', (() => {
  return parseMondayDateValue(null) === null &&
    parseMondayDateValue('{bad}') === null &&
    parseMondayDateValue('{"time":"14:00:00"}') === null &&
    parseMondayDateValue('null') === null &&
    parseMondayDateValue('"null"') === null &&
    parseMondayDateValue('{}') === null;
})());

// ── mapCallSign ──

t.test('mapCallSign all mapped values', (() => {
  return monday.mapCallSign('FOXD') === 'FOXDEP' &&
    monday.mapCallSign('FSCPL') === 'FSP' &&
    monday.mapCallSign('FBCS') === 'FOX' &&
    monday.mapCallSign('FS1D') === 'FS1-Digital' &&
    monday.mapCallSign('BTNP001') === 'B1G+';
})());

t.test('mapCallSign unmapped passthrough', monday.mapCallSign('FS1') === 'FS1');

t.test('mapCallSign null/falsy returns input unchanged', (() => {
  return monday.mapCallSign(null) === null &&
    monday.mapCallSign('') === '';
})());

t.test('mapCallSign idempotent for all values', (() => {
  const inputs = ['FOXD', 'FSCPL', 'FBCS', 'FS1D', 'BTNP001', 'FS1', 'B1G+', 'foxd', null, ''];
  return inputs.every(cs => monday.mapCallSign(monday.mapCallSign(cs)) === monday.mapCallSign(cs));
})());

// ── mapMediaSource ──

t.test('mapMediaSource extracts BTNP/TX from RTLM and DTC prefixes', (() => {
  return monday.mapMediaSource('RTLM - BTNP001') === 'BTNP001' &&
    monday.mapMediaSource('DTC - BTNP040') === 'BTNP040' &&
    monday.mapMediaSource('RTLM - TX001') === 'TX001' &&
    monday.mapMediaSource('DTC - TX999') === 'TX999';
})());

t.test('mapMediaSource non-matching passthrough + untrimmed anchor trap', (() => {
  return monday.mapMediaSource('RTLM - FS1') === 'RTLM - FS1' &&
    monday.mapMediaSource('FS1') === 'FS1' &&
    monday.mapMediaSource(null) === null &&
    monday.mapMediaSource(' DTC - BTNP001 ') === ' DTC - BTNP001 ';
})());

// ── isInfomercial ──

t.test('isInfomercial case-insensitive exact match', (() => {
  return monday.isInfomercial('Infomercial') &&
    monday.isInfomercial('infomercial') &&
    monday.isInfomercial('INFOMERCIAL');
})());

t.test('isInfomercial rejects partial, whitespace, null, empty', (() => {
  return !monday.isInfomercial('Infomercial Special') &&
    !monday.isInfomercial(' Infomercial ') &&
    !monday.isInfomercial(null) &&
    !monday.isInfomercial('');
})());

// ── dateTimeToMs ──

t.test('dateTimeToMs valid input returns UTC epoch', (() => {
  return dateTimeToMs({ date: '2026-04-10', time: '18:00:00' }) === Date.UTC(2026, 3, 10, 18, 0, 0);
})());

t.test('dateTimeToMs invalid date returns NaN (not null)', (() => {
  const ms = dateTimeToMs({ date: '2026-13-40', time: '25:00:00' });
  return Number.isNaN(ms) && ms !== null && dateTimeToMs(null) === null;
})());

// ── headerIndex ──

t.test('headerIndex duplicate headers: last wins', (() => {
  const idx = headerIndex(['Headline', 'TMS ID', 'Headline']);
  return idx['Headline'] === 2 && idx['TMS ID'] === 1;
})());
