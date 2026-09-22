/**
 * One-shot Playwright E2E for Simple Auth Phases 5–6.
 * Run: node scripts/e2e-simple-auth.mjs
 */
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE = process.env.SPA_URL || 'http://localhost:4444';
const outDir = path.join(__dirname, '..', 'target', 'e2e-screenshots');
fs.mkdirSync(outDir, { recursive: true });

const results = [];
function record(name, pass, detail = '') {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'} | ${name}${detail ? ' — ' + detail : ''}`);
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
const page = await context.newPage();
const apiCalls = [];

page.on('request', (req) => {
  if (req.url().includes('/petclinic/api/')) {
    apiCalls.push({
      url: req.url(),
      auth: req.headers()['authorization'] || null
    });
  }
});

try {
  await page.goto(BASE + '/login');
  await page.evaluate(() => localStorage.clear());

  // T-FE-06: unauthenticated protected route → /login
  await page.goto(BASE + '/owners/list');
  await page.waitForTimeout(800);
  const afterGuard = page.url();
  record('T-FE-06 guard redirects to /login', afterGuard.includes('/login'), afterGuard);
  await page.screenshot({ path: path.join(outDir, '01-guard-redirect.png'), fullPage: true });

  const loginNav = await page.locator('a[title="log in"]').count();
  record('Nav shows Login when logged out', loginNav > 0);

  // T-FE-03: empty submit
  await page.goto(BASE + '/login');
  await page.click('button[type="submit"]');
  await page.waitForTimeout(400);
  const emptyErr = await page.locator('.alert-danger').textContent().catch(() => '');
  const emptyStorage = await page.evaluate(() => ({
    u: localStorage.getItem('petclinic.username'),
    p: localStorage.getItem('petclinic.password')
  }));
  record('T-FE-03 empty fields show error, no storage',
    !!(emptyErr && emptyErr.length) && !emptyStorage.u && !emptyStorage.p,
    emptyErr || '');

  // T-FE-02: bad password
  await page.fill('input[name="username"]', 'admin');
  await page.fill('input[name="password"]', 'wrong');
  apiCalls.length = 0;
  await page.click('button[type="submit"]');
  await page.waitForTimeout(2000);
  const badErr = await page.locator('.alert-danger').textContent().catch(() => '');
  const badStorage = await page.evaluate(() => ({
    u: localStorage.getItem('petclinic.username'),
    p: localStorage.getItem('petclinic.password')
  }));
  record('T-FE-02 invalid credentials error, no storage',
    !!(badErr && badErr.length) && !badStorage.u && page.url().includes('/login'),
    badErr || '');
  await page.screenshot({ path: path.join(outDir, '02-bad-login.png'), fullPage: true });

  // T-FE-01: valid login
  await page.fill('input[name="username"]', 'admin');
  await page.fill('input[name="password"]', 'admin');
  apiCalls.length = 0;
  await page.click('button[type="submit"]');
  await page.waitForTimeout(2500);
  const afterLoginUrl = page.url();
  const goodStorage = await page.evaluate(() => ({
    u: localStorage.getItem('petclinic.username'),
    p: localStorage.getItem('petclinic.password')
  }));
  const pageHtml = await page.content();
  record('T-FE-01 valid login stores session and lands home',
    !afterLoginUrl.includes('/login') &&
    goodStorage.u === 'admin' && goodStorage.p === 'admin',
    afterLoginUrl);
  record('Welcome shows Signed in as admin', pageHtml.includes('Signed in as') && pageHtml.includes('admin'));
  await page.screenshot({ path: path.join(outDir, '03-login-success.png'), fullPage: true });

  // T-FE-04
  const logoutNav = await page.locator('a[title="log out"]').count();
  const loginNavAfter = await page.locator('a[title="log in"]').count();
  record('T-FE-04 nav shows Logout not Login', logoutNav > 0 && loginNavAfter === 0);

  // T-FE-05
  await page.goto(BASE + '/vets');
  await page.waitForTimeout(2500);
  const withAuth = apiCalls.filter(c => c.auth && c.auth.startsWith('Basic '));
  record('T-FE-05 API calls send Authorization Basic', withAuth.length > 0,
    `authCalls=${withAuth.length} totalApi=${apiCalls.length}`);
  await page.screenshot({ path: path.join(outDir, '04-vets-with-auth.png'), fullPage: true });

  // T-FE-07/08 logout
  await page.goto(BASE + '/');
  await page.waitForTimeout(500);
  await page.click('a[title="log out"]');
  await page.waitForTimeout(2000);
  const afterLogoutUrl = page.url();
  const cleared = await page.evaluate(() => ({
    u: localStorage.getItem('petclinic.username'),
    p: localStorage.getItem('petclinic.password')
  }));
  record('T-FE-07 logout clears storage', !cleared.u && !cleared.p);
  record('T-FE-07/08 redirect to /login after logout', afterLogoutUrl.includes('/login'), afterLogoutUrl);
  const loginNav2 = await page.locator('a[title="log in"]').count();
  record('T-FE-08 nav shows Login after logout', loginNav2 > 0);
  await page.screenshot({ path: path.join(outDir, '05-after-logout.png'), fullPage: true });

  await page.goto(BASE + '/owners/list');
  await page.waitForTimeout(1000);
  record('T-FE-09 after logout guard redirects', page.url().includes('/login'), page.url());

} catch (e) {
  record('UNCAUGHT', false, String(e));
  await page.screenshot({ path: path.join(outDir, '99-error.png'), fullPage: true }).catch(() => {});
} finally {
  await browser.close();
}

const failed = results.filter(r => !r.pass).length;
console.log('\n=== E2E SUMMARY ===');
console.log(`Passed: ${results.length - failed} / ${results.length}  Failed: ${failed}`);
console.log('Screenshots:', outDir);
process.exit(failed > 0 ? 1 : 0);
