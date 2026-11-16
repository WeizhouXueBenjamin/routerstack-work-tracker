import {defineConfig} from '@playwright/test';
export default defineConfig({
  testDir:'./tests/browser',
  fullyParallel:true,
  workers:2,
  retries:0,
  reporter:'list',
  use:{browserName:'chromium',headless:true,acceptDownloads:true,timezoneId:'Pacific/Auckland',viewport:{width:1366,height:768}},
  projects:[{name:process.env.TEST_BROWSER || 'chromium',use:process.env.TEST_BROWSER?{channel:process.env.TEST_BROWSER}:{}}]
});
