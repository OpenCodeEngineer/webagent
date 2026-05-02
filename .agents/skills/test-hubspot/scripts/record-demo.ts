// E2E Visual Demo Recorder — Playwright script
// Records the full user flow as video + annotated screenshots → GIF
//
// Usage:
//   npx playwright test --config=.agents/skills/e2e-playwright-test/scripts/playwright.config.ts
// Or directly:
//   npx tsx .agents/skills/e2e-playwright-test/scripts/record-demo.ts [BASE_URL]

import { chromium, type Page } from 'playwright';
import { mkdirSync, existsSync } from 'fs';
import { join, resolve } from 'path';
import { execSync } from 'child_process';

const BASE_URL = process.argv[2] || process.env.BASE_URL || 'https://dev.lamoom.com';
const OUTPUT_DIR = resolve(process.env.OUTPUT_DIR || './e2e-demo-output');
const TEST_EMAIL = process.env.TEST_EMAIL || 'demo@lamoom.com';
const TEST_PASSWORD = process.env.TEST_PASSWORD || 'demo123';

// How long to wait for AI responses (meta-agent can be slow)
const AI_TIMEOUT = 120_000;

let stepNum = 0;

async function screenshot(page: Page, label: string) {
  stepNum++;
  const filename = `step-${String(stepNum).padStart(2, '0')}-${label.replace(/\s+/g, '-').toLowerCase()}.png`;
  await page.screenshot({ path: join(OUTPUT_DIR, filename), fullPage: false });
  console.log(`📸 Step ${stepNum}: ${label}`);
}

async function waitForLoadingToFinish(page: Page) {
  // Wait for the bouncing dots loader to disappear (meta-agent responding)
  try {
    await page.waitForSelector('.animate-bounce', { state: 'detached', timeout: AI_TIMEOUT });
  } catch {
    // Loader may never appear or already gone
  }
  await page.waitForTimeout(500);
}

