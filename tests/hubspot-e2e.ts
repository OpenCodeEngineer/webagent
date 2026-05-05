/**
 * HubSpot E2E Black-Box Test Harness
 *
 * Tests the Lamoom widget as an end user — types messages into the widget chat,
 * reads responses, and evaluates them with a scoring rubric.
 *
 * Usage:
 *   npx tsx tests/hubspot-e2e.ts --parent-session <session-id>
 *
 * Requires OpenCode server running.
 */

import { test, describe } from "node:test";
import assert from "node:assert";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const OC_URL = process.env.OPENCODE_URL ?? "http://100.108.64.76:4096";
const MODEL = {
  providerID: "github-copilot",
  modelID: process.env.OPENCODE_MODEL ?? "claude-opus-4.6",
};
const PARENT_SESSION =
  process.argv.find((_, i, a) => a[i - 1] === "--parent-session");

if (!PARENT_SESSION) {
  console.error("ERROR: --parent-session <id> is required.\n");
  console.error("Usage: npx tsx tests/hubspot-e2e.ts --parent-session <session-id>");
  process.exit(1);
}

const SCENARIO_TIMEOUT_MS = 10 * 60 * 1000; // 10 min per scenario
const EVAL_TIMEOUT_MS = 3 * 60 * 1000; // 3 min per eval
const POLL_INTERVAL_MS = 10_000;
const PASS_THRESHOLD = 5; // out of 6
const RUNS_PER_SCENARIO = 1; // set to 3 for full non-determinism testing

// Widget config
const WIDGET_EMBED_TOKEN = "0f8618d9-a78e-4624-916c-c7c666fb8bc2";
const WIDGET_URL = "https://dev.lamoom.com/widget.js";

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

async function createSession(title: string, parentID: string): Promise<Session> {
  return api<Session>("/session", {
    method: "POST",
    body: JSON.stringify({ title, parentID }),
  });
}

async function sendPromptAsync(
  sessionId: string,
  text: string
): Promise<void> {
  await fetch(`${OC_URL}/session/${sessionId}/prompt_async`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      parts: [{ type: "text", text }],
      model: MODEL,
    }),
  });
}

async function getSessionStatus(
  sessionId: string
): Promise<string | null> {
  const statuses = await api<Record<string, { type: string }>>(
    "/session/status"
  );
  const entry = statuses[sessionId];
  if (!entry) return null;
  return entry.type;
}

async function getMessages(
  sessionId: string,
  limit = 200
): Promise<Message[]> {
  return api<Message[]>(`/session/${sessionId}/message?limit=${limit}`);
}

async function getAllText(sessionId: string): Promise<string> {
  const msgs = await getMessages(sessionId);
  const texts: string[] = [];
  for (const msg of msgs) {
    if (msg.info.role !== "assistant" || !msg.parts) continue;
    for (const p of msg.parts) {
      if (p.type === "text" && p.text) texts.push(p.text);
    }
  }
  return texts.join("\n");
}

async function waitForCompletion(
  sessionId: string,
  timeoutMs: number
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    const status = await getSessionStatus(sessionId);
    if (status === null || status === "idle") {
      return getAllText(sessionId);
    }
    console.log(
      `  [${new Date().toISOString()}] ${sessionId} status: ${status}`
    );
  }
  throw new Error(`Session ${sessionId} timed out after ${timeoutMs / 1000}s`);
}

// ---------------------------------------------------------------------------
// Agent prompt — black-box widget interaction
// ---------------------------------------------------------------------------

