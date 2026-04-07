require('dotenv').config({ path: require('path').join(__dirname, '.env') });

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const axios = require('axios');

// ── Configuration ──
const RTLM_URL = 'https://mam.mediacloud.fox/tools/rtlm/listings';
const MULESOFT_URL =
  process.env.MULESOFT_URL || 'https://<your-cloudhub-app>.cloudhub.io/sync';
const SCRAPE_TIMEOUT_MS = 5 * 60 * 1000;
const AUTH_TIMEOUT_MS = 5 * 60 * 1000;
const NAV_TIMEOUT_MS = 60000;
const SSO_SETTLE_MS = 3000;

async function runScraper() {
  const storagePath = path.join(__dirname, 'storageState.json');
  if (!fs.existsSync(storagePath)) {
    console.error("ERROR: storageState.json not found. Run 'npm run auth' and log in first.");
    return false;
  }

  const browser = await chromium.launch({ headless: process.env.HEADLESS === 'true' });
  const context = await browser.newContext({ storageState: storagePath });
  const page = await context.newPage();
  page.on('dialog', d => d.dismiss());

  try {
    // ── Navigate to RTLM (with SSO redirect handling) ──
    console.log(`[NAV] Navigating to: ${RTLM_URL}`);
    await page.goto(RTLM_URL, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
    console.log(`[NAV] goto resolved. URL: ${page.url()}`);

    await page.waitForTimeout(SSO_SETTLE_MS);
    console.log(`[NAV] URL after settle: ${page.url()}`);

    if (!page.url().includes('mam.mediacloud.fox/tools/rtlm')) {
      console.log('[NAV] Not on RTLM -- redirect detected.');

      if (page.url().includes('okta') || page.url().includes('login') || page.url().includes('portal-login')) {
        console.log('[AUTH] Login required. Please log in via the browser window...');
      } else {
        console.log('[NAV] Waiting for redirect to complete...');
      }

      await page.waitForURL(/mam\.mediacloud\.fox/, { timeout: AUTH_TIMEOUT_MS });
      console.log(`[NAV] Back on MAM domain. URL: ${page.url()}`);
      await page.waitForLoadState('domcontentloaded').catch(() => {});
      await page.waitForTimeout(2000);

      console.log('[NAV] Re-navigating to RTLM listings...');
      await page.goto(RTLM_URL, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
      console.log(`[NAV] URL: ${page.url()}`);
    }

    if (page.url().includes('ad-validation')) {
      console.log('[NAV] Ad-validation redirect detected, returning to RTLM...');
      await page.goto(RTLM_URL, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
    }

    // ── Wait for iframe ──
    const iframeSelector = 'iframe[id="mclive-iframe"]';
    console.log('[IFRAME] Waiting for mclive-iframe to attach...');
    await page.waitForSelector(iframeSelector, { state: 'attached', timeout: NAV_TIMEOUT_MS });
    console.log('[IFRAME] iframe attached.');

    // ── Dismiss popups on parent page ──
    console.log('[POPUP] Scanning for popups...');
    const popupReport = await page.evaluate(() => {
      const report = { aspera: 0, dialogs: 0, actions: [] };
      const findCloseBtn = (el) =>
        el.querySelector('[aria-label="Close"], [aria-label="close"], button[class*="close" i]')
        || Array.from(el.querySelectorAll('button, a')).find(b =>
          /close|dismiss|cancel|no thanks|later|skip|x/i.test(b.textContent.trim())
        );
      document.querySelectorAll('[class*="aspera" i], [id*="aspera" i]').forEach(el => {
        report.aspera++;
        const btn = findCloseBtn(el);
        if (btn) { btn.click(); report.actions.push(`Clicked close on Aspera (${el.tagName})`); }
        else { el.remove(); report.actions.push(`Removed Aspera (${el.tagName})`); }
      });
      document.querySelectorAll('[role="dialog"], [role="alertdialog"]').forEach(el => {
        if (el.closest('#mclive-iframe') || el.querySelector('iframe')) return;
        report.dialogs++;
        const btn = findCloseBtn(el);
        if (btn) { btn.click(); report.actions.push(`Closed dialog: "${el.textContent.slice(0, 80).trim()}"`); }
        else { report.actions.push(`No close btn on dialog: "${el.textContent.slice(0, 80).trim()}"`); }
      });
      return report;
    });
    console.log(`[POPUP] ${popupReport.aspera} Aspera, ${popupReport.dialogs} dialogs.`);
    popupReport.actions.forEach(a => console.log(`[POPUP]   ${a}`));
    if (popupReport.actions.length === 0) console.log('[POPUP]   None found.');
    await page.waitForTimeout(500);

    // ── Access iframe content ──
    console.log('[IFRAME] Accessing content frame...');
    const frameElement = await page.$(iframeSelector);
    const frame = await frameElement.contentFrame();
    if (!frame) throw new Error('Could not access mclive-iframe content.');
    console.log('[IFRAME] Content frame acquired.');

    // ── Persist refreshed session ──
    await context.storageState({ path: storagePath });
    console.log('[AUTH] Session saved to storageState.json');

    // ── Wait for iframe app to stabilize ──
    console.log('[IFRAME] Waiting for app to stabilize...');
    await frame.waitForSelector('button[aria-label="table settings"]', { state: 'visible', timeout: 30000 });
    console.log('[IFRAME] App ready.');

    // ── Scrape RTLM listings inside iframe ──
    console.log('[SCRAPE] Starting...');
    const scrapePromise = frame.evaluate(async () => {
      const delay = ms => new Promise(r => setTimeout(r, ms));

      // ── Filter Configuration ──
      const CALLSIGNS = [
        'FS1', 'FS2', 'BTN', 'FSCPL', 'FOXD', 'FBCS',
        ...Array.from({ length: 40 }, (_, i) => `BTNP${String(i + 1).padStart(3, '0')}`)
      ];
      const MORE_FILTERS = ['Is Live'];
      const EXCLUDE_COLUMNS = new Set(['Series Name', 'Traffic Code']);
      const DAYS_AHEAD = 7;
      const cutoffDate = new Date(Date.now() + DAYS_AHEAD * 86400000);

      // ── DOM Selectors ──
      const SEL = {
        CELL: 'td, [role="gridcell"], [role="cell"]',
        HEADER: 'th, [role="columnheader"]',
        ROW: 'tr, [role="row"]',
        LOADING: '.MuiLinearProgress-root, .MuiCircularProgress-root, [role="progressbar"]',
        OPTION: '[role="option"], .MuiAutocomplete-option',
      };

      // ── DOM Utilities ──
      const pollFor = async (finder, maxAttempts = 10, intervalMs = 500) => {
        for (let i = 0; i < maxAttempts; i++) {
          const el = finder();
          if (el) return el;
          await delay(intervalMs);
        }
        return null;
      };

      const setNativeValue = (el, value) => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, value);
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      };

      const getHeaders = () =>
        Array.from(document.querySelectorAll(SEL.HEADER)).map(c => c.innerText);

      const isLoading = () => !!document.querySelector(SEL.LOADING);

      const getFirstRowFingerprint = () => {
        const row = document.querySelector('tr:not(:has(th)), [role="row"]:not([role="columnheader"])');
        if (!row) return '';
        return Array.from(row.querySelectorAll(SEL.CELL)).map(c => c.innerText).join('|');
      };

      const parseStartTime = (dateStr) => {
        if (!dateStr) return null;
        const [datePart, timePart] = dateStr.split(' ');
        if (!datePart || !timePart) return null;
        const [month, day, year] = datePart.split('/').map(Number);
        const [hours, minutes] = timePart.split(':').map(Number);
        return new Date(2000 + year, month - 1, day, hours, minutes);
      };

      // ── Wait Utilities ──
      const waitForAppReady = async (maxWaitMs = 20000) => {
        const start = Date.now();
        while (Date.now() - start < maxWaitMs) {
          if (document.querySelectorAll(SEL.HEADER).length > 0
              && document.querySelector('button[aria-label="table settings"]')) return true;
          await delay(500);
        }
        return false;
      };

      const waitForTableReady = async (maxWaitMs = 8000) => {
        const start = Date.now();
        let lastCount = -1, stable = 0;
        while (Date.now() - start < maxWaitMs) {
          await delay(300);
          if (isLoading()) { stable = 0; lastCount = -1; continue; }
          const count = document.querySelectorAll(SEL.CELL).length;
          if (count > 0 && count === lastCount) { if (++stable >= 2) return; }
          else { stable = 0; }
          lastCount = count;
        }
      };

      const waitForPageChange = async (prevFingerprint, maxWaitMs = 8000) => {
        const start = Date.now();
        while (Date.now() - start < maxWaitMs) {
          await delay(300);
          if (isLoading()) continue;
          const current = getFirstRowFingerprint();
          if (current && current !== prevFingerprint) return true;
        }
        return false;
      };

      // ── Filter: Column Visibility ──
      const ensureColumn = async () => {
        for (let attempt = 1; attempt <= 3; attempt++) {
          if (getHeaders().some(h => h.includes('Is Sporting Event'))) return true;

          const settingsBtn = document.querySelector('button[aria-label="table settings"]');
          if (!settingsBtn) { await delay(2000); continue; }

          settingsBtn.click();
          await delay(800);

          const searchInput = document.querySelector('input[placeholder="Search columns"]');
          if (searchInput) {
            setNativeValue(searchInput, 'Is Sporting Event');
            await delay(500);
          }

          const label = Array.from(document.querySelectorAll('label'))
            .find(l => l.innerText.includes('Is Sporting Event'));
          if (label) {
            const cb = label.querySelector('input[type="checkbox"]');
            if (cb && !cb.checked) label.click();
            await delay(300);
          }

          settingsBtn.click();
          await delay(800);

          if (getHeaders().some(h => h.includes('Is Sporting Event'))) return true;
          console.warn(`ensureColumn attempt ${attempt} failed, retrying...`);
          await delay(1000);
        }
        return false;
      };

      // ── Filter: Callsign ──
      const applyCallsignFilters = async (callsigns) => {
        const input = await pollFor(() =>
          document.getElementById('select-callSigns-filter-label')
            ?.closest('.MuiAutocomplete-root')?.querySelector('input')
        );
        if (!input) return false;

        const remaining = new Set(callsigns.map(cs => cs.toUpperCase()));
        input.focus();
        input.click();
        setNativeValue(input, '');
        await delay(400);

        let found = true;
        while (found && remaining.size > 0) {
          found = false;
          for (const opt of document.querySelectorAll(SEL.OPTION)) {
            const text = opt.textContent.trim().toUpperCase();
            if (remaining.has(text)) {
              opt.click();
              remaining.delete(text);
              found = true;
              await delay(50);
              break;
            }
          }
        }

        for (const cs of remaining) {
          input.focus();
          input.click();
          setNativeValue(input, cs);
          let match = null;
          for (let i = 0; i < 30; i++) {
            await delay(100);
            match = Array.from(document.querySelectorAll('[role="option"]'))
              .find(o => o.textContent.trim().toUpperCase() === cs);
            if (match) break;
          }
          if (match) { match.click(); await delay(100); }
        }

        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
        await delay(100);
        input.blur();
        document.body.click();
        const header = document.querySelector('thead') || document.body;
        header.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        header.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
        await delay(200);
        return true;
      };

      // ── Filter: More Filters ──
      const applyMoreFilters = async (filters, enable) => {
        for (const filterName of filters) {
          const moreBtn = await pollFor(() =>
            Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === 'More Filters')
          );
          if (!moreBtn) return false;

          moreBtn.click();
          await delay(400);

          const item = Array.from(document.querySelectorAll(
            '.MuiMenuItem-root, .MuiFormControlLabel-root, [role="menuitem"], [role="option"]'
          )).find(el => el.textContent.trim().toLowerCase() === filterName.toLowerCase());

          if (!item) {
            console.warn(`"${filterName}" not found in More Filters, skipping`);
            document.body.click();
            await delay(200);
            continue;
          }

          const isChecked = item.querySelector('input[type="checkbox"]')?.checked
            || item.querySelector('.Mui-checked') !== null
            || item.getAttribute('aria-selected') === 'true';

          if ((enable && !isChecked) || (!enable && isChecked)) item.click();
          await delay(200);
        }
        document.body.click();
        await delay(200);
        return true;
      };

      // ── Apply All Filters ──
      const filterStart = Date.now();
      const phaseTime = (label, start) => console.log(`  ${label}: ${((Date.now() - start) / 1000).toFixed(1)}s`);

      let t = Date.now();
      if (!await waitForAppReady()) return { error: 'Table never rendered in iframe.' };
      phaseTime('App ready', t);

      t = Date.now();
      if (!await ensureColumn()) return { error: "Could not enable 'Is Sporting Event' column after 3 attempts." };
      phaseTime('Column setup', t);

      t = Date.now();
      if (!await applyCallsignFilters(CALLSIGNS)) return { error: 'Failed to apply callsign filters.' };
      phaseTime('Callsign filters', t);

      t = Date.now();
      if (!await applyMoreFilters(MORE_FILTERS, true)) return { error: 'Failed to apply More Filters.' };
      phaseTime('More Filters', t);

      t = Date.now();
      await waitForTableReady();
      phaseTime('Table settle', t);

      console.log(`All filters applied in ${((Date.now() - filterStart) / 1000).toFixed(1)}s`);

      // ── Read Table Structure ──
      const headers = Array.from(document.querySelectorAll(SEL.HEADER))
        .map(c => c.innerText.replace(/\n/g, ' ').trim());
      const sportColIdx = headers.findIndex(h => h.includes('Is Sporting Event'));
      const startTimeIdx = headers.findIndex(h => h.includes('Start Time'));
      const excludeIdxs = new Set(headers.map((h, i) => EXCLUDE_COLUMNS.has(h) ? i : -1).filter(i => i !== -1));

      if (sportColIdx === -1) return { error: 'Sporting Event column missing.' };
      if (startTimeIdx === -1) return { error: 'Start Time column missing.' };

      const filteredHeaders = headers.filter((_, i) => !excludeIdxs.has(i));
      const filteredSportIdx = sportColIdx - [...excludeIdxs].filter(i => i < sportColIdx).length;

      // ── Paginated Scraping ──
      const allRows = [];
      const seen = new Set();
      let globalRowNum = 1;
      let pageNum = 0;

      while (true) {
        pageNum++;
        let rowsOnPage = 0, pastCutoff = 0;

        for (const row of document.querySelectorAll(SEL.ROW)) {
          if (row.querySelector('th') || row.getAttribute('role') === 'columnheader') continue;
          const cells = Array.from(row.querySelectorAll(SEL.CELL));
          if (cells.length === 0) continue;
          if (!cells[sportColIdx]?.querySelector('[data-testid="CheckIcon"]')) continue;

          const rowData = cells.map(c => c.innerText.replace(/\n/g, ' ').trim());
          const startTime = parseStartTime(rowData[startTimeIdx]);
          if (startTime && startTime > cutoffDate) { pastCutoff++; continue; }

          const filtered = rowData.filter((_, i) => !excludeIdxs.has(i));
          filtered[filteredSportIdx] = 'TRUE';

          const dedupeKey = filtered.join('|');
          if (seen.has(dedupeKey)) continue;
          seen.add(dedupeKey);

          filtered.unshift(globalRowNum++);
          allRows.push(filtered.map(v => `"${String(v).replace(/"/g, '""')}"`).join(','));
          rowsOnPage++;
        }

        console.log(`  Page ${pageNum}: ${rowsOnPage} events.`);

        if (pastCutoff > 0 && rowsOnPage === 0) {
          console.log(`  All rows past ${DAYS_AHEAD}-day cutoff. Stopping.`);
          break;
        }

        const next = document.getElementById('main-listings-table-next');
        const nextDisabled = !next || next.disabled
          || next.classList.contains('Mui-disabled')
          || next.getAttribute('aria-disabled') === 'true';
        if (nextDisabled) break;

        const fingerprint = getFirstRowFingerprint();
        next.click();
        await waitForPageChange(fingerprint);
      }

      return { headers: ['Row #', ...filteredHeaders], data: allRows };
    });

    const results = await Promise.race([
      scrapePromise,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`Scrape timed out after ${SCRAPE_TIMEOUT_MS / 60000} minutes.`)), SCRAPE_TIMEOUT_MS)
      ),
    ]);

    if (results.error) throw new Error(results.error);
    if (!results.data?.length) throw new Error('Scrape returned 0 rows.');

    // ── Save CSV Output ──
    const csvContent = '\ufeff' + [results.headers.join(','), ...results.data].join('\n');
    const fileName = process.env.SCRAPER_OUTPUT_PATH
      || path.join(__dirname, `rtlm_upload_${new Date().toISOString().split('T')[0]}.csv`);
    fs.writeFileSync(fileName, csvContent);
    console.log(`[SCRAPE] ${results.data.length} events saved to ${fileName}`);

    // ── Sync to MuleSoft ──
    if (process.env.SKIP_SYNC !== 'true') {
      console.log(`[SYNC] Sending data to MuleSoft at ${MULESOFT_URL}...`);
      try {
        const response = await axios.post(MULESOFT_URL, {
          fileName: path.basename(fileName),
          csvContent: csvContent
        }, { timeout: 30000 });

        if (response.data.status === 'success') {
          console.log(`[SYNC] MuleSoft accepted payload: ${response.data.message || 'OK'}`);
        } else {
          console.error(`[SYNC] MuleSoft error: ${response.data.message}`);
        }
      } catch (syncErr) {
        console.error(`[SYNC] Failed to reach MuleSoft: ${syncErr.message}`);
      }
    } else {
      console.log('[SYNC] Skipped (SKIP_SYNC=true)');
    }

    return true;

  } catch (err) {
    console.error('ERROR:', err.message);
    return false;
  } finally {
    try { await browser.close(); } catch {}
  }
}

runScraper().then(ok => process.exit(ok ? 0 : 1));
