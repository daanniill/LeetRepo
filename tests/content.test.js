import test from "node:test";
import assert from "node:assert/strict";

await import("../src/content/language.js");
await import("../src/content/problem.js");

const { detectLanguage, normalizeLanguage } = globalThis.LeetRepoLanguage;
const { getProblemIdentity, getProblemTags } = globalThis.LeetRepoProblem;

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
