// Renders the Facebook page images. Run from the repo root: node docs/fb/src/render.js
// Needs Noto Sans TC woff2 files in docs/fb/src/fonts (npm pack @fontsource/noto-sans-tc; not committed).
const { chromium } = require('playwright');
const path = require('path');
(async () => {
  const browser = await chromium.launch();
  const jobs = [['cover.html', 'fb-cover.png', 1640, 624], ['avatar.html', 'fb-avatar.png', 1200, 1200]];
  for (const [src, out, width, height] of jobs) {
    const page = await browser.newPage({ viewport: { width, height } });
    await page.goto('file://' + path.join(__dirname, src));
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(__dirname, '..', out) });
  }
  await browser.close();
})();
