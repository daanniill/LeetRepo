import test from "node:test";
import assert from "node:assert/strict";

await import("../src/content/language.js");
await import("../src/content/problem.js");
await import("../src/content/attempt.js");

const { detectLanguage, normalizeLanguage } = globalThis.LeetRepoLanguage;
const { getProblemDetails, getProblemIdentity, getProblemTags, parseProblemText } = globalThis.LeetRepoProblem;
const { beginAttempt, finishAttempt } = globalThis.LeetRepoAttempt;

function rootWith({ mode = null, labels = [] } = {}) {
  return {
    querySelector() {
      return mode === null ? null : { getAttribute: () => mode };
    },
    querySelectorAll() {
      return labels.map((textContent) => ({ textContent }));
    }
  };
}

test("attempt capture requires a submit event and keeps the submitted code snapshot", () => {
  const submitted = { number: "1", code: "return first", language: "Python3", runtime: "—", memory: "—" };
  const pending = beginAttempt(submitted, 1_000);
  const attempt = finishAttempt(pending, "Wrong Answer", { code: "return edited", runtime: "4 ms", memory: "10 MB" });

  assert.equal(finishAttempt(null, "Wrong Answer", { code: "return edited" }), null);
  assert.deepEqual(attempt, { ...submitted, status: "Wrong Answer", runtime: "4 ms", memory: "10 MB" });
});

test("language detection reads the current LeetCode editor mode", () => {
  assert.equal(detectLanguage(rootWith({ mode: "cpp" })), "C++");
  assert.equal(detectLanguage(rootWith({ mode: "python3" })), "Python3");
  assert.equal(detectLanguage(rootWith({ mode: "csharp" })), "C#");
});

test("language detection falls back to the editor toolbar label", () => {
  assert.equal(detectLanguage(rootWith({ labels: ["Auto", "  TypeScript  "] })), "TypeScript");
});

test("language normalization covers LeetCode mode aliases", () => {
  assert.equal(normalizeLanguage("golang"), "Go");
  assert.equal(normalizeLanguage("C++"), "C++");
  assert.equal(detectLanguage(rootWith()), "Code");
});

test("problem identity reads the current LeetCode problem link", () => {
  const root = {
    title: "Two Sum - LeetCode",
    querySelector(selector) {
      return selector === 'a[href="/problems/two-sum/"]' ? { textContent: "1. Two Sum" } : null;
    }
  };

  assert.deepEqual(getProblemIdentity(root, { pathname: "/problems/two-sum/description/" }), {
    number: "1",
    title: "Two Sum",
    slug: "two-sum"
  });
});

test("problem identity retains the legacy title fallback", () => {
  const root = { title: "42. Trapping Rain Water - LeetCode", querySelector: () => null };

  assert.deepEqual(getProblemIdentity(root, { pathname: "/problems/trapping-rain-water/" }), {
    number: "42",
    title: "Trapping Rain Water",
    slug: "trapping-rain-water"
  });
});

test("problem tags come from LeetCode topic links without duplicates", () => {
  const links = [
    { textContent: " Array " },
    { textContent: "Hash   Table" },
    { textContent: "Array" }
  ];
  const root = { querySelectorAll: () => links };

  assert.deepEqual(getProblemTags(root), ["Array", "Hash Table"]);
});

test("problem details parse official examples, constraints, and follow-up without AI", () => {
  const details = parseProblemText(`
Given an array of integers nums and an integer target, return the two indices.
Exactly one valid answer exists.

Example 1:
Input: nums = [2,7,11,15], target = 9
Output: [0,1]
Explanation: nums[0] + nums[1] equals 9.

Example 2:
Input: nums = [3,3], target = 6
Output: [0,1]

Constraints:
- 2 <= nums.length <= 10^4
- Only one valid answer exists.

Follow-up:
Can you design an algorithm faster than O(n^2)?
`);

  assert.equal(details.problemDescription, "Given an array of integers nums and an integer target, return the two indices.\nExactly one valid answer exists.");
  assert.deepEqual(details.examples, [
    { input: "nums = [2,7,11,15], target = 9", output: "[0,1]", explanation: "nums[0] + nums[1] equals 9." },
    { input: "nums = [3,3], target = 6", output: "[0,1]", explanation: "" }
  ]);
  assert.deepEqual(details.constraints, ["2 <= nums.length <= 10^4", "Only one valid answer exists."]);
  assert.equal(details.followUp, "Can you design an algorithm faster than O(n^2)?");
});

test("problem details include visible official hints and ignore hint controls", () => {
  const description = { innerText: "Return the requested value.\nConstraints:\n1 <= n <= 10", textContent: "" };
  const root = {
    querySelector(selector) {
      return selector === '[data-track-load="description_content"]' ? description : null;
    },
    querySelectorAll() {
      return [
        { textContent: "Show Hint", children: [] },
        { textContent: "Hint 1: Track values already seen.", children: [] },
        { textContent: "Hint 1: Track values already seen.", children: [] }
      ];
    }
  };

  assert.deepEqual(getProblemDetails(root).hints, ["Track values already seen."]);
});
