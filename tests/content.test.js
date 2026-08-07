import test from "node:test";
import assert from "node:assert/strict";

await import("../src/content/language.js");

const { detectLanguage, normalizeLanguage } = globalThis.LeetRepoLanguage;

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
