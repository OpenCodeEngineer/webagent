/**
 * HubSpot E2E Harness
 *
 * Verifies the real product flow under the current OpenCode session:
 * 1) Create a HubSpot product-agent via Lamoom meta-agent (/create)
 * 2) Inject widget in HubSpot browser context
 * 3) Run 3 widget-chat scenarios
 * 4) Evaluate each scenario with evaluator child sessions
 *
 * Usage:
 *   npx tsx tests/hubspot-e2e.ts \
 *     [--parent-session <session-id>] \
 *     [--hubspot-token <pat-...>] \
 *     [--hubspot-portal-id <portal-id>] \
 *     [--scenario create|search|deal|all] \
 *     [--hubspot-context-url <url>] \
 *     [--browser-tool playwright|vibebrowser]
 *
 * Environment fallbacks:
 *   OPENCODE_URL, OPENCODE_MODEL, OPENCODE_EVAL_MODEL, OPENCODE_PARENT_SESSION,
 *   HUBSPOT_TOKEN, HUBSPOT_PORTAL_ID,
 *   HUBSPOT_SCENARIO,
 *   LAMOOM_EMAIL, LAMOOM_PASSWORD, LAMOOM_INVITE_CODE,
 *   HUBSPOT_BROWSER_TOOL
 */

import * as assert from "node:assert";
import * as crypto from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { describe, test } from "node:test";

function loadDotEnv(filePath = `${process.cwd()}/.env`): void {
  if (!existsSync(filePath)) return;
  const raw = readFileSync(filePath, "utf8");

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;

    const key = trimmed.slice(0, eq).trim();
    if (!key || process.env[key] !== undefined) continue;

    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    process.env[key] = value;
  }
}

loadDotEnv();

// ---------------------------------------------------------------------------
// CLI helpers
// ---------------------------------------------------------------------------

function getArg(name: string): string | undefined {
  const flag = `--${name}`;
  const idx = process.argv.indexOf(flag);
  if (idx === -1) return undefined;
  const value = process.argv[idx + 1];
  if (!value || value.startsWith("--")) return undefined;
  return value;
}

