/**
 * Shared test fixtures and data factories.
 *
 * All helper functions are imported directly from updater.js production code
 * via the _internals export, eliminating drift between tests and production.
 *
 * Data factories (makeRow, makeMondayItem) produce realistic test data
 * matching the shapes that flow through the pipeline.
 */

const monday = require('../monday-client');
const {
  getEtOffsetMinutes,
  parseRtlmDateTime,
  parseMondayDateTime,
  parseMondayDateValue,
  dateTimeToMs,
  headerIndex,
  buildKeyFromScraped,
  buildKeyFromMonday,
  rowToMondayValues,
  detectChanges,
  isArchivalCandidate,
} = require('../updater')._internals;

// ── Data factories ──

const HEADERS = [
  '', 'Headline', 'TMS ID', 'Foxipedia ID', 'Call Sign',
  'Start Time (ET)', 'End Time (ET)', 'Media Source',
  'Programming Filter Tags', 'Restart', 'Is Sporting Event',
];
const H_IDX = headerIndex(HEADERS);

function makeRow(overrides = {}) {
  const base = [
    '', 'UFL - Test Game', 'EP123456', 'EPI789', 'FS1',
    '04/10/26 14:00', '04/10/26 17:00', 'RTLM - FS1',
    'isSport', '', 'TRUE',
  ];
  if ('headline' in overrides) base[1] = overrides.headline;
  if ('tmsId' in overrides) base[2] = overrides.tmsId;
  if ('foxId' in overrides) base[3] = overrides.foxId;
  if ('callSign' in overrides) base[4] = overrides.callSign;
  if ('startTime' in overrides) base[5] = overrides.startTime;
  if ('endTime' in overrides) base[6] = overrides.endTime;
  if ('mediaSource' in overrides) base[7] = overrides.mediaSource;
  return base;
}

function dateTextToValue(dateTimeStr) {
  if (!dateTimeStr) return null;
  const parts = dateTimeStr.split(' ');
  if (parts.length < 2) return null;
  let time = parts[1];
  if (time.split(':').length === 2) time += ':00';
  return JSON.stringify({ date: parts[0], time });
}

// Default Monday item times are UTC equivalents of the ET defaults in makeRow:
//   04/10/26 14:00 ET (EDT) → 2026-04-10 18:00:00 UTC
//   04/10/26 17:00 ET (EDT) → 2026-04-10 21:00:00 UTC
const DEFAULT_START_UTC = '2026-04-10 18:00:00';
const DEFAULT_END_UTC = '2026-04-10 21:00:00';

function makeMondayItem(overrides = {}) {
  const startText = 'startTime' in overrides ? overrides.startTime : DEFAULT_START_UTC;
  const endText = 'endTime' in overrides ? overrides.endTime : DEFAULT_END_UTC;

  return {
    id: overrides.id || '99999',
    name: overrides.name || 'UFL - Test Game',
    column_values: [
      { id: 'text4', text: 'tmsId' in overrides ? overrides.tmsId : 'EP123456', value: null },
      { id: 'dropdown', text: 'callSign' in overrides ? overrides.callSign : 'FS1', value: null },
      { id: 'date4', text: startText, value: dateTextToValue(startText) },
      { id: 'date_mkzc3q4b', text: endText, value: dateTextToValue(endText) },
      { id: 'text__1', text: 'foxId' in overrides ? overrides.foxId : 'EPI789', value: null },
      { id: 'dropdown9', text: 'mediaSource' in overrides ? overrides.mediaSource : 'RTLM - FS1', value: null },
    ],
  };
}

module.exports = {
  monday,
  getEtOffsetMinutes,
  parseRtlmDateTime,
  parseMondayDateTime,
  parseMondayDateValue,
  dateTimeToMs,
  headerIndex,
  buildKeyFromScraped,
  buildKeyFromMonday,
  rowToMondayValues,
  detectChanges,
  isArchivalCandidate,
  HEADERS,
  H_IDX,
  makeRow,
  makeMondayItem,
};
