const logEl = document.getElementById('log');
const logEmptyEl = document.getElementById('log-empty');
const muleUrlEl = document.getElementById('mule-url');
const statusBadge = document.getElementById('status-badge');
const btnAuth = document.getElementById('btn-auth');
const btnAuthEnter = document.getElementById('btn-auth-enter');
const btnScrape = document.getElementById('btn-scrape');
const btnStop = document.getElementById('btn-stop');
const appShell = document.getElementById('app-shell');
const resultBanner = document.getElementById('result-banner');
const lastRunCard = document.getElementById('last-run-card');
const lastRunBody = document.getElementById('last-run-body');
const soundToggle = document.getElementById('sound-toggle');
const aboutOverlay = document.getElementById('about-overlay');
const aboutTitle = document.getElementById('about-title');
const aboutVersion = document.getElementById('about-version');
const aboutDesc = document.getElementById('about-desc');
const aboutClose = document.getElementById('about-close');
const kbdHint = document.getElementById('kbd-hint');
const guideShortcutsLine = document.getElementById('guide-shortcuts-line');

/** @type {null | 'auth' | 'scraper'} */
let runMode = null;
let runStartTime = 0;
let logBuffer = '';

const SOUND_KEY = 'rtlmSyncSoundEnabled';

function isMac() {
  return /Mac|iPhone|iPod|iPad/i.test(navigator.platform) || navigator.userAgent.includes('Mac');
}

function playSuccessChime() {
  if (localStorage.getItem(SOUND_KEY) !== 'true') return;
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.connect(g);
    g.connect(ctx.destination);
    o.frequency.value = 880;
    o.type = 'sine';
    g.gain.setValueAtTime(0.1, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.14);
    o.start(ctx.currentTime);
    o.stop(ctx.currentTime + 0.14);
    o.onended = () => ctx.close();
  } catch (_) {}
}

function appendLog(line) {
  if (logEmptyEl) logEmptyEl.hidden = true;
  logBuffer += (logBuffer ? '\n' : '') + line;
  logEl.textContent += (logEl.textContent ? '\n' : '') + line;
  logEl.scrollTop = logEl.scrollHeight;
}

/** Clears accumulated log buffer (used between runs and after exit). */
function resetRunLogState() {
  logBuffer = '';
}

function showResultBanner(kind, message) {
  resultBanner.hidden = false;
  resultBanner.className = `result-banner result-banner--${kind}`;
  resultBanner.textContent = message;
  window.clearTimeout(showResultBanner._t);
  window.clearTimeout(showResultBanner._tw);
  if (kind === 'success') {
    showResultBanner._t = window.setTimeout(() => {
      resultBanner.hidden = true;
    }, 10000);
  } else if (kind === 'warn') {
    showResultBanner._tw = window.setTimeout(() => {
      resultBanner.hidden = true;
    }, 6000);
  }
}

function hideResultBanner() {
  window.clearTimeout(showResultBanner._t);
  window.clearTimeout(showResultBanner._tw);
  resultBanner.hidden = true;
}

function parseScraperSummary() {
  const rowsMatch = logBuffer.match(/(\d+)\s+events saved/i);
  const rows = rowsMatch ? parseInt(rowsMatch[1], 10) : null;
  const muleOk =
    /MuleSoft accepted payload/i.test(logBuffer) || /\[SYNC\] Skipped/i.test(logBuffer);
  const muleFail = /\[SYNC\] Failed|MuleSoft error/i.test(logBuffer);
  return { rows, muleOk: muleOk && !muleFail, muleFail };
}

function updateLastRunCard(ms, summary) {
  lastRunCard.hidden = false;
  const secs = (ms / 1000).toFixed(1);
  const parts = [
    `<div class="summary-item"><span class="summary-label">Duration</span><span class="summary-value">${secs}s</span></div>`,
  ];
  if (summary.rows != null) {
    parts.push(
      `<div class="summary-item"><span class="summary-label">Rows scraped</span><span class="summary-value">${summary.rows}</span></div>`,
    );
  }
  parts.push(
    `<div class="summary-item"><span class="summary-label">MuleSoft</span><span class="summary-value ${summary.muleOk ? 'summary-ok' : 'summary-bad'}">${summary.muleOk ? 'Accepted' : summary.muleFail ? 'Error' : '—'}</span></div>`,
  );
  lastRunBody.innerHTML = parts.join('');
}

function setRunning(running) {
  btnAuth.disabled = running;
  btnScrape.disabled = running;
  btnStop.disabled = !running;
  btnAuthEnter.disabled = !(running && runMode === 'auth');
  if (statusBadge) {
    statusBadge.textContent = running ? 'Running' : 'Idle';
    statusBadge.dataset.state = running ? 'running' : 'idle';
  }
}

function openAbout(meta) {
  if (aboutTitle) aboutTitle.textContent = meta.name || 'RTLM Monday Sync';
  aboutVersion.textContent = `Version ${meta.version}`;
  aboutDesc.textContent = meta.description || 'Scraper and sync helper for RTLM → Monday.com.';
  aboutOverlay.hidden = false;
  aboutClose.focus();
}

function closeAbout() {
  aboutOverlay.hidden = true;
}

function runScrapeAction() {
  if (!btnScrape.disabled) btnScrape.click();
}

function runStopAction() {
  if (!btnStop.disabled) btnStop.click();
}