function agentSystemPrompt(): string {
  return `\
You are a test automation agent. Your job is to interact with a Lamoom chat widget as an end user would, and report what happens.

## Setup

Use Playwright MCP (browser tools) to:
1. Navigate to https://example.com?cachebust=${Date.now()}
2. Inject the Lamoom widget by running this JavaScript in the page:
   \`\`\`javascript
   localStorage.removeItem('lamoom_uid');
   const s = document.createElement('script');
   s.src = '${WIDGET_URL}?cb=' + Date.now();
   s.setAttribute('data-agent-token', '${WIDGET_EMBED_TOKEN}');
   s.setAttribute('data-user-id', 'e2e-' + crypto.randomUUID());
   document.body.appendChild(s);
   \`\`\`
3. Wait 3 seconds for the widget to load
4. Click the widget bubble to open the chat panel
5. Type the user message (provided below) into the chat input
6. Send the message (press Enter or click send)
7. Wait up to 180 seconds for the agent to respond
8. Read and report the widget's response

## Important

- Do NOT call the HubSpot API directly — you are testing the widget as a black box
- If the widget doesn't load, report that as the result
- If the widget times out, report that
- Take a snapshot after the response appears to capture the exact text
- After capturing the response, close the browser tab to clean up

## Output format

When done, output a structured report:

\`\`\`
USER_MESSAGE: <what you typed>
WIDGET_RESPONSE: <the exact text the widget showed>
INTERACTION_SUCCESS: true/false
NOTES: <any issues encountered>
\`\`\`
`;
}

// ---------------------------------------------------------------------------
// Evaluator prompt template
// ---------------------------------------------------------------------------

function evalPrompt(
  userMessage: string,
  agentOutput: string
): string {
  return `\
You are an evaluator for an AI agent that performs CRM actions inside HubSpot, accessed through a chat widget.

The user typed a message into the chat widget and received a response. You must evaluate whether the response was appropriate.

**User message:** ${userMessage}

**Full session log (agent interacting with widget):**
${agentOutput.slice(-4000)}

Score the agent on each of the following criteria. Return ONLY a JSON object with scores and a short reason for each.

**Criteria:**

1. **Correct API action** (0 or 1)
Did the widget/agent perform the right CRM action for the user's intent? (e.g., created a contact when asked to create, searched when asked to find). If the widget response indicates the right action was taken, score 1.

2. **Correct handling of ambiguity** (0 or 1)
If the request was ambiguous (e.g. multiple matching records, unclear deal name), did the agent ask for clarification instead of guessing? If the request was unambiguous, score 1.

3. **Error handling** (0 or 1)
If the operation failed or an error occurred, did the agent explain it clearly and offer a next step? If no error occurred, score 1.

4. **Response quality** (0-2)
Was the widget's response clear, concise, and free of raw JSON or technical jargon? 2 = excellent, 1 = acceptable, 0 = confusing or exposes internals.

5. **Data accuracy** (0 or 1)
Does the response contain plausible and consistent information? No obvious hallucinations or contradictions.

**Special case:** If the widget failed to load or timed out, score ALL criteria as 0 and set pass=false.

Return ONLY this JSON:
{
  "correct_api_action": { "score": 0_or_1, "reason": "..." },
  "ambiguity_handling": { "score": 0_or_1, "reason": "..." },
  "error_handling": { "score": 0_or_1, "reason": "..." },
  "response_quality": { "score": 0_to_2, "reason": "..." },
  "data_accuracy": { "score": 0_or_1, "reason": "..." },
  "total": X,
  "pass": true_or_false
}

Pass threshold: ${PASS_THRESHOLD} out of 6.
`;
}

// ---------------------------------------------------------------------------
// Test scenarios
// ---------------------------------------------------------------------------

interface Scenario {
  name: string;
  userMessage: string;
}

const SCENARIOS: Scenario[] = [
  {
    name: "Create a contact",
    userMessage:
      "Create a new contact: first name Sarah, last name Connor, email sarah.connor@skynet.com",
  },
  {
    name: "Search and list contacts",
    userMessage:
      "Find all contacts with the last name Connor and show me their details",
  },
  {
    name: "Handle ambiguity — update deal stage",
    userMessage:
      "Move the Skynet deal to the next stage",
  },
  {
    name: "Handle error — invalid object type",
    userMessage:
      "Create a new spaceship object with name Enterprise",
  },
  {
    name: "Missing required field — ask follow-up",
    userMessage:
      "Create a new deal",
  },
];

