require('dotenv').config({ path: require('path').join(__dirname, '.env') });

const cron = require('node-cron');
const { runScraper } = require('./scraper');
const monday = require('./monday-client');

const DAYS_AHEAD = 7;

// ── Date parsing ──

function getEtOffsetMinutes(year, month, day) {
  const probeUtc = new Date(Date.UTC(year, month - 1, day, 17, 0, 0));
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: 'numeric',
    hour12: false,
  }).formatToParts(probeUtc);
  const etHour = parseInt(parts.find((p) => p.type === 'hour').value, 10);
  let offsetHours = 17 - etHour;
  if (offsetHours < 0) offsetHours += 24;
  return offsetHours * 60;
}

function parseRtlmDateTime(dateStr) {
  if (!dateStr) return null;
  const [datePart, timePart] = dateStr.split(' ');
  if (!datePart || !timePart) return null;
  const [month, day, year] = datePart.split('/').map(Number);
  const [hours, minutes] = timePart.split(':').map(Number);
  if ([month, day, year, hours, minutes].some(Number.isNaN)) return null;
  const fullYear = 2000 + year;

  const offsetMinutes = getEtOffsetMinutes(fullYear, month, day);
  const etMs = Date.UTC(fullYear, month - 1, day, hours, minutes, 0);
  const utcDate = new Date(etMs + offsetMinutes * 60 * 1000);

  return {
    date: utcDate.toISOString().split('T')[0],
    time: utcDate.toISOString().split('T')[1].split('.')[0],
  };
}

function parseMondayDateTime(text) {
  if (!text) return null;
  const parts = text.split(' ');
  if (parts.length < 2) return null;
  let time = parts[1];
  if (time.split(':').length === 2) time += ':00';
  return { date: parts[0], time };
}

function parseMondayDateValue(valueJson) {
  if (!valueJson) return null;
  try {
    const parsed = JSON.parse(valueJson);
    if (!parsed || !parsed.date) return null;
    return { date: parsed.date, time: parsed.time || '00:00:00' };
  } catch {
    return null;
  }
}

function dateTimeToMs(dt) {
  if (!dt) return null;
  return new Date(`${dt.date}T${dt.time}Z`).getTime();
}

// ── Key builders ──
// Composite key: TMS ID + mapped Call Sign (start time is now a mutable field)

function headerIndex(headers) {
  const idx = {};
  headers.forEach((h, i) => { idx[h] = i; });
  return idx;
}

function buildKeyFromScraped(row, hIdx) {
  const tmsId = (row[hIdx['TMS ID']] || '').trim();
  const rawCallSign = (row[hIdx['Call Sign']] || '').trim();
  const callSign = monday.mapCallSign(rawCallSign);
  if (callSign === 'B1G+') {
    const mediaSource = monday.mapMediaSource((row[hIdx['Media Source']] || '').trim());
    return `${tmsId}|${callSign}|${mediaSource || rawCallSign}`;
  }
  return `${tmsId}|${callSign}`;
}

function buildKeyFromMonday(item) {
  const cols = {};
  item.column_values.forEach((cv) => { cols[cv.id] = (cv.text || '').trim(); });
  const tmsId = cols[monday.COLUMN_IDS.TMS_ID] || '';
  const callSign = cols[monday.COLUMN_IDS.CALL_SIGN] || '';
  if (callSign === 'B1G+') {
    const mediaSource = cols[monday.COLUMN_IDS.MEDIA_SOURCE] || '';
    return `${tmsId}|${callSign}|${mediaSource}`;
  }
  return `${tmsId}|${callSign}`;
}

// ── Transform scraped row → Monday column values ──

function rowToMondayValues(row, hIdx, mediaSources) {
  const startTime = parseRtlmDateTime(row[hIdx['Start Time (ET)']]);
  const endTime = parseRtlmDateTime(row[hIdx['End Time (ET)']]);
  const callSign = monday.mapCallSign(row[hIdx['Call Sign']] || '');

  const values = {
    [monday.COLUMN_IDS.START_TIME]: startTime,
    [monday.COLUMN_IDS.END_TIME]: endTime,
    [monday.COLUMN_IDS.CALL_SIGN]: { labels: [callSign] },
    [monday.COLUMN_IDS.TMS_ID]: row[hIdx['TMS ID']] || '',
    [monday.COLUMN_IDS.FOXIPEDIA_ID]: row[hIdx['Foxipedia ID']] || '',
  };

  const labels = mediaSources && mediaSources.length > 0
    ? mediaSources
    : (() => { const ms = monday.mapMediaSource((row[hIdx['Media Source']] || '').trim()); return ms ? [ms] : []; })();

  if (labels.length > 0) {
    values[monday.COLUMN_IDS.MEDIA_SOURCE] = { labels };
  }

  return values;
}