function getIntArg(name: string, fallback: number): number {
  const raw = getArg(name);
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid --${name}: ${raw}`);
  }
  return parsed;
}

function must(name: string, envName?: string): string {
  const fromArg = getArg(name);
  if (fromArg) return fromArg;
  if (envName && process.env[envName]) return process.env[envName] as string;
  throw new Error(`Missing required value: --${name}${envName ? ` (or ${envName})` : ""}`);
}

function usageAndExit(err: unknown): never {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`ERROR: ${msg}\n`);
  console.error("Usage:");
  console.error(
    "  npx tsx tests/hubspot-e2e.ts [--parent-session <id>] [--hubspot-token <pat-...>] [--hubspot-portal-id <id>] [--scenario create|search|deal|all] [--hubspot-context-url <url>] [--browser-tool playwright|vibebrowser]"
  );
  console.error("  (or set OPENCODE_PARENT_SESSION/HUBSPOT_TOKEN/HUBSPOT_PORTAL_ID in env or .env)");
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

type BrowserTool = "playwright" | "vibebrowser";
type ScenarioSelector = "all" | "create" | "search" | "deal";

let PARENT_SESSION = "";
let HUBSPOT_TOKEN = "";
let HUBSPOT_PORTAL_ID = "";
let BROWSER_TOOL: BrowserTool = "playwright";
let SCENARIO_SELECTOR: ScenarioSelector = "all";

try {
  PARENT_SESSION = must("parent-session", "OPENCODE_PARENT_SESSION");
  HUBSPOT_TOKEN = must("hubspot-token", "HUBSPOT_TOKEN");
  HUBSPOT_PORTAL_ID = must("hubspot-portal-id", "HUBSPOT_PORTAL_ID");

  const browserArg = (
    getArg("browser-tool") ??
    process.env.HUBSPOT_BROWSER_TOOL ??
    "playwright"
  ).toLowerCase();

  if (browserArg !== "playwright" && browserArg !== "vibebrowser") {
    throw new Error(`Invalid --browser-tool: ${browserArg}`);
  }
  BROWSER_TOOL = browserArg;

  const scenarioArg = (getArg("scenario") ?? process.env.HUBSPOT_SCENARIO ?? "all").toLowerCase();
  if (scenarioArg !== "all" && scenarioArg !== "create" && scenarioArg !== "search" && scenarioArg !== "deal") {
    throw new Error(`Invalid --scenario: ${scenarioArg}`);
  }
  SCENARIO_SELECTOR = scenarioArg;
} catch (err) {
  usageAndExit(err);
}

const OC_URL = process.env.OPENCODE_URL ?? "http://100.108.64.76:4096";
const MAIN_MODEL = {
  providerID: process.env.OPENCODE_PROVIDER ?? "github-copilot",
  modelID: process.env.OPENCODE_MODEL ?? "claude-opus-4.6",
};
const EVAL_MODEL = {
  providerID: process.env.OPENCODE_EVAL_PROVIDER ?? MAIN_MODEL.providerID,
  modelID: process.env.OPENCODE_EVAL_MODEL ?? MAIN_MODEL.modelID,
};

const LAMOOM_EMAIL = process.env.LAMOOM_EMAIL ?? getArg("lamoom-email") ?? "demo@lamoom.com";
const LAMOOM_PASSWORD = process.env.LAMOOM_PASSWORD ?? getArg("lamoom-password") ?? "demo123";
const LAMOOM_INVITE_CODE = process.env.LAMOOM_INVITE_CODE ?? getArg("lamoom-invite-code") ?? "";

const PASS_THRESHOLD = 5; // out of 6
const POLL_INTERVAL_MS = getIntArg("poll-interval-ms", 10_000);
const SETUP_TIMEOUT_MS = getIntArg("setup-timeout-ms", 12 * 60 * 1000);
const SCENARIO_TIMEOUT_MS = getIntArg("scenario-timeout-ms", 10 * 60 * 1000);
const EVAL_TIMEOUT_MS = getIntArg("eval-timeout-ms", 3 * 60 * 1000);

const WIDGET_URL = "https://dev.lamoom.com/widget.js";
const LAMOOM_BASE_URL = "https://dev.lamoom.com";
const HUBSPOT_CONTEXT_URL =
  getArg("hubspot-context-url") ??
  process.env.HUBSPOT_CONTEXT_URL ??
  `https://www.hubspot.com/?portalId=${encodeURIComponent(HUBSPOT_PORTAL_ID)}`;
const RUN_LABEL = (
  getArg("run-label") ??
  process.env.HUBSPOT_RUN_LABEL ??
  Date.now().toString(36)
)
  .toLowerCase()
  .replace(/[^a-z0-9_-]/g, "");
const AGENT_SLUG = (
  getArg("agent-slug") ??
  process.env.HUBSPOT_AGENT_SLUG ??
  `hubspot-crm-agent-${RUN_LABEL}`
)
  .toLowerCase()
  .replace(/[^a-z0-9_-]/g, "-")
  .replace(/-+/g, "-")
  .replace(/^-|-$/g, "")
  .slice(0, 64);
const AGENT_NAME =
  getArg("agent-name") ??
  process.env.HUBSPOT_AGENT_NAME ??
  `HubSpot CRM Agent ${RUN_LABEL}`;

// ---------------------------------------------------------------------------
// OpenCode API helpers
// ---------------------------------------------------------------------------

interface Session {
  id: string;
  title: string;
  parentID?: string;
}

interface MessagePart {
  type: string;
  text?: string;
}

interface Message {
  info: {
    role: string;
    time: { created: number; completed?: number };
  };
  parts?: MessagePart[];
}

async function api<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`${OC_URL}${path}`, {
    ...opts,
    headers: { "Content-Type": "application/json", ...opts?.headers },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`API ${res.status} ${path}: ${body}`);
  }

  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

async function createSession(title: string): Promise<Session> {
  return api<Session>("/session", {
    method: "POST",
    body: JSON.stringify({ title, parentID: PARENT_SESSION }),
  });
}

async function sendPromptAsync(
  sessionId: string,
  text: string,
  model = MAIN_MODEL,
): Promise<void> {
  const res = await fetch(`${OC_URL}/session/${sessionId}/prompt_async`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      parts: [{ type: "text", text }],
      model,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`API ${res.status} /session/${sessionId}/prompt_async: ${body}`);
  }
}

async function getSessionStatus(sessionId: string): Promise<string | null> {
  const statuses = await api<Record<string, { type: string }>>("/session/status");
  const entry = statuses[sessionId];
  return entry?.type ?? null;
}

