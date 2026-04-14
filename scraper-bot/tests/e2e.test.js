/**
 * E2E tests — live Monday.com API calls.
 *
 * These hit the real API (create → update → archive → verify).
 * Skip with: --skip-e2e
 */

const t = require('./harness');
const { monday } = require('./fixtures');

const skipE2e = process.argv.includes('--skip-e2e');

async function run() {
  t.section('E2E Tests (live API)');

  if (skipE2e) {
    const names = [
      'fetchAllItems succeeds',
      'items have expected shape',
      'createItem returns item ID',
      'updateItem succeeds',
      'updateItemName succeeds',
      'updated item found after fetch',
      'Foxipedia ID updated correctly',
      'item name updated correctly',
      'archiveItem succeeds',
      'archived item no longer in active items',
    ];
    for (const n of names) t.skipped(n, '--skip-e2e flag');
    return;
  }

  let createdItemId = null;

  try {
    const items = await monday.fetchAllItems();
    t.test('fetchAllItems succeeds', Array.isArray(items));
    t.test('items have expected shape', items.length === 0 ||
      (items[0].id && items[0].name && Array.isArray(items[0].column_values)));

    const testName = `__TEST_${Date.now()}`;
    const testValues = {
      [monday.COLUMN_IDS.START_TIME]: { date: '2026-04-15', time: '14:00:00' },
      [monday.COLUMN_IDS.END_TIME]: { date: '2026-04-15', time: '17:00:00' },
      [monday.COLUMN_IDS.CALL_SIGN]: { labels: ['FS1'] },
      [monday.COLUMN_IDS.TMS_ID]: 'EP_TEST_001',
      [monday.COLUMN_IDS.FOXIPEDIA_ID]: 'EPI_TEST',
    };
    const createResult = await monday.createItem(testName, testValues);
    createdItemId = createResult?.create_item?.id;
    t.test('createItem returns item ID', !!createdItemId);

    if (createdItemId) {
      await monday.delay(1000);

      const updateValues = {
        [monday.COLUMN_IDS.END_TIME]: { date: '2026-04-15', time: '18:00:00' },
        [monday.COLUMN_IDS.FOXIPEDIA_ID]: 'EPI_UPDATED',
      };
      const updateResult = await monday.updateItem(createdItemId, updateValues);
      t.test('updateItem succeeds', !!updateResult);

      await monday.delay(1000);

      const nameResult = await monday.updateItemName(createdItemId, testName + ' UPDATED');
      t.test('updateItemName succeeds', !!nameResult);

      await monday.delay(1000);

      const afterUpdate = await monday.fetchAllItems();
      const found = afterUpdate.find(i => i.id === String(createdItemId));
      t.test('updated item found after fetch', !!found);
      if (found) {
        const foxCol = found.column_values.find(cv => cv.id === monday.COLUMN_IDS.FOXIPEDIA_ID);
        t.test('Foxipedia ID updated correctly', foxCol?.text === 'EPI_UPDATED');
        t.test('item name updated correctly', found.name.includes('UPDATED'));
      }

      await monday.delay(1000);

      const archiveResult = await monday.archiveItem(createdItemId);
      t.test('archiveItem succeeds', !!archiveResult);

      await monday.delay(1000);

      const afterArchive = await monday.fetchAllItems();
      const stillExists = afterArchive.find(i => i.id === String(createdItemId));
      t.test('archived item no longer in active items', !stillExists);

      createdItemId = null;
    }
  } catch (err) {
    console.log(`  \x1b[31mE2E ERROR:\x1b[0m ${err.message}`);
  } finally {
    if (createdItemId) {
      try { await monday.archiveItem(createdItemId); } catch {}
    }
  }
}

module.exports = { run };
