/**
 * tinyfish.js — minimal TinyFish Web Agent client.
 *
 * Uses the streaming endpoint so we can show the agent's live progress in the UI:
 *   POST https://agent.tinyfish.ai/v1/automation/run-sse
 *   Header: X-API-Key: <TINYFISH_API_KEY>
 *   Body:   { url, goal }
 * Events:  STARTED · STREAMING_URL · PROGRESS · HEARTBEAT · COMPLETE
 * Docs:    https://docs.tinyfish.ai/agent-api
 */

const BASE = process.env.TINYFISH_BASE_URL || "https://agent.tinyfish.ai";

function isConfigured() {
  return Boolean(process.env.TINYFISH_API_KEY);
}

/**
 * Run one TinyFish agent and resolve with its final result.
 * @param {object} opts
 * @param {string} opts.url   Page the agent starts on
 * @param {string} opts.goal  Natural-language instruction
 * @param {(evt:object)=>void} [opts.onEvent] Called for every SSE event
 * @param {number} [opts.timeoutMs]
 */
async function runAgent({ url, goal, onEvent = () => {}, timeoutMs }) {
  const key = process.env.TINYFISH_API_KEY;
  if (!key) throw new Error("TINYFISH_API_KEY is not set (add it to .env)");

  const timeout = timeoutMs || Number(process.env.TINYFISH_TIMEOUT_SECONDS || 240) * 1000;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  let runId = null;

  try {
    const res = await fetch(`${BASE}/v1/automation/run-sse`, {
      method: "POST",
      headers: {
        "X-API-Key": key,
        "Content-Type": "application/json",
        Accept: "text/event-stream",
      },
      body: JSON.stringify({ url, goal }),
      signal: ctrl.signal,
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`TinyFish HTTP ${res.status}: ${body.slice(0, 300)}`);
    }

    const decoder = new TextDecoder();
    let buffer = "";
    let final = null;

    for await (const chunk of res.body) {
      buffer += decoder.decode(chunk, { stream: true });
      let idx;
      while ((idx = buffer.search(/\r?\n\r?\n/)) !== -1) {
        const raw = buffer.slice(0, idx);
        buffer = buffer.slice(idx).replace(/^\r?\n\r?\n/, "");
        const evt = parseSSEBlock(raw);
        if (!evt) continue;
        if (evt.run_id) runId = evt.run_id;
        onEvent(evt);
        if (evt.type === "COMPLETE") final = evt;
      }
    }
    // flush a trailing event without a blank line
    if (!final && buffer.trim()) {
      const evt = parseSSEBlock(buffer);
      if (evt) { onEvent(evt); if (evt.type === "COMPLETE") final = evt; }
    }

    if (!final) throw new Error("TinyFish stream ended without a COMPLETE event");
    if (final.status && final.status !== "COMPLETED") {
      const msg = final.error?.message || final.error || final.status;
      throw new Error(`TinyFish run ${final.status}: ${typeof msg === "string" ? msg : JSON.stringify(msg)}`);
    }
    return { runId, result: normalizeResult(final.result) };
  } catch (err) {
    if (err.name === "AbortError") {
      if (runId) cancelRun(runId).catch(() => {});
      throw new Error(`TinyFish run timed out after ${Math.round(timeout / 1000)}s`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function parseSSEBlock(block) {
  const data = block
    .split(/\r?\n/)
    .filter(l => l.startsWith("data:"))
    .map(l => l.slice(5).trimStart())
    .join("\n");
  if (!data) return null;
  try { return JSON.parse(data); } catch { return null; }
}

/** TinyFish puts JSON objects in `result`, and lists/plain text in `result.result`. */
function normalizeResult(result) {
  let r = result;
  if (r && typeof r === "object" && !Array.isArray(r) && "result" in r && Object.keys(r).length <= 2) r = r.result;
  if (typeof r === "string") {
    const m = r.match(/```(?:json)?\s*([\s\S]*?)```/) || r.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
    if (m) { try { return JSON.parse(m[1]); } catch { /* fall through */ } }
  }
  return r;
}

async function cancelRun(runId) {
  await fetch(`${BASE}/v1/runs/${encodeURIComponent(runId)}/cancel`, {
    method: "POST",
    headers: { "X-API-Key": process.env.TINYFISH_API_KEY },
  });
}

module.exports = { runAgent, isConfigured, normalizeResult, parseSSEBlock };