async function getMessages(sessionId: string, limit = 250): Promise<Message[]> {
  return api<Message[]>(`/session/${sessionId}/message?limit=${limit}`);
}

async function getAllAssistantText(sessionId: string): Promise<string> {
  const msgs = await getMessages(sessionId);
  const chunks: string[] = [];

  for (const msg of msgs) {
    if (msg.info.role !== "assistant" || !msg.parts) continue;
    for (const part of msg.parts) {
      if (part.type === "text" && part.text) chunks.push(part.text);
    }
  }

  return chunks.join("\n");
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForCompletion(sessionId: string, timeoutMs: number): Promise<string> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS);
    const status = await getSessionStatus(sessionId);

    if (status === null || status === "idle") {
      return getAllAssistantText(sessionId);
    }

    console.log(`  [${new Date().toISOString()}] ${sessionId} status: ${status}`);
  }

  throw new Error(`Session ${sessionId} timed out after ${timeoutMs / 1000}s`);
}

// ---------------------------------------------------------------------------
// Output parsing
// ---------------------------------------------------------------------------

function extractBalancedObjects(text: string): string[] {
  const results: string[] = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      continue;
    }

    if (ch === "{") {
      if (depth === 0) start = i;
      depth++;
      continue;
    }

    if (ch === "}") {
      depth--;
      if (depth === 0 && start !== -1) {
        results.push(text.slice(start, i + 1));
        start = -1;
      }
    }
  }

  return results;
}

function parseJsonFromOutput<T>(text: string): T {
  const candidates: string[] = [];
  const fenced: RegExp = /```json\s*([\s\S]*?)```/gi;

  let match: RegExpExecArray | null;
  while ((match = fenced.exec(text)) !== null) {
    candidates.push(match[1].trim());
  }

  candidates.push(...extractBalancedObjects(text));

  for (let i = candidates.length - 1; i >= 0; i--) {
    const candidate = candidates[i];
    try {
      return JSON.parse(candidate) as T;
    } catch {
      // keep trying
    }
  }

  throw new Error(`No parseable JSON found in output tail:\n${text.slice(-1000)}`);
}

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i;

