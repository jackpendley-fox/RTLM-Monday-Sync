const axios = require('axios');

const MONDAY_API_URL = 'https://api.monday.com/v2';
const MONDAY_KEY =
  'eyJhbGciOiJIUzI1NiJ9.eyJ0aWQiOjYzMzAxNTc3OCwiYWFpIjoxMSwidWlkIjoxMDA3MDU2NDUsImlhZCI6IjIwMjYtMDMtMTNUMjE6MTc6MTguMDAwWiIsInBlciI6Im1lOndyaXRlIiwiYWN0aWQiOjIxODY1MTQsInJnbiI6InVzZTEifQ.-785SPVTxelVwE6hjt_56XCDTkAiWXqj7vfrFWG218o';
const BOARD_ID = '18404158031';
const API_VERSION = '2023-10';

const COLUMN_IDS = {
  START_TIME: 'date4',
  END_TIME: 'date_mkzc3q4b',
  CALL_SIGN: 'dropdown',
  TMS_ID: 'text4',
  FOXIPEDIA_ID: 'text__1',
  MEDIA_SOURCE: 'dropdown9',
};

const CALL_SIGN_MAP = {
  FOXD: 'FOXDEP',
  FSCPL: 'FSP',
  FBCS: 'FOX',
  FS1D: 'FS1-Digital',
};

function mapCallSign(cs) {
  if (!cs) return cs;
  if (cs.startsWith('BTNP')) return 'B1G+';
  return CALL_SIGN_MAP[cs] || cs;
}

function mapMediaSource(ms) {
  if (!ms) return ms;
  const match = ms.match(/^(?:DTC|RTLM)\s*-\s*(BTNP\d+|TX\d+)$/);
  return match ? match[1] : ms;
}

function isInfomercial(headline) {
  return (headline || '').toLowerCase() === 'infomercial';
}

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

async function mondayQuery(query, variables = {}, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await axios.post(
        MONDAY_API_URL,
        { query, variables },
        {
          headers: {
            Authorization: MONDAY_KEY,
            'Content-Type': 'application/json',
            'API-Version': API_VERSION,
          },
          timeout: 30000,
        },
      );

      if (response.data.errors) {
        const msg = response.data.errors[0].message || 'Unknown';
        if (/complexity budget/i.test(msg) || response.status === 429) {
          const backoff = attempt * 5000;
          console.warn(`[MONDAY] Rate limited, backing off ${backoff / 1000}s...`);
          await delay(backoff);
          continue;
        }
        throw new Error(`Monday API: ${msg}`);
      }

      return response.data.data;
    } catch (err) {
      if (attempt < retries && (err.code === 'ECONNRESET' || err.response?.status === 429)) {
        await delay(attempt * 3000);
        continue;
      }
      throw err;
    }
  }
}

const FETCH_COLUMNS = Object.values(COLUMN_IDS).map((id) => `"${id}"`).join(', ');

async function fetchAllItems() {
  const allItems = [];
  let cursor = null;

  while (true) {
    const query = cursor
      ? `query { next_items_page(cursor: "${cursor}") { cursor items { id name column_values(ids: [${FETCH_COLUMNS}]) { id text value } } } }`
      : `query { boards(ids: [${BOARD_ID}]) { items_page(limit: 500) { cursor items { id name column_values(ids: [${FETCH_COLUMNS}]) { id text value } } } } }`;

    const data = await mondayQuery(query);
    const page = cursor ? data.next_items_page : data.boards[0].items_page;

    allItems.push(...page.items);
    cursor = page.cursor;

    if (!cursor) break;
    await delay(300);
  }

  return allItems;
}

async function createItem(name, columnValues) {
  const query = `mutation ($name: String!, $values: JSON!) {
    create_item (board_id: ${BOARD_ID}, item_name: $name, column_values: $values) { id }
  }`;

  return mondayQuery(query, {
    name,
    values: JSON.stringify(columnValues),
  });
}

async function updateItem(itemId, columnValues) {
  const query = `mutation ($itemId: ID!, $values: JSON!) {
    change_multiple_column_values (board_id: ${BOARD_ID}, item_id: $itemId, column_values: $values) { id }
  }`;

  return mondayQuery(query, {
    itemId: String(itemId),
    values: JSON.stringify(columnValues),
  });
}

async function updateItemName(itemId, newName) {
  const escaped = newName.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const query = `mutation { change_simple_column_value (board_id: ${BOARD_ID}, item_id: ${itemId}, column_id: "name", value: "${escaped}") { id } }`;
  return mondayQuery(query);
}

async function archiveItem(itemId) {
  const query = `mutation { archive_item (item_id: ${itemId}) { id } }`;
  return mondayQuery(query);
}

module.exports = {
  BOARD_ID,
  COLUMN_IDS,
  mapCallSign,
  mapMediaSource,
  isInfomercial,
  fetchAllItems,
  createItem,
  updateItem,
  updateItemName,
  archiveItem,
  delay,
};