function wireShortcuts() {
  window.rtlmSync.onShortcut((action) => {
    if (action === 'run-sync') runScrapeAction();
    else if (action === 'stop') runStopAction();
    else if (action === 'open-about') window.rtlmSync.getAppMeta().then(openAbout);
  });

  document.addEventListener(
    'keydown',
    (e) => {
      const mod = isMac() ? e.metaKey : e.ctrlKey;
      if (mod && e.key === 'Enter') {
        e.preventDefault();
        runScrapeAction();
      }
      if (mod && (e.key === '.' || e.key === 'Period')) {
        e.preventDefault();
        runStopAction();
      }
      if (e.key === 'Escape' && !aboutOverlay.hidden) {
        closeAbout();
      }
    },
    true,
  );
}

async function init() {
  const url = await window.rtlmSync.getMulesoftUrl();
  muleUrlEl.textContent = url;

  if (kbdHint && !isMac()) {
    kbdHint.innerHTML =
      'Shortcuts: <kbd>Ctrl</kbd><kbd>Enter</kbd> Run sync · <kbd>Ctrl</kbd><kbd>.</kbd> Stop';
  }
  if (guideShortcutsLine && !isMac()) {
    guideShortcutsLine.innerHTML =
      '<strong>Need to stop?</strong> Use <strong>Stop</strong> if a run is stuck. Shortcuts: ' +
      '<span class="guide-kbd-wrap"><kbd class="guide-kbd">Ctrl</kbd><kbd class="guide-kbd">Enter</kbd></span> ' +
      'runs sync and ' +
      '<span class="guide-kbd-wrap"><kbd class="guide-kbd">Ctrl</kbd><kbd class="guide-kbd">.</kbd></span> stops.';
  }

  soundToggle.checked = localStorage.getItem(SOUND_KEY) === 'true';
  soundToggle.addEventListener('change', () => {
    localStorage.setItem(SOUND_KEY, soundToggle.checked ? 'true' : 'false');
  });

  aboutClose.addEventListener('click', closeAbout);
  aboutOverlay.querySelectorAll('[data-close-about]').forEach((el) => {
    el.addEventListener('click', closeAbout);
  });

  resultBanner.addEventListener('click', () => {
    resultBanner.hidden = true;
  });

  window.requestAnimationFrame(() => {
    appShell.classList.add('app-shell--enter');
  });

  window.rtlmSync.onLog((line) => appendLog(line));
  window.rtlmSync.onProcExit(({ code, signal, script }) => {
    appendLog(`[exit] ${script} finished with code ${code}`);
    const elapsed = runStartTime ? Date.now() - runStartTime : 0;

    const userStopped =
      logBuffer.includes('[stopped]') || signal === 'SIGTERM' || signal === 'SIGKILL';

    if (userStopped) {
      showResultBanner('warn', 'Stopped.');
      runMode = null;
      setRunning(false);
      resetRunLogState();
      return;
    }

    if (script === 'auth.js') {
      if (code === 0) {
        showResultBanner('success', 'Session saved. You can run sync when ready.');
        playSuccessChime();
      } else {
        showResultBanner('error', `Auth ended with exit code ${code}.`);
      }
    } else if (script === 'scraper.js') {
      const summary = parseScraperSummary();
      const scrapeError =
        /ERROR:\s|Failed to reach MuleSoft|Execution context was destroyed/i.test(logBuffer);
      const hardFail = code !== 0 || summary.muleFail || scrapeError;

      if (hardFail) {
        const tail = logBuffer.split('\n').filter(Boolean).slice(-3).join(' ');
        showResultBanner(
          'error',
          `Run ended with problems (exit ${code ?? '—'}). ${tail ? tail.slice(0, 180) : ''}`,
        );
      } else if (/\[SYNC\] Skipped/i.test(logBuffer)) {
        showResultBanner('success', 'Scrape finished (sync skipped by configuration).');
        playSuccessChime();
        updateLastRunCard(elapsed, summary);
      } else {
        showResultBanner('success', 'Sync finished successfully — data was sent to MuleSoft.');
        playSuccessChime();
        updateLastRunCard(elapsed, summary);
      }
    }

    runMode = null;
    setRunning(false);
    resetRunLogState();
  });

  wireShortcuts();

  btnAuth.addEventListener('click', async () => {
    hideResultBanner();
    logEl.textContent = '';
    logEmptyEl.hidden = true;
    resetRunLogState();
    appendLog('Starting auth…');
    runMode = 'auth';
    runStartTime = Date.now();
    setRunning(true);
    try {
      await window.rtlmSync.startAuth();
    } catch (e) {
      appendLog(`Error: ${e.message}`);
      runMode = null;
      setRunning(false);
      resetRunLogState();
    }
  });

  btnAuthEnter.addEventListener('click', () => {
    window.rtlmSync.sendAuthEnter();
    appendLog('(Sent Enter — saving session if browser is ready.)');
  });

  btnScrape.addEventListener('click', async () => {
    hideResultBanner();
    logEl.textContent = '';
    logEmptyEl.hidden = true;
    resetRunLogState();
    appendLog('Starting scraper…');
    runMode = 'scraper';
    runStartTime = Date.now();
    setRunning(true);
    try {
      await window.rtlmSync.startScraper();
    } catch (e) {
      appendLog(`Error: ${e.message}`);
      runMode = null;
      setRunning(false);
      resetRunLogState();
    }
  });

  btnStop.addEventListener('click', async () => {
    await window.rtlmSync.stopProcess();
    appendLog('[stopped]');
    runMode = null;
    setRunning(false);
    resetRunLogState();
  });
}

init();