function extractEmbedToken(text: string): string | null {
  const attrMatch = text.match(/data-agent-token\s*=\s*["']([0-9a-f-]{36})["']/i);
  if (attrMatch) return attrMatch[1];

  const jsonMatch = text.match(/["']embed_token["']\s*:\s*["']([0-9a-f-]{36})["']/i);
  if (jsonMatch) return jsonMatch[1];

  return null;
}

function redact(secret: string): string {
  if (secret.length < 8) return "***";
  return `${secret.slice(0, 4)}...${secret.slice(-4)}`;
}

// ---------------------------------------------------------------------------
// Prompt templates
// ---------------------------------------------------------------------------

function browserToolDirective(tool: BrowserTool): string {
  if (tool === "vibebrowser") {
    return [
      "Use VibeBrowser MCP tools for all browser actions.",
      "After each action, rely on the auto-returned markdown snapshot.",
      "Use uid=... references for clicks/fills.",
    ].join("\n");
  }

  return [
    "Use Playwright MCP browser_* tools for all browser actions.",
    "Follow observe -> act -> observe (snapshot after every key action).",
    "Use browser_snapshot for state checks and browser_evaluate for widget injection script.",
  ].join("\n");
}

function buildHubSpotProvisioningPrompt(): string {
  return `I want you to create a HubSpot CRM product-agent.

Create a NEW product-agent with these exact identifiers:
- Name: ${AGENT_NAME}
- Slug: ${AGENT_SLUG}

Do not reuse existing agents, prior embed tokens, or historical examples.
This must result in a fresh agent created in this current session.

Use this exact integration contract:
- Product-agent role: manage HubSpot contacts and deals via HubSpot CRM v3 API
- API base URL: https://api.hubapi.com
- Auth: Bearer token in header Authorization: Bearer ${HUBSPOT_TOKEN}
- CRM object base: /crm/v3/objects

Required actions and endpoint-level behavior:
1) Create contact
   - POST /crm/v3/objects/contacts
   - body: {"properties":{"email":"...","firstname":"...","lastname":"..."}}

2) Search/list contacts
   - POST /crm/v3/objects/contacts/search
   - support filtering by lastname and email when provided

3) Handle ambiguity for deal stage update
   - First search deals by name:
     POST /crm/v3/objects/deals/search
   - If zero or multiple matches, ask a clarification question and do not guess.
   - If exactly one match, update stage:
     PATCH /crm/v3/objects/deals/{dealId}
     body: {"properties":{"dealstage":"<stageId>"}}
   - If stage label is provided but stageId is unknown, fetch pipeline stage map first:
      GET /crm/v3/pipelines/deals/{pipelineId}

Execution policy (critical):
- If a request is unambiguous and safe (for example create contact with all required fields), execute immediately without an extra confirmation turn.
- If confirmation is required for a mutating action, when user replies with "Yes" (or equivalent), execute the exact previously proposed API call in the same conversation context.
- Do not reset to generic greeting/help after confirmation.
- After mutation, return concrete outcome (created/updated/existing), including relevant record id when available.

Quality rules for the product-agent:
- Use concrete HubSpot endpoints in instructions, not generic placeholders.
- Keep responses concise and user-facing (no raw JSON dumps).
- Never expose the Bearer token.
- For ambiguous requests, always clarify before mutating data.
- Never mention internal implementation details or tooling in end-user responses (for example curl/fetch/API call internals).
- Present only outcome-focused language suitable for end users.

Please create it now and return the embed script with data-agent-token.`;
}

function setupPrompt(): string {
  const inviteStep = LAMOOM_INVITE_CODE
    ? `3) In the invite code field, enter: ${LAMOOM_INVITE_CODE}
4) Submit sign-in. If account does not exist, this should register the user with invite code.
5) If you still see an auth error, return setup_success=false with blocking_error.`
    : `3) Submit sign-in.
4) If you still see an auth error, return setup_success=false with blocking_error.`;

  return `You are an execution agent running HubSpot E2E setup.

${browserToolDirective(BROWSER_TOOL)}

Goal:
Create a HubSpot product-agent via Lamoom meta-agent, then capture the product-agent embed token.

Hard requirements:
- Use browser UI flows only.
- Do not call HubSpot API directly.
- Use this Lamoom environment: ${LAMOOM_BASE_URL}

Steps:
1) Navigate to ${LAMOOM_BASE_URL}/login
2) Sign in with:
   - email: ${LAMOOM_EMAIL}
   - password: ${LAMOOM_PASSWORD}
${inviteStep}
6) Navigate to ${LAMOOM_BASE_URL}/create
7) Send EXACTLY this message to the meta-agent:

"""
${buildHubSpotProvisioningPrompt()}
"""

8) Wait up to 180 seconds for reply.
9) If the meta-agent asks confirmation, reply: "Yes, create it now." and wait again.
10) Open ${LAMOOM_BASE_URL}/dashboard and verify the NEW agent exists with:
    - name: ${AGENT_NAME}
    - slug: ${AGENT_SLUG} (or a very close variant if slug conflict forced suffix)
    - status: active
11) Open that agent's details page and capture the embed token from the dashboard embed code.
    Do NOT use embed token copied from chat transcript or historical messages.

Important success rule:
- Set setup_success=true ONLY when dashboard verification succeeds for the new agent and embed_token comes from the details page embed code.
- If dashboard does not show the new active agent, set setup_success=false.

Return ONLY valid JSON (no markdown):
{
  "setup_success": true,
  "product_agent_name": "...",
  "agent_slug": "...",
  "embed_token": "...",
  "dashboard_verification": "...",
  "meta_response_excerpt": "...",
  "notes": "...",
  "blocking_error": null
}

If blocked, return setup_success=false and include blocking_error.`;
}

interface Scenario {
  name: string;
  userMessage: string;
}

const ALL_SCENARIOS: Scenario[] = [
  {
    name: "Create a contact",
    userMessage:
      "Create a new contact: first name Sarah, last name Connor, email sarah.connor@skynet.com",
  },
  {
    name: "Search and list contacts",
    userMessage: "Find all contacts with the last name Connor and show me their details",
  },
  {
    name: "Handle ambiguity for deal update",
    userMessage: "Move the Skynet deal to the next stage",
  },
];

const SCENARIO_MAP: Record<Exclude<ScenarioSelector, "all">, Scenario> = {
  create: ALL_SCENARIOS[0],
  search: ALL_SCENARIOS[1],
  deal: ALL_SCENARIOS[2],
};

const SCENARIOS: Scenario[] =
  SCENARIO_SELECTOR === "all"
    ? ALL_SCENARIOS
    : [SCENARIO_MAP[SCENARIO_SELECTOR]];

function scenarioPrompt(
  scenario: Scenario,
  embedToken: string,
  userId: string,
  apiToken: string
): string {
  return `You are an execution agent running one HubSpot scenario against a Lamoom product-agent.

${browserToolDirective(BROWSER_TOOL)}

Goal:
Run the scenario through widget chat inside HubSpot browser context.

Hard requirements:
- Browser context URL must be HubSpot domain and use this URL: ${HUBSPOT_CONTEXT_URL}
- Do not execute scenario actions via direct HubSpot API calls.
- Execute only via widget chat.

Steps:
1) Navigate to ${HUBSPOT_CONTEXT_URL}
2) If this specific page blocks interaction, open https://www.hubspot.com/ and continue there.
3) Treat any *.hubspot.com page as valid HubSpot context.
   - If current hostname ends with "hubspot.com", set hubspot_context_confirmed=true.
4) Inject widget ONCE using browser page-eval with this exact script:

   document.querySelectorAll('script[src*="/widget.js"]').forEach((n) => n.remove());
   document.querySelectorAll('.lamoom-root-host').forEach((n) => n.remove());
   try { delete window.__lamoomWidgetLoaded; } catch (e) {}

   localStorage.removeItem('lamoom_uid');
   const s = document.createElement('script');
   s.src = '${WIDGET_URL}?cb=' + Date.now();
   s.setAttribute('data-agent-token', '${embedToken}');
   s.setAttribute('data-user-id', '${userId}');
   s.setAttribute('data-user-token', '${apiToken}');
   document.body.appendChild(s);

5) Wait for widget bubble, open it, and send EXACTLY this message ONCE:
"${scenario.userMessage}"
6) Wait up to 180 seconds for agent response.
   - If agent asks for explicit confirmation (for example: "Confirm?" / "Proceed?"), send exactly "Yes" once.
   - Immediately follow with this line once to avoid context loss:
     "Proceed now with this exact request: ${scenario.userMessage}"
   - Continue waiting up to 180 seconds total for the post-confirmation final response.
   - If post-confirmation response is generic/off-topic (for example starts over with a help menu), resend the original user message once and wait again.
7) If no response appears after 120 seconds (typing only), do ONE retry:
   - refresh page,
   - re-inject widget with a new cb query value,
   - send message once,
   - wait up to 180 seconds.
8) Capture exact response text shown in the widget.

Important:
- Avoid duplicate sends. Do not submit the same message twice in one attempt.
- If widget shows "Invalid agent token", set interaction_success=false with blocking_error.
- final_response_relevant must be true only when the final response clearly addresses this scenario intent.

Return ONLY valid JSON (no markdown):
{
  "scenario_name": "${scenario.name}",
  "user_message": "${scenario.userMessage}",
  "interaction_success": true,
  "hubspot_context_confirmed": true,
  "used_user_id": "${userId}",
  "final_response_observed": true,
  "final_response_relevant": true,
  "widget_response": "...",
  "notes": "...",
  "blocking_error": null
}

If blocked/failure, set interaction_success=false and include blocking_error.`;
}

function evalPrompt(
  scenario: Scenario,
  scenarioOutput: string,
  parsedReport: ScenarioReport | null
): string {
  return `You are an evaluator for a HubSpot product-agent scenario run via widget chat.

Scenario: ${scenario.name}
User message: ${scenario.userMessage}

Parsed executor report (if available):
${parsedReport ? JSON.stringify(parsedReport, null, 2) : "null"}

Raw executor output (tail):
${scenarioOutput.slice(-5000)}

Score strictly with these criteria:

1) correct_api_action (0 or 1)
2) ambiguity_handling (0 or 1)
3) error_handling (0 or 1)
4) response_quality (0 to 2)
5) data_accuracy (0 or 1)

Rules:
- If interaction failed, login wall blocked, widget did not load, or response timed out: all scores = 0, pass=false.
- If hubspot_context_confirmed is false: all scores = 0, pass=false.
- Ambiguous deal-stage requests should clarify before mutation.

Return ONLY JSON:
{
  "correct_api_action": { "score": 0, "reason": "..." },
  "ambiguity_handling": { "score": 0, "reason": "..." },
  "error_handling": { "score": 0, "reason": "..." },
  "response_quality": { "score": 0, "reason": "..." },
  "data_accuracy": { "score": 0, "reason": "..." },
  "total": 0,
  "pass": false
}

Pass threshold is ${PASS_THRESHOLD}/6.`;
}

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

interface SetupReport {
  setup_success: boolean;
  product_agent_name?: string;
  agent_slug?: string;
  embed_token?: string;
  dashboard_verification?: string;
  meta_response_excerpt?: string;
  notes?: string;
  blocking_error?: string | null;
}

interface ScenarioReport {
  scenario_name: string;
  user_message: string;
  interaction_success: boolean;
  hubspot_context_confirmed: boolean;
  used_user_id: string;
  final_response_observed?: boolean;
  final_response_relevant?: boolean;
  widget_response: string;
  notes?: string;
  blocking_error?: string | null;
}

interface EvalResult {
  correct_api_action: { score: number; reason: string };
  ambiguity_handling: { score: number; reason: string };
  error_handling: { score: number; reason: string };
  response_quality: { score: number; reason: string };
  data_accuracy: { score: number; reason: string };
  total: number;
  pass: boolean;
}

// ---------------------------------------------------------------------------
// Test
// ---------------------------------------------------------------------------

describe("HubSpot product-agent E2E", () => {
  test("meta-agent creation + HubSpot widget scenarios", async () => {
    console.log(`OpenCode API: ${OC_URL}`);
    console.log(`Main model: ${MAIN_MODEL.providerID}/${MAIN_MODEL.modelID}`);
    console.log(`Evaluator model: ${EVAL_MODEL.providerID}/${EVAL_MODEL.modelID}`);
    console.log(`Parent session: ${PARENT_SESSION}`);
    console.log(`Browser tool: ${BROWSER_TOOL}`);
    console.log(`Scenario selector: ${SCENARIO_SELECTOR}`);
    console.log(`HubSpot portal: ${HUBSPOT_PORTAL_ID}`);
    console.log(`HubSpot context URL: ${HUBSPOT_CONTEXT_URL}`);
    console.log(`HubSpot token: ${redact(HUBSPOT_TOKEN)}`);
    console.log(`Lamoom login: ${LAMOOM_EMAIL}`);
    console.log(`Requested agent: ${AGENT_NAME} (${AGENT_SLUG})`);
    console.log(`Scenarios: ${SCENARIOS.length}`);
    console.log(`Pass threshold: ${PASS_THRESHOLD}/6\n`);

    // --- Step 1: create product-agent via meta-agent ---
    const setupSession = await createSession("hubspot-setup: create product-agent");
    console.log(`Setup session: ${setupSession.id}`);

    await sendPromptAsync(setupSession.id, setupPrompt(), MAIN_MODEL);
    console.log("Setup prompt sent. Waiting...");

    const setupOutput = await waitForCompletion(setupSession.id, SETUP_TIMEOUT_MS);
    console.log(`Setup output tail:\n${setupOutput.slice(-1000)}\n`);

    let setup: SetupReport;
    try {
      setup = parseJsonFromOutput<SetupReport>(setupOutput);
    } catch (err) {
      throw new Error(`Failed to parse setup JSON: ${err instanceof Error ? err.message : String(err)}`);
    }

    const embedToken = setup.embed_token ?? extractEmbedToken(setupOutput);

    assert.ok(setup.setup_success, `Setup failed: ${setup.blocking_error ?? setup.notes ?? "unknown error"}`);
    const actualName = (setup.product_agent_name ?? "").toLowerCase();
    const expectedName = AGENT_NAME.toLowerCase();
    assert.ok(
      actualName.includes(expectedName) || expectedName.includes(actualName),
      `Setup created/verified unexpected agent name. Expected '${AGENT_NAME}', got '${setup.product_agent_name ?? "(missing)"}'`
    );
    const dashboardText = (setup.dashboard_verification ?? "").toLowerCase();
    assert.ok(
      dashboardText.includes("active"),
      `Setup did not verify active dashboard state: ${setup.dashboard_verification ?? "(missing)"}`
    );
    assert.ok(embedToken, "Setup succeeded but embed token was not found");
    assert.match(embedToken as string, UUID_RE, "Embed token is not a UUID-like value");

    console.log(`Setup PASS. Product-agent: ${setup.product_agent_name ?? "(unknown name)"}`);
    console.log(`Embed token: ${embedToken}`);
    console.log(`Dashboard verification: ${setup.dashboard_verification ?? "(not provided)"}\n`);

    // --- Step 2: run three required scenarios ---
    for (const scenario of SCENARIOS) {
      console.log(`=== Scenario: ${scenario.name} ===`);

      const userId = `e2e-${crypto.randomUUID()}`;

      const execSession = await createSession(`hubspot-exec: ${scenario.name}`);
      console.log(`  Executor session: ${execSession.id}`);

      await sendPromptAsync(
        execSession.id,
        scenarioPrompt(scenario, embedToken as string, userId, HUBSPOT_TOKEN),
        MAIN_MODEL,
      );
      console.log("  Executor prompt sent. Waiting...");

      const execOutput = await waitForCompletion(execSession.id, SCENARIO_TIMEOUT_MS);
      console.log(`  Executor output tail:\n${execOutput.slice(-900)}\n`);

      let report: ScenarioReport | null = null;
      try {
        report = parseJsonFromOutput<ScenarioReport>(execOutput);
      } catch {
        report = null;
      }

      assert.ok(report, `Scenario '${scenario.name}' executor did not return parseable JSON`);
      assert.ok(
        report!.interaction_success,
        `Scenario '${scenario.name}' interaction failed: ${report!.blocking_error ?? report!.notes ?? 'unknown failure'}`
      );
      assert.ok(
        report!.hubspot_context_confirmed,
        `Scenario '${scenario.name}' did not run in HubSpot context: ${report!.notes ?? 'missing context confirmation'}`
      );
      const finalObserved = report!.final_response_observed ?? true;
      assert.ok(
        finalObserved,
        `Scenario '${scenario.name}' did not produce a final post-confirmation response`
      );
      const finalRelevant = report!.final_response_relevant ?? true;
      assert.ok(
        finalRelevant,
        `Scenario '${scenario.name}' final response was off-topic or reset`
      );

      const evalAttempts = [
        { model: EVAL_MODEL, suffix: "" },
        ...(EVAL_MODEL.providerID !== MAIN_MODEL.providerID || EVAL_MODEL.modelID !== MAIN_MODEL.modelID
          ? [{ model: MAIN_MODEL, suffix: " (retry-main-model)" }]
          : []),
      ];

      let evalResult: EvalResult | null = null;
      let lastEvalOutput = "";
      let lastEvalError = "";

      for (const attempt of evalAttempts) {
        const evalSession = await createSession(`hubspot-eval: ${scenario.name}${attempt.suffix}`);
        console.log(
          `  Evaluator session: ${evalSession.id} (${attempt.model.providerID}/${attempt.model.modelID})`
        );

        await sendPromptAsync(evalSession.id, evalPrompt(scenario, execOutput, report), attempt.model);
        console.log("  Evaluator prompt sent. Waiting...");

        const evalOutput = await waitForCompletion(evalSession.id, EVAL_TIMEOUT_MS);
        lastEvalOutput = evalOutput;

        try {
          evalResult = parseJsonFromOutput<EvalResult>(evalOutput);
          break;
        } catch (err) {
          lastEvalError = err instanceof Error ? err.message : String(err);
          console.warn(`  Evaluator parse failed on ${attempt.model.modelID}: ${lastEvalError}`);
        }
      }

      if (!evalResult) {
        throw new Error(
          `Scenario '${scenario.name}' evaluator JSON parse failed after ${evalAttempts.length} attempt(s): ${lastEvalError}\n${lastEvalOutput.slice(-1000)}`
        );
      }

      console.log(`  Score: ${evalResult.total}/6 — ${evalResult.pass ? "PASS" : "FAIL"}`);
      console.log(`  Eval details: ${JSON.stringify(evalResult, null, 2)}\n`);

      assert.ok(
        evalResult.pass,
        `Scenario '${scenario.name}' failed with score ${evalResult.total}/6. Report: ${report ? JSON.stringify(report) : "no parsed executor JSON"}`
      );
      assert.ok(
        evalResult.total >= PASS_THRESHOLD,
        `Scenario '${scenario.name}' score ${evalResult.total} is below threshold ${PASS_THRESHOLD}`
      );
    }
  });
});
