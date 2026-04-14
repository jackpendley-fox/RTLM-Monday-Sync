#!/usr/bin/env node
/**
 * Test runner — loads every suite and prints a unified report.
 *
 * Usage:
 *   node tests/run-all.js            # all tests
 *   node tests/run-all.js --skip-e2e # skip live API tests
 *
 * Individual suites can also be run directly:
 *   node tests/unit.test.js
 */

const t = require('./harness');

// Synchronous suites
require('./unit.test');
require('./functional.test');
require('./regression.test');

// Async suite (E2E)
const e2e = require('./e2e.test');

(async () => {
  await e2e.run();
  t.report();
  process.exit(t.exitCode());
})();