// ---------------------------------------------------------------------------
// Parse eval JSON from agent output
// ---------------------------------------------------------------------------

interface EvalResult {
  correct_api_action: { score: number; reason: string };
  ambiguity_handling: { score: number; reason: string };
  error_handling: { score: number; reason: string };
  response_quality: { score: number; reason: string };
  data_accuracy: { score: number; reason: string };
  total: number;
  pass: boolean;
}

function parseEvalResult(output: string): EvalResult {
  const jsonMatch = output.match(/\{[\s\S]*"total"[\s\S]*"pass"[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error(`No eval JSON found in output:\n${output.slice(-500)}`);
  }
  return JSON.parse(jsonMatch[0]);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("hubspot crm agent — widget black-box", () => {
  console.log(`OpenCode API: ${OC_URL}`);
  console.log(`Model: ${MODEL.providerID}/${MODEL.modelID}`);
  console.log(`Parent session: ${PARENT_SESSION}`);
  console.log(`Widget token: ${WIDGET_EMBED_TOKEN}`);
  console.log(`Runs per scenario: ${RUNS_PER_SCENARIO}`);
  console.log(`Pass threshold: ${PASS_THRESHOLD}/6\n`);

  for (const scenario of SCENARIOS) {
    test(`scenario: ${scenario.name}`, async () => {
      console.log(`\n=== Scenario: ${scenario.name} ===`);

      const scores: number[] = [];

      for (let run = 1; run <= RUNS_PER_SCENARIO; run++) {
        if (RUNS_PER_SCENARIO > 1) console.log(`  --- Run ${run}/${RUNS_PER_SCENARIO} ---`);

        // --- Step 1: Run the agent (interact with widget) ---
        const agentSession = await createSession(
          `widget-test: ${scenario.name}${RUNS_PER_SCENARIO > 1 ? ` (run ${run})` : ""}`,
          PARENT_SESSION!
        );
        console.log(`  Agent session: ${agentSession.id}`);

        const agentPrompt = `${agentSystemPrompt()}\n\n## User message to type into widget:\n${scenario.userMessage}`;
        await sendPromptAsync(agentSession.id, agentPrompt);
        console.log("  Agent prompt sent. Waiting...");

        const agentOutput = await waitForCompletion(
          agentSession.id,
          SCENARIO_TIMEOUT_MS
        );
        console.log(
          `  Agent finished. Output tail:\n${agentOutput.slice(-500)}\n`
        );

        // --- Step 2: Evaluate ---
        const evalSession = await createSession(
          `widget-eval: ${scenario.name}${RUNS_PER_SCENARIO > 1 ? ` (run ${run})` : ""}`,
          PARENT_SESSION!
        );
        console.log(`  Evaluator session: ${evalSession.id}`);

        await sendPromptAsync(
          evalSession.id,
          evalPrompt(scenario.userMessage, agentOutput)
        );
        console.log("  Evaluator prompt sent. Waiting...");

        const evalOutput = await waitForCompletion(
          evalSession.id,
          EVAL_TIMEOUT_MS
        );

        // --- Step 3: Parse score ---
        const result = parseEvalResult(evalOutput);
        scores.push(result.total);
        console.log(`  Run ${run} score: ${result.total}/6 — ${result.pass ? "PASS" : "FAIL"}`);
        console.log(`  Reasons:`, JSON.stringify(result, null, 2));
      }

      // Average scores across runs
      const avgScore = scores.reduce((a, b) => a + b, 0) / scores.length;
      console.log(
        `\n  Average score: ${avgScore.toFixed(1)}/6 — ${avgScore >= PASS_THRESHOLD ? "PASS" : "FAIL"}`
      );

      assert.ok(
        avgScore >= PASS_THRESHOLD,
        `Scenario "${scenario.name}" failed (avg ${avgScore.toFixed(1)}/${PASS_THRESHOLD} needed). Scores: [${scores.join(", ")}]`
      );
    });
  }
});
