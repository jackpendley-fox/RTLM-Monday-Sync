const { chromium } = require('playwright');

(async () => {
  // Launch a visible browser
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();

  // Go to the RTLM URL
  console.log("Opening browser. Please log in manually...");
  await page.goto('https://mam.mediacloud.fox/tools/rtlm/listings'); // Update this to the exact entry URL

  // The script will wait for you to finish SSO/MFA. 
  // Once you see the dashboard, come back to the terminal and press Enter.
  console.log("Once you are fully logged in and see the dashboard, press Enter here in the terminal.");
  
  process.stdin.resume();
  process.stdin.on('data', async () => {
    // Save cookies and local storage to a file
    await page.context().storageState({ path: 'storageState.json' });
    console.log("✅ Session saved to storageState.json!");
    await browser.close();
    process.exit();
  });
})();