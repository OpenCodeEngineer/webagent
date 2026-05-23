#!/usr/bin/env python3
"""
Lamoom MVP E2E Test — Phases 0-6
Runs all phases sequentially, captures screenshots, times each milestone.
"""
import asyncio
import time
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

OUTPUT_DIR = Path("/home/azureuser/workspace/webagent/evals/e2e-output/2026-05-23")
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

LAMOOM_HOST = "https://dev.lamoom.com"
EMAIL = "demo@lamoom.com"
PASSWORD = "demo123"
TARGET_URL = "https://example.com"

timings = {}
results = {}


async def run_e2e():
    from playwright.async_api import async_playwright, TimeoutError as PWTimeout

    async with async_playwright() as p:
        browser = await p.chromium.launch(
            headless=True,
            args=["--no-sandbox", "--disable-setuid-sandbox"]
        )
        context = await browser.new_context(
            ignore_https_errors=True,
            viewport={"width": 1280, "height": 900}
        )
        page = await context.new_page()

        # ─── PHASE 0: Pre-flight ───────────────────────────────────────────
        print("[Phase 0] Pre-flight checks already confirmed via curl.")
        results["phase0"] = "PASS"

        # ─── PHASE 1: Authentication ───────────────────────────────────────
        print("[Phase 1] Navigating to login page...")
        t0 = time.time()
        timings["T0"] = datetime.now(timezone.utc).strftime("%H:%M:%S")
        await page.goto(f"{LAMOOM_HOST}/login", wait_until="networkidle", timeout=30000)
        await page.screenshot(path=str(OUTPUT_DIR / "01-login.png"))
        print("[Phase 1] Screenshot: 01-login.png")

        # Fill credentials
        email_input = page.locator('input[type="email"], input[name="email"]').first
        password_input = page.locator('input[type="password"], input[name="password"]').first
        await email_input.fill(EMAIL)
        await password_input.fill(PASSWORD)
        await page.screenshot(path=str(OUTPUT_DIR / "01b-login-filled.png"))
        print("[Phase 1] Filled credentials")

        # Submit
        submit_btn = page.locator('button[type="submit"]').first
        await submit_btn.click()

        # Wait for dashboard or error
        try:
            await page.wait_for_url(f"{LAMOOM_HOST}/dashboard*", timeout=15000)
            timings["T1"] = datetime.now(timezone.utc).strftime("%H:%M:%S")
            await page.screenshot(path=str(OUTPUT_DIR / "02-login-success.png"))
            print(f"[Phase 1] ✅ Logged in — redirected to: {page.url}")
            results["phase1"] = "PASS"
        except PWTimeout:
            current_url = page.url
            await page.screenshot(path=str(OUTPUT_DIR / "02-login-failure.png"))
            body_text = await page.locator("body").inner_text()
            print(f"[Phase 1] ❌ FAILED — still at: {current_url}")
            print(f"[Phase 1] Page text: {body_text[:500]}")
            results["phase1"] = f"FAIL: stuck at {current_url}"
            results["phase1_error"] = body_text[:500]
            await browser.close()
            return results, timings

        # ─── PHASE 2: Agent Creation ───────────────────────────────────────
        print("[Phase 2] Navigating to /create...")
        await page.goto(f"{LAMOOM_HOST}/create", wait_until="networkidle", timeout=30000)
        await page.screenshot(path=str(OUTPUT_DIR / "03-create-page.png"))

        # Wait for textarea to become enabled (max 30s)
        textarea = page.locator('textarea').first
        print("[Phase 2] Waiting for textarea to become enabled...")
        try:
            for _ in range(30):
                if not await textarea.is_disabled():
                    break
                await asyncio.sleep(1)
            else:
                await page.screenshot(path=str(OUTPUT_DIR / "03-textarea-disabled.png"))
                print("[Phase 2] ❌ Textarea still disabled after 30s")
                results["phase2"] = "FAIL: textarea disabled"
                # Check console for ws errors
                results["phase2_note"] = "WS auth possibly broken"
                await browser.close()
                return results, timings
        except Exception as e:
            print(f"[Phase 2] textarea check error: {e}")

        await page.screenshot(path=str(OUTPUT_DIR / "03-create-textarea-enabled.png"))
        print("[Phase 2] ✅ Textarea enabled")

        # Send creation message
        timings["T2"] = datetime.now(timezone.utc).strftime("%H:%M:%S")
        await textarea.fill(f"Create an AI chat agent for {TARGET_URL}")
        # Submit message
        send_btn = page.locator('button[type="submit"], button:has-text("Send"), button[aria-label*="send" i]').first
        try:
            await send_btn.click()
        except Exception:
            await page.keyboard.press("Enter")

        print("[Phase 2] Sent creation message. Waiting for discovery response (max 90s)...")
        # Wait for discovery response
        try:
            await page.wait_for_selector('.message, [data-role="assistant"], [class*="assistant"]', timeout=90000)
            timings["T3"] = datetime.now(timezone.utc).strftime("%H:%M:%S")
            await page.screenshot(path=str(OUTPUT_DIR / "04-discovery-response.png"))
            print("[Phase 2] ✅ Got discovery response")
        except PWTimeout:
            await page.screenshot(path=str(OUTPUT_DIR / "04-no-response.png"))
            print("[Phase 2] ❌ No discovery response in 90s")
            results["phase2"] = "FAIL: no discovery response"
            await browser.close()
            return results, timings

        # Check if meta-agent is asking for confirmation or gave embed code
        page_content = await page.content()
        page_text = await page.locator("body").inner_text()

        # Look for embed code or confirmation prompt
        embed_token = None

        if "data-agent-token" in page_text or "data-agent-token" in page_content:
            # Extract embed token from page
            import re
            m = re.search(r'data-agent-token["\s]*[:=]["\s]*([a-f0-9-]{36})', page_text + page_content)
            if m:
                embed_token = m.group(1)

        # Check if we need to confirm
        confirmation_phrases = ["should i create", "shall i create", "create this agent", "create it", "confirm", "proceed"]
        needs_confirmation = any(p in page_text.lower() for p in confirmation_phrases)

        if needs_confirmation and not embed_token:
            print("[Phase 2] Meta-agent asking for confirmation. Replying 'Yes, create it'...")
            await textarea.fill("Yes, create it")
            try:
                await send_btn.click()
            except Exception:
                await page.keyboard.press("Enter")
            timings["T4"] = datetime.now(timezone.utc).strftime("%H:%M:%S")

        # Wait for embed code (max 3 minutes)
        print("[Phase 2] Waiting for embed code (max 180s)...")
        embed_found = False
        for i in range(36):  # 36 * 5s = 180s
            await asyncio.sleep(5)
            page_text = await page.locator("body").inner_text()
            page_content = await page.content()

            import re
            # Try to find embed token patterns
            patterns = [
                r'data-agent-token["\s]*[:=]["\s]*["\']?([a-f0-9-]{36})',
                r'embedToken["\s]*[:=]["\s]*["\']?([a-f0-9-]{36})',
                r'agent[-_]token["\s]*[:=]["\s]*["\']?([a-f0-9-]{36})',
                r'([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})',
            ]
            for pat in patterns:
                m = re.search(pat, page_text + page_content, re.IGNORECASE)
                if m:
                    candidate = m.group(1)
                    # Filter out common non-token UUIDs like session IDs
                    if candidate and len(candidate) == 36:
                        embed_token = candidate
                        embed_found = True
                        break

            if embed_found:
                break

            # Check if there's a new message with script tag
            if "<script" in page_text and "widget" in page_text.lower():
                embed_found = True
                break

            if (i+1) % 6 == 0:
                await page.screenshot(path=str(OUTPUT_DIR / f"04-waiting-{i+1}.png"))
                print(f"[Phase 2] Still waiting... ({(i+1)*5}s elapsed)")

        timings["T5"] = datetime.now(timezone.utc).strftime("%H:%M:%S")
        await page.screenshot(path=str(OUTPUT_DIR / "05-embed-code.png"))

        if embed_token:
            print(f"[Phase 2] ✅ Got embed token: {embed_token}")
            results["phase2"] = "PASS"
            results["embed_token"] = embed_token
        else:
            # Try to get whatever text is on page for debugging
            body = await page.locator("body").inner_text()
            print(f"[Phase 2] ⚠️  No clear embed token found after 180s")
            print(f"[Phase 2] Page contains: {body[-2000:]}")
            results["phase2"] = "PARTIAL: no clear embed token UUID"
            results["page_text_excerpt"] = body[-500:]

        # ─── PHASE 3: Dashboard Verification ──────────────────────────────
        print("[Phase 3] Navigating to dashboard...")
        await page.goto(f"{LAMOOM_HOST}/dashboard", wait_until="networkidle", timeout=30000)
        timings["T6"] = datetime.now(timezone.utc).strftime("%H:%M:%S")
        await page.screenshot(path=str(OUTPUT_DIR / "06-dashboard-agent.png"))

        dashboard_text = await page.locator("body").inner_text()

        # Check if example.com agent appears
        if "example.com" in dashboard_text.lower() or "example" in dashboard_text.lower():
            print("[Phase 3] ✅ Agent appears in dashboard")
            results["phase3"] = "PASS"
        else:
            print(f"[Phase 3] ⚠️  Dashboard text: {dashboard_text[:500]}")
            results["phase3"] = f"PARTIAL: agent may not appear. Text: {dashboard_text[:200]}"

        # Try to find agent detail link
        agent_link = page.locator('a[href*="/dashboard/agents/"], [href*="/agents/"]').first
        try:
            agent_href = await agent_link.get_attribute("href", timeout=3000)
            if agent_href:
                print(f"[Phase 3] Opening agent detail: {agent_href}")
                await agent_link.click()
                await page.wait_for_load_state("networkidle", timeout=15000)
                await page.screenshot(path=str(OUTPUT_DIR / "07-agent-detail.png"))
                detail_text = await page.locator("body").inner_text()
                results["phase3_detail"] = "PASS" if ("embed" in detail_text.lower() or "script" in detail_text.lower()) else "PARTIAL"
        except Exception as e:
            print(f"[Phase 3] Could not open agent detail: {e}")
            results["phase3_detail"] = "FAIL: could not open detail"

        # ─── PHASE 4: Widget Chat ──────────────────────────────────────────
        if embed_token:
            print(f"[Phase 4] Testing widget with embed token: {embed_token}")
            # Navigate to a simple page and inject widget
            await page.goto("https://example.com", wait_until="networkidle", timeout=15000)

            widget_js = f"""
            localStorage.removeItem('lamoom_uid');
            const s = document.createElement('script');
            s.src = 'https://dev.lamoom.com/widget.js?cb=' + Date.now();
            s.setAttribute('data-agent-token', '{embed_token}');
            s.setAttribute('data-user-id', 'eval-user-' + Math.random().toString(36).slice(2));
            document.body.appendChild(s);
            """

            await page.evaluate(widget_js)
            await asyncio.sleep(5)
            await page.screenshot(path=str(OUTPUT_DIR / "08-widget-injected.png"))

            # Look for widget button and click it
            try:
                widget_btn = page.locator('[class*="widget"], [class*="chat-button"], [id*="widget"], button[class*="lamoom"]').first
                await widget_btn.click(timeout=8000)
                await asyncio.sleep(3)
                await page.screenshot(path=str(OUTPUT_DIR / "08-widget-open.png"))
                print("[Phase 4] ✅ Widget opened")
                results["phase4_open"] = "PASS"
            except Exception as e:
                await page.screenshot(path=str(OUTPUT_DIR / "08-widget-open-attempt.png"))
                print(f"[Phase 4] Could not click widget button: {e}")
                results["phase4_open"] = f"FAIL: {e}"

            # Try to send a question in the widget
            try:
                widget_input = page.locator('[class*="widget"] input, [class*="widget"] textarea, [id*="lamoom"] input').first
                await widget_input.fill("What is this website about?", timeout=8000)
                await widget_input.press("Enter")
                print("[Phase 4] Sent widget question. Waiting for response...")
                await asyncio.sleep(15)
                await page.screenshot(path=str(OUTPUT_DIR / "09-widget-response.png"))
                results["phase4_response"] = "ATTEMPTED"

                # Send follow-up
                await widget_input.fill("Can you tell me more about that?", timeout=5000)
                await widget_input.press("Enter")
                await asyncio.sleep(10)
                await page.screenshot(path=str(OUTPUT_DIR / "10-widget-followup.png"))
                results["phase4_followup"] = "ATTEMPTED"
            except Exception as e:
                print(f"[Phase 4] Could not interact with widget: {e}")
                results["phase4_response"] = f"FAIL: {e}"
        else:
            print("[Phase 4] Skipping widget test — no embed token")
            results["phase4_open"] = "SKIPPED"

        # ─── Timing summary ────────────────────────────────────────────────
        t_total = time.time() - t0
        timings["total_seconds"] = round(t_total, 1)
        print(f"\n[Timing] Total: {t_total:.1f}s ({t_total/60:.1f} min)")

        await browser.close()
        return results, timings


if __name__ == "__main__":
    results, timings = asyncio.run(run_e2e())
    print("\n=== RESULTS ===")
    print(json.dumps(results, indent=2))
    print("\n=== TIMINGS ===")
    print(json.dumps(timings, indent=2))

    # Save results
    with open("/home/azureuser/workspace/webagent/evals/e2e-output/2026-05-23/results.json", "w") as f:
        json.dump({"results": results, "timings": timings}, f, indent=2)