// ── Change detection ──
// Compares every synced field: headline, start time, end time, Foxipedia ID, media source

function detectChanges(mondayItem, row, hIdx, mediaSources) {
  const cols = {};
  const vals = {};
  mondayItem.column_values.forEach((cv) => {
    cols[cv.id] = (cv.text || '').trim();
    vals[cv.id] = cv.value;
  });

  const changes = {};

  // Headline (item name)
  const newHeadline = (row[hIdx['Headline']] || '').trim();
  if (newHeadline && mondayItem.name.trim() !== newHeadline) {
    changes._name = newHeadline;
  }

  // Start Time — compare against stored UTC value, not display text
  const newStart = parseRtlmDateTime(row[hIdx['Start Time (ET)']]);
  const curStart = parseMondayDateValue(vals[monday.COLUMN_IDS.START_TIME]);
  if (newStart && (!curStart || newStart.date !== curStart.date || newStart.time !== curStart.time)) {
    changes[monday.COLUMN_IDS.START_TIME] = newStart;
  }

  // End Time — compare against stored UTC value, not display text
  const newEnd = parseRtlmDateTime(row[hIdx['End Time (ET)']]);
  const curEnd = parseMondayDateValue(vals[monday.COLUMN_IDS.END_TIME]);
  if (newEnd && (!curEnd || newEnd.date !== curEnd.date || newEnd.time !== curEnd.time)) {
    changes[monday.COLUMN_IDS.END_TIME] = newEnd;
  }

  // Foxipedia ID
  const newFoxId = (row[hIdx['Foxipedia ID']] || '').trim();
  const curFoxId = cols[monday.COLUMN_IDS.FOXIPEDIA_ID] || '';
  if (newFoxId !== curFoxId) {
    changes[monday.COLUMN_IDS.FOXIPEDIA_ID] = newFoxId;
  }

  // Media Source
  const newLabels = mediaSources && mediaSources.length > 0
    ? [...mediaSources].sort()
    : (() => { const ms = monday.mapMediaSource((row[hIdx['Media Source']] || '').trim()); return ms ? [ms] : []; })();
  const curLabels = (cols[monday.COLUMN_IDS.MEDIA_SOURCE] || '')
    .split(/,\s*/).filter(Boolean).sort();
  if (newLabels.length > 0 &&
      (newLabels.length !== curLabels.length || !newLabels.every((l, i) => l === curLabels[i]))) {
    changes[monday.COLUMN_IDS.MEDIA_SOURCE] = { labels: newLabels };
  }

  return Object.keys(changes).length > 0 ? changes : null;
}

// ── Archival eligibility ──
// Only archive Monday items whose start time falls within the scrape window
// (today through DAYS_AHEAD days). Past items and far-future items are left alone.

function isArchivalCandidate(item) {
  const vals = {};
  item.column_values.forEach((cv) => { vals[cv.id] = cv.value; });
  const startDt = parseMondayDateValue(vals[monday.COLUMN_IDS.START_TIME]);
  if (!startDt) return false;

  const startMs = dateTimeToMs(startDt);
  if (!startMs || Number.isNaN(startMs)) return false;

  const now = Date.now();
  const cutoff = now + DAYS_AHEAD * 86_400_000;
  return startMs >= now && startMs <= cutoff;
}

// ── Main update logic ──

