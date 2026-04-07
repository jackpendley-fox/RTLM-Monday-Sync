/**
 * Downloads Chromium into build/playwright-browsers so electron-builder can
 * copy it into the .app bundle (extraResources → Resources/playwright-browsers).
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const targetDir = path.join(root, 'build', 'playwright-browsers');

fs.mkdirSync(path.join(root, 'build'), { recursive: true });

const env = {
  ...process.env,
  PLAYWRIGHT_BROWSERS_PATH: targetDir,
};

console.log(`[prepare-playwright-browsers] Installing Chromium to ${targetDir} ...`);
execSync('npx playwright install chromium', {
  cwd: root,
  env,
  stdio: 'inherit',
});
