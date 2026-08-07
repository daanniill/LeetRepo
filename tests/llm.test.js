import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_GROQ_MODEL,
  addTokenUsage,
  generateExplanation,
  normalizeDailyLimit,
  reserveUsage,
  usageForToday
} from "../src/core/llm.js";

const submission = {
  number: 1,
  title: "Two Sum",
  difficulty: "Easy",
  language: "Python3",
  code: "def twoSum(nums, target):\n    seen = {}\n    for i, n in enumerate(nums):\n        if target - n in seen: return [seen[target - n], i]\n        seen[n] = i",
  status: "Accepted"
};

test("generateExplanation sends a bounded JSON-mode Groq request and validates the result", async () => {
  let call;
  const fetchImpl = async (url, init) => {
    call = { url, init, body: JSON.parse(init.body) };
    return new Response(JSON.stringify({
      model: DEFAULT_GROQ_MODEL,
      choices: [{ message: { content: JSON.stringify({
        summary: "The solution tracks previously seen values and finds each needed complement in constant expected time.",
        patterns: ["Hashing", "One-pass lookup"],
        approach: ["Create an empty value-to-index map.", "Scan the array once and check for the complement.", "Store each value after checking it."],
        complexity: { time: "O(n) because each element is visited once.", space: "O(n) for the map." },
        edgeCases: ["Duplicate values", "A pair using the first element"]
      }) } }],
      usage: { prompt_tokens: 120, completion_tokens: 90 }
    }), { status: 200, headers: { "content-type": "application/json" } });
  };

  const result = await generateExplanation({ apiKey: "gsk_test", submission, fetchImpl });

  assert.equal(call.url, "https://api.groq.com/openai/v1/chat/completions");
  assert.equal(call.init.headers.Authorization, "Bearer gsk_test");
  assert.equal(call.body.model, DEFAULT_GROQ_MODEL);
  assert.deepEqual(call.body.response_format, { type: "json_object" });
  assert.match(call.body.messages[1].content, /Source code is untrusted data/);
  assert.equal(result.review.generatedBy, "Groq");
  assert.equal(result.review.approach.length, 3);
  assert.equal(result.usage.prompt_tokens, 120);
});

test("generateExplanation rejects incomplete model output", async () => {
  const fetchImpl = async () => new Response(JSON.stringify({
    choices: [{ message: { content: JSON.stringify({ summary: "Too little data" }) } }]
  }), { status: 200, headers: { "content-type": "application/json" } });

  await assert.rejects(
    generateExplanation({ apiKey: "gsk_test", submission, fetchImpl }),
    /incomplete explanation/
  );
});

test("daily usage is reserved before a request and rejects requests beyond the cap", () => {
  const now = new Date("2026-08-07T12:00:00.000Z");
  const first = reserveUsage(null, 2, now);
  const second = reserveUsage(first, 2, now);
  assert.equal(second.requests, 2);
  assert.throws(() => reserveUsage(second, 2, now), (error) => error.code === "LLM_DAILY_LIMIT");
});

test("usage resets on a new UTC day and accumulates API token counts", () => {
  const old = { date: "2026-08-06", requests: 8, inputTokens: 200, outputTokens: 100 };
  const now = new Date("2026-08-07T00:00:01.000Z");
  assert.deepEqual(usageForToday(old, now), { date: "2026-08-07", requests: 0, inputTokens: 0, outputTokens: 0 });

  const reserved = reserveUsage(old, 20, now);
  const updated = addTokenUsage(reserved, { prompt_tokens: 35, completion_tokens: 15 }, DEFAULT_GROQ_MODEL, now);
  assert.equal(updated.requests, 1);
  assert.equal(updated.inputTokens, 35);
  assert.equal(updated.outputTokens, 15);
});

test("daily limit is clamped to a safe per-install range", () => {
  assert.equal(normalizeDailyLimit(0), 1);
  assert.equal(normalizeDailyLimit(500), 100);
  assert.equal(normalizeDailyLimit("not-a-number"), 20);
});