async function run() {
  if (!existsSync(OUTPUT_DIR)) mkdirSync(OUTPUT_DIR, { recursive: true });

  console.log('🎬 Starting E2E demo recording');
  console.log(`   Target: ${BASE_URL}`);
  console.log(`   Output: ${OUTPUT_DIR}`);
  console.log('');

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    ignoreHTTPSErrors: true,
    recordVideo: {
      dir: OUTPUT_DIR,
      size: { width: 1280, height: 800 },
    },
  });

  const page = await context.newPage();

  try {
    // ── Step 1: Login page ──────────────────────────────
    console.log('── Login Flow ──');
    await page.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1000);
    await screenshot(page, 'login-page');

    // ── Step 2: Fill credentials and submit ─────────────
    await page.fill('input[type="email"]', TEST_EMAIL);
    await page.fill('input[type="password"]', TEST_PASSWORD);
    await screenshot(page, 'credentials-filled');

    await page.click('button[type="submit"]');
    console.log('   Submitting login...');

    // ── Step 3: Dashboard loads ─────────────────────────
    await page.waitForURL('**/dashboard**', { timeout: 15_000 });
    await page.waitForTimeout(1500);
    await screenshot(page, 'dashboard');
    console.log('   ✓ Logged in, dashboard loaded');

    // ── Step 4: Click "Create New Agent" ────────────────
    console.log('');
    console.log('── Agent Creation Flow ──');
    const createLink = page.locator('a[href="/create"]').first();
    if (await createLink.isVisible()) {
      await createLink.click();
    } else {
      await page.goto(`${BASE_URL}/create`, { waitUntil: 'networkidle' });
    }
    await page.waitForURL('**/create**', { timeout: 10_000 });
    await screenshot(page, 'create-page-loading');

    // ── Step 5: Wait for meta-agent greeting ────────────
    console.log('   Waiting for AI greeting...');
    // The greeting appears as an assistant message bubble
    await page.waitForSelector('text=agent', { timeout: AI_TIMEOUT }).catch(() => {});
    await waitForLoadingToFinish(page);
    await page.waitForTimeout(1000);
    await screenshot(page, 'ai-greeting-received');

    // Verify it's a real AI response, not error
    const greetingText = await page.locator('.rounded-lg.bg-muted\\/50').first().textContent() ?? '';
    if (greetingText.includes('⚠️') || greetingText.length < 20) {
      console.log(`   ⚠ Greeting seems like error: "${greetingText.slice(0, 100)}"`);
    } else {
      console.log(`   ✓ AI greeting received (${greetingText.length} chars)`);
    }

    // ── Step 6: User sends first message ────────────────
    const userMessage1 = 'I run an online pottery shop at pottery-palace.com. We sell handmade ceramic bowls, vases, and mugs. Our customers often ask about shipping times and custom orders.';
    console.log('   Sending: pottery shop description');
    await page.fill('textarea', userMessage1);
    await screenshot(page, 'user-typing-message');

    await page.click('button:has(svg)'); // Send button
    await screenshot(page, 'message-sent-waiting');

    // ── Step 7: Wait for AI response ────────────────────
    console.log('   Waiting for AI response...');
    await waitForLoadingToFinish(page);
    await page.waitForTimeout(1000);
    await screenshot(page, 'ai-response-1');

    // Check the latest assistant message
    const msgs = page.locator('.rounded-lg.bg-muted\\/50');
    const lastMsg = msgs.last();
    const responseText = await lastMsg.textContent() ?? '';
    if (responseText.length > 30) {
      console.log(`   ✓ AI responded (${responseText.length} chars)`);
    } else {
      console.log(`   ⚠ Response too short: "${responseText.slice(0, 100)}"`);
    }

    // ── Step 8: Second message — pick tone ──────────────
    const userMessage2 = 'I want a friendly and conversational tone. The agent should help with order tracking, shipping info, and custom order requests.';
    console.log('   Sending: tone preference');
    await page.fill('textarea', userMessage2);
    await page.click('button:has(svg)');
    await screenshot(page, 'second-message-sent');

    console.log('   Waiting for AI response...');
    await waitForLoadingToFinish(page);
    await page.waitForTimeout(1000);
    await screenshot(page, 'ai-response-2');

    const response2 = await msgs.last().textContent() ?? '';
    console.log(`   ✓ AI responded (${response2.length} chars)`);

    // ── Step 9: Check for embed code ────────────────────
    const embedSection = page.locator('text=Embed Snippet');
    if (await embedSection.isVisible({ timeout: 3000 }).catch(() => false)) {
      console.log('   ✓ Embed code generated!');
      await screenshot(page, 'embed-code-visible');
    } else {
      console.log('   ℹ No embed code yet (may need more conversation turns)');
      await screenshot(page, 'conversation-in-progress');
    }

    // ── Final: Full page screenshot ─────────────────────
    await screenshot(page, 'final-state');

  } catch (error) {
    console.error('❌ Error:', error instanceof Error ? error.message : error);
    await screenshot(page, 'error-state');
  } finally {
    await page.close();
    await context.close();
    await browser.close();
  }

  // ── Convert to GIF ──────────────────────────────────
  console.log('');
  console.log('── Generating outputs ──');

  // Generate GIF from screenshots
  const screenshotPattern = join(OUTPUT_DIR, 'step-*.png');
  const gifPath = join(OUTPUT_DIR, 'demo.gif');

  try {
    // Each frame shown for 3 seconds, scaled to 960px wide
    execSync(
      `ffmpeg -y -framerate 0.33 -pattern_type glob -i '${screenshotPattern}' ` +
      `-vf "scale=960:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=128[p];[s1][p]paletteuse=dither=bayer" ` +
      `'${gifPath}'`,
      { stdio: 'pipe' }
    );
    console.log(`✓ GIF saved: ${gifPath}`);
  } catch (err) {
    console.log(`⚠ GIF generation failed (ffmpeg needed): ${err instanceof Error ? err.message : err}`);
  }

  // Also check for webm video recorded by Playwright
  const videoFiles = execSync(`ls -la '${OUTPUT_DIR}'/*.webm 2>/dev/null || true`).toString().trim();
  if (videoFiles) {
    console.log(`✓ Video recorded: see ${OUTPUT_DIR}/*.webm`);

    // Convert webm to gif too
    try {
      const webmFile = execSync(`ls '${OUTPUT_DIR}'/*.webm | head -1`).toString().trim();
      const videoGif = join(OUTPUT_DIR, 'demo-video.gif');
      execSync(
        `ffmpeg -y -i '${webmFile}' -vf "fps=5,scale=960:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=128[p];[s1][p]paletteuse=dither=bayer" '${videoGif}'`,
        { stdio: 'pipe' }
      );
      console.log(`✓ Video GIF saved: ${videoGif}`);
    } catch {
      console.log('⚠ Video→GIF conversion failed');
    }
  }

  console.log('');
  console.log(`📁 All outputs in: ${OUTPUT_DIR}`);
  console.log(`   Screenshots: step-01 through step-${String(stepNum).padStart(2, '0')}`);
  console.log(`   GIF:         demo.gif (from screenshots, 3s/frame)`);
  console.log(`   Video GIF:   demo-video.gif (from browser recording)`);
}

run().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
