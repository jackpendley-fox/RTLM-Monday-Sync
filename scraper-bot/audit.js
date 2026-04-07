const axios = require('axios');
const fs = require('fs');

const MONDAY_KEY = process.env.MONDAY_API_KEY;
const BOARD_ID = "18404158031";

async function getAllMondayItems() {
    let allItems = [];
    let hasMore = true;
    let cursor = null;

    console.log("🔍 Fetching all items from Monday (Target: 1610)...");

    while (hasMore) {
        // Query changes slightly if we have a cursor
        const query = cursor 
            ? `query { next_items_page(cursor: "${cursor}") { cursor items { name } } }`
            : `query { boards(ids: [${BOARD_ID}]) { items_page(limit: 500) { cursor items { name } } } }`;

        const response = await axios.post('https://api.monday.com/v2', { query }, {
            headers: { 'Authorization': MONDAY_KEY, 'Content-Type': 'application/json', 'API-Version': '2023-10' }
        });

        const data = cursor ? response.data.data.next_items_page : response.data.data.boards[0].items_page;
        
        allItems.push(...data.items.map(i => i.name));
        cursor = data.cursor;
        hasMore = !!cursor;

        console.log(`📦 Retrieved ${allItems.length} items so far...`);
    }

    console.log(`✅ Final Audit: Found ${allItems.length} items on Monday.`);
    
    // SAVE TO FILE FOR COMPARISON
    fs.writeFileSync('monday_actual_items.json', JSON.stringify(allItems, null, 2));
    return allItems;
}

getAllMondayItems();