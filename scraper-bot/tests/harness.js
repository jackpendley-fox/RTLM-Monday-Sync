/**
 * Lightweight test harness for the RTLM→Monday sync pipeline.
 *
 * Provides colored pass/fail/skip output, failure tracking, and a final
 * summary.  Shared across all test files — import once in each suite.
 *
 * Usage in a test file:
 *   const t = require('./harness');
 *   t.section('My Suite');
 *   t.test('thing works', 1 + 1 === 2);
 *   // … more tests …
 *   // (don't call t.report() — run-all.js does that once at the end)
 */

let pass = 0;
let fail = 0;
let skip = 0;
const failures = [];

function section(title) {
  console.log(`\n── ${title} ──`);
}

function test(name, condition) {
  if (condition) {
    pass++;
    console.log(`  \x1b[32mPASS\x1b[0m ${name}`);
  } else {
    fail++;
    failures.push(name);
    console.log(`  \x1b[31mFAIL\x1b[0m ${name}`);
  }
}

function skipped(name, reason) {
  skip++;
  console.log(`  \x1b[33mSKIP\x1b[0m ${name} — ${reason}`);
}

function report() {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`TEST RESULTS: ${pass} passed, ${fail} failed, ${skip} skipped`);
  if (failures.length > 0) {
    console.log('\nFailures:');
    for (const f of failures) console.log(`  ${f}`);
  }
  console.log(`${'='.repeat(60)}\n`);
}

function exitCode() {
  return fail > 0 ? 1 : 0;
}

module.exports = { section, test, skipped, report, exitCode };