async function runUpdate(updateOptions = {}) {
  const verbose = updateOptions.verbose ?? false;
  const t0 = Date.now();
  console.log(`\n${'='.repeat(60)}`);
  console.log(`[UPDATE] Starting at ${new Date().toISOString()}`);
  console.log(`${'='.repeat(60)}`);

  // ── Step 1: Scrape RTLM ──
  console.log('\n[UPDATE] Step 1/4: Scraping RTLM...');
  const scrapeResult = await runScraper({
    headless: true,
    skipSync: true,
    skipCsv: true,
    verbose,
    authTimeoutMs: 60_000,
  });

  if (!scrapeResult.success) {
    console.error(`[UPDATE] Scrape failed: ${scrapeResult.error || 'unknown'}`);
    return { success: false, reason: 'scrape_failed' };
  }

  const headers = scrapeResult.headers;
  const hIdx = headerIndex(headers);
  const required = ['Headline', 'TMS ID', 'Call Sign', 'Start Time (ET)', 'End Time (ET)'];
  for (const col of required) {
    if (hIdx[col] === undefined) {
      console.error(`[UPDATE] Required column "${col}" missing from scrape.`);
      return { success: false, reason: `missing_column:${col}` };
    }
  }

  if (hIdx['Media Source'] === undefined) {
    console.warn('[UPDATE] "Media Source" column not found in scrape — media source sync skipped.');
  }

  const scrapedRows = scrapeResult.rows.filter(
    (row) => !monday.isInfomercial(row[hIdx['Headline']] || ''),
  );
  const infomercials = scrapeResult.rows.length - scrapedRows.length;
  console.log(
    `[UPDATE] ${scrapedRows.length} rows after filtering` +
    (infomercials > 0 ? ` (${infomercials} infomercials removed)` : ''),
  );

  // Build RTLM lookup: key → first matching row + aggregated media sources
  const rtlmMap = new Map();
  const mediaSrcMap = new Map();
  for (const row of scrapedRows) {
    const key = buildKeyFromScraped(row, hIdx);
    if (!key) continue;

    const rawMs = (row[hIdx['Media Source']] || '').trim();
    const mappedMs = monday.mapMediaSource(rawMs);
    if (mappedMs) {
      if (!mediaSrcMap.has(key)) mediaSrcMap.set(key, new Set());
      mediaSrcMap.get(key).add(mappedMs);
    }

    if (!rtlmMap.has(key)) {
      rtlmMap.set(key, row);
    }
  }
  console.log(`[UPDATE] ${rtlmMap.size} unique RTLM listings indexed`);

  // ── Step 2: Fetch current Monday.com items ──
  console.log('\n[UPDATE] Step 2/4: Fetching Monday.com board...');
  let mondayItems;
  try {
    mondayItems = await monday.fetchAllItems();
  } catch (err) {
    console.error(`[UPDATE] Monday.com fetch failed: ${err.message}`);
    return { success: false, reason: 'monday_fetch_failed' };
  }
  console.log(`[UPDATE] ${mondayItems.length} items on Monday.com`);

  const mondayMap = new Map();
  for (const item of mondayItems) {
    const key = buildKeyFromMonday(item);
    if (key && !mondayMap.has(key)) {
      mondayMap.set(key, item);
    }
  }
  console.log(`[UPDATE] ${mondayMap.size} unique items indexed`);

  // ── Step 3: Compare and sync (create + update) ──
  console.log('\n[UPDATE] Step 3/4: Syncing...');
  let created = 0;
  let updated = 0;
  let unchanged = 0;
  let errors = 0;

  for (const [key, row] of rtlmMap) {
    const existing = mondayMap.get(key);
    const allMediaSrcs = mediaSrcMap.has(key) ? [...mediaSrcMap.get(key)] : [];

    if (!existing) {
      const headline = row[hIdx['Headline']] || 'Unknown';
      const values = rowToMondayValues(row, hIdx, allMediaSrcs);
      try {
        await monday.createItem(headline, values);
        created++;
        if (created <= 20) console.log(`  + ${headline}`);
      } catch (err) {
        if (/dropdown label.*does not exist/i.test(err.message)) {
          const stripped = { ...values };
          delete stripped[monday.COLUMN_IDS.MEDIA_SOURCE];
          try {
            await monday.createItem(headline, stripped);
            created++;
            if (created <= 20) console.log(`  + ${headline} (media source label skipped)`);
          } catch (retryErr) {
            errors++;
            console.error(`  [ERR:CREATE] ${headline}: ${retryErr.message}`);
          }
        } else {
          errors++;
          console.error(`  [ERR:CREATE] ${headline}: ${err.message}`);
        }
      }
      await monday.delay(500);
      continue;
    }

    const changes = detectChanges(existing, row, hIdx, allMediaSrcs);
    if (!changes) {
      unchanged++;
      continue;
    }

    const headline = row[hIdx['Headline']] || existing.name;
    const columnChanges = { ...changes };
    const nameChanged = !!columnChanges._name;
    delete columnChanges._name;

    try {
      let madeChanges = false;
      if (Object.keys(columnChanges).length > 0) {
        try {
          await monday.updateItem(existing.id, columnChanges);
          madeChanges = true;
        } catch (err) {
          if (/dropdown label.*does not exist/i.test(err.message)) {
            const stripped = { ...columnChanges };
            delete stripped[monday.COLUMN_IDS.MEDIA_SOURCE];
            if (Object.keys(stripped).length > 0) {
              await monday.updateItem(existing.id, stripped);
              madeChanges = true;
            }
          } else {
            throw err;
          }
        }
      }
      if (nameChanged) {
        await monday.delay(300);
        await monday.updateItemName(existing.id, changes._name);
        madeChanges = true;
      }
      if (madeChanges) {
        updated++;
        const changedFields = Object.keys(changes)
          .map((k) => (k === '_name' ? 'name' : k))
          .join(', ');
        if (updated <= 20) console.log(`  ~ ${headline} [${changedFields}]`);
      } else {
        unchanged++;
      }
    } catch (err) {
      errors++;
      console.error(`  [ERR:UPDATE] ${headline}: ${err.message}`);
    }
    await monday.delay(500);
  }

  if (created > 20) console.log(`  ... and ${created - 20} more created`);
  if (updated > 20) console.log(`  ... and ${updated - 20} more updated`);

  // ── Step 4: Archive stale items ──
  console.log('\n[UPDATE] Step 4/4: Archiving stale items...');
  let archived = 0;
  let archiveErrors = 0;
  const archiveCandidates = mondayItems.filter((item) => {
    const key = buildKeyFromMonday(item);
    return !rtlmMap.has(key) && isArchivalCandidate(item);
  });

  console.log(`[UPDATE] ${archiveCandidates.length} items eligible for archival`);

  for (const item of archiveCandidates) {
    try {
      await monday.archiveItem(item.id);
      archived++;
      if (archived <= 20) console.log(`  - ${item.name} (id: ${item.id})`);
    } catch (err) {
      archiveErrors++;
      console.error(`  [ERR:ARCHIVE] ${item.name}: ${err.message}`);
    }
    await monday.delay(500);
  }

  if (archived > 20) console.log(`  ... and ${archived - 20} more archived`);

  const totalErrors = errors + archiveErrors;
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`\n${'='.repeat(60)}`);
  console.log(`[UPDATE] Done in ${elapsed}s`);
  console.log(`  Created:   ${created}`);
  console.log(`  Updated:   ${updated}`);
  console.log(`  Unchanged: ${unchanged}`);
  console.log(`  Archived:  ${archived}`);
  console.log(`  Errors:    ${totalErrors}`);
  console.log(`${'='.repeat(60)}\n`);

  return { success: totalErrors === 0, created, updated, unchanged, archived, errors: totalErrors };
}

// ── Scheduler ──

let running = false;

async function scheduledRun(opts = {}) {
  if (running) {
    console.log('[SCHEDULE] Skipping — previous run still in progress.');
    return;
  }
  running = true;
  try {
    await runUpdate(opts);
  } catch (err) {
    console.error(`[SCHEDULE] Unhandled error: ${err.message}`);
  } finally {
    running = false;
  }
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const verbose = args.includes('--verbose');

  if (args.includes('--schedule')) {
    console.log('[SCHEDULE] Hourly auto-update active.');
    console.log('[SCHEDULE] Running immediately, then every hour at :00.\n');
    scheduledRun({ verbose });
    cron.schedule('0 * * * *', () => scheduledRun({ verbose }));
  } else {
    runUpdate({ verbose })
      .then((result) => process.exit(result.success ? 0 : 1))
      .catch((err) => {
        console.error(`[UPDATE] Fatal: ${err.message}`);
        process.exit(1);
      });
  }
}

module.exports = { runUpdate };
module.exports._internals = {
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
};
