const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const RUNS = 10;
const SCRIPT = path.join(__dirname, 'scraper.js');
const OUTPUT_DIR = path.join(__dirname, 'test-runs');

if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR);

const results = [];

for (let i = 1; i <= RUNS; i++) {
  const outputPath = path.join(OUTPUT_DIR, `run-${i}.csv`);
  console.log(`\n${'='.repeat(60)}`);
  console.log(`RUN ${i}/${RUNS}`);
  console.log(`${'='.repeat(60)}`);

  const start = Date.now();
  try {
    execSync(`node "${SCRIPT}"`, {
      cwd: __dirname,
      stdio: 'inherit',
      timeout: 5 * 60 * 1000,
      env: { ...process.env, SCRAPER_OUTPUT_PATH: outputPath, SKIP_SYNC: 'true' },
    });
  } catch (err) {
    console.error(`Run ${i} FAILED: ${err.message}`);
    results.push({ run: i, status: 'FAILED', elapsed: ((Date.now() - start) / 1000).toFixed(1) });
    continue;
  }

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);

  if (!fs.existsSync(outputPath)) {
    console.error(`Run ${i}: no output file produced`);
    results.push({ run: i, status: 'NO OUTPUT', elapsed });
    continue;
  }

  const content = fs.readFileSync(outputPath, 'utf-8');
  const lines = content.split('\n').filter(l => l.trim());
  const hash = crypto.createHash('sha256').update(content).digest('hex').slice(0, 12);

  results.push({ run: i, status: 'OK', rows: lines.length - 1, hash, elapsed });
  console.log(`Run ${i}: ${lines.length - 1} rows, hash=${hash}, ${elapsed}s`);
}

console.log(`\n${'='.repeat(60)}`);
console.log('RESULTS SUMMARY');
console.log(`${'='.repeat(60)}`);

const okRuns = results.filter(r => r.status === 'OK');
const failedRuns = results.filter(r => r.status !== 'OK');

for (const r of results) {
  const detail = r.status === 'OK' ? `${r.rows} rows, hash=${r.hash}` : r.status;
  console.log(`  Run ${r.run}: ${detail} (${r.elapsed}s)`);
}

if (failedRuns.length > 0) {
  console.log(`\nFAILURES: ${failedRuns.length}/${RUNS} runs failed.`);
}

if (okRuns.length > 1) {
  const hashes = new Set(okRuns.map(r => r.hash));
  if (hashes.size === 1) {
    console.log(`\nCONSISTENCY: PASS - All ${okRuns.length} successful runs produced identical output.`);
  } else {
    console.log(`\nCONSISTENCY: FAIL - ${hashes.size} different outputs detected:`);
    for (const h of hashes) {
      const matching = okRuns.filter(r => r.hash === h).map(r => r.run);
      console.log(`  hash=${h}: runs ${matching.join(', ')}`);
    }

    const run1 = fs.readFileSync(path.join(OUTPUT_DIR, 'run-1.csv'), 'utf-8').split('\n');
    for (const r of okRuns.slice(1)) {
      if (r.hash === okRuns[0].hash) continue;
      const other = fs.readFileSync(path.join(OUTPUT_DIR, `run-${r.run}.csv`), 'utf-8').split('\n');
      console.log(`\n  Diff run-1 vs run-${r.run}:`);
      if (run1.length !== other.length) {
        console.log(`    Line count: ${run1.length} vs ${other.length}`);
      }
      const maxLines = Math.max(run1.length, other.length);
      let diffCount = 0;
      for (let i = 0; i < maxLines && diffCount < 5; i++) {
        if (run1[i] !== other[i]) {
          diffCount++;
          console.log(`    Line ${i + 1}:`);
          console.log(`      run-1:     ${(run1[i] || '(missing)').slice(0, 120)}`);
          console.log(`      run-${r.run}: ${(other[i] || '(missing)').slice(0, 120)}`);
        }
      }
    }
  }
}

console.log(`\nOutput files saved in: ${OUTPUT_DIR}/`);
