export const DEFAULT_SETTINGS = {
  connected: false,
  owner: "",
  repo: "",
  branch: "",
  autoPush: true,
  includeReadme: true,
  includeStats: true,
  includeLink: true,
  includeNotes: true,
  includeReview: true,
  includeProfile: false,
  spacedRepetition: true,
  aiEnabled: false,
  aiConsent: false,
  commitTemplate: "solve: {number}. {title} ({difficulty})",
  theme: "system"
};

export const THEME_IDS = ["system", "light", "dark", "teal"];

export function normalizeTheme(value) {
  return THEME_IDS.includes(value) ? value : DEFAULT_SETTINGS.theme;
}

export const LANGUAGE_EXTENSIONS = {
  bash: "sh",
  c: "c",
  "c++": "cpp",
  cpp: "cpp",
  "c#": "cs",
  csharp: "cs",
  dart: "dart",
  elixir: "ex",
  erlang: "erl",
  go: "go",
  golang: "go",
  java: "java",
  javascript: "js",
  kotlin: "kt",
  mysql: "sql",
  php: "php",
  python: "py",
  python3: "py",
  racket: "rkt",
  ruby: "rb",
  rust: "rs",
  scala: "scala",
  swift: "swift",
  typescript: "ts"
};

export function slugify(value = "") {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "problem";
}

export function normalizeSubmission(input = {}) {
  const number = String(input.number || "0").replace(/\D/g, "") || "0";
  const title = String(input.title || "Untitled problem").trim();
  const language = String(input.language || "text").trim();
  return {
    id: `${number}-${slugify(title)}`,
    number,
    title,
    slug: slugify(input.slug || title),
    difficulty: ["Easy", "Medium", "Hard"].includes(input.difficulty) ? input.difficulty : "Unknown",
    language,
    extension: LANGUAGE_EXTENSIONS[language.toLowerCase()] || "txt",
    code: String(input.code || "").trimEnd(),
    runtime: String(input.runtime || "—"),
    memory: String(input.memory || "—"),
    status: input.status || "Accepted",
    url: input.url || "",
    problemContext: String(input.problemContext || "").trim().slice(0, 600),
    exampleInput: String(input.exampleInput || "").trim().slice(0, 1_000),
    exampleOutput: String(input.exampleOutput || "").trim().slice(0, 1_000),
    solvedAt: input.solvedAt || input.syncedAt || null,
    syncedAt: input.syncedAt || null,
    commitUrl: input.commitUrl || "",
    commitSha: input.commitSha || "",
    notes: String(input.notes || "").trim().slice(0, 4_000),
    review: input.review && typeof input.review === "object" ? input.review : null,
    reviewDueAt: input.reviewDueAt || null,
    lastReviewedAt: input.lastReviewedAt || null
  };
}

function compactText(value, maxLength) {
  return String(value || "")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

export function normalizeSolutionVisual(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const steps = Array.isArray(value.steps) ? value.steps.map((step) => {
    const label = Array.isArray(step) ? step[0] : step?.label;
    const state = Array.isArray(step) ? step[1] : step?.state;
    return { label: compactText(label, 80), state: compactText(state, 140) };
  }).filter((step) => step.label && step.state).slice(0, 4) : [];
  const visual = {
    context: compactText(value.context, 180),
    input: compactText(value.input, 160),
    invariant: compactText(value.invariant, 160),
    steps,
    result: compactText(value.result, 120)
  };
  return visual.input && visual.invariant && visual.steps.length >= 2 && visual.result ? visual : null;
}

const FALLBACK_VISUALS = {
  "Arrays & Hashing": {
    invariant: "The lookup state summarizes only items already processed.",
    steps: [["Read an item", "Inspect the current value"], ["Consult state", "Check or update the lookup structure"], ["Resolve", "Use the stored information to produce the answer"]]
  },
  "Two Pointers": {
    invariant: "Everything outside the pointers has already been resolved.",
    steps: [["Position pointers", "Start at the relevant boundaries"], ["Compare state", "Choose which pointer must move"], ["Narrow the search", "Repeat until the answer is determined"]]
  },
  "Sliding Window": {
    invariant: "The active window represents the current valid candidate.",
    steps: [["Expand", "Add the next item to the window"], ["Restore validity", "Move the left edge when needed"], ["Record progress", "Update the best valid result"]]
  },
  "Binary Search": {
    invariant: "Any valid answer remains inside the active search interval.",
    steps: [["Choose midpoint", "Inspect the middle candidate"], ["Compare", "Determine which half can be discarded"], ["Narrow interval", "Repeat on the remaining candidates"]]
  },
  "Graph Traversal": {
    invariant: "Visited nodes are processed once; the frontier holds discovered work.",
    steps: [["Seed frontier", "Add the starting node or nodes"], ["Visit", "Process one frontier node"], ["Discover neighbors", "Add unseen reachable nodes"]]
  },
  "Dynamic Programming": {
    invariant: "Each stored state summarizes an already solved subproblem.",
    steps: [["Initialize", "Record the base cases"], ["Transition", "Build a state from smaller solved states"], ["Finish", "Read the state representing the full problem"]]
  },
  Heap: {
    invariant: "The heap keeps the next best candidate at its root.",
    steps: [["Add candidates", "Push relevant values into the heap"], ["Select next", "Remove or inspect the root candidate"], ["Update", "Continue until the requested result is fixed"]]
  },
  Stack: {
    invariant: "The stack contains unresolved items in processing order.",
    steps: [["Read an item", "Compare it with the stack top"], ["Resolve", "Pop items whose answer is now known"], ["Preserve", "Push the current unresolved item"]]
  },
  "Union-Find": {
    invariant: "Each parent chain identifies one connected component.",
    steps: [["Initialize sets", "Start each item in its own component"], ["Connect", "Union items related by the current edge"], ["Query roots", "Compare representatives for the result"]]
  },
  Trie: {
    invariant: "The current trie path represents the processed prefix.",
    steps: [["Start at root", "Begin with an empty prefix"], ["Follow a symbol", "Reuse or create the next trie node"], ["Finish path", "Mark or inspect the completed prefix"]]
  }
};

function fallbackSolutionVisual(item, review = {}) {
  const pattern = (review.patterns || [])[0];
  const template = FALLBACK_VISUALS[pattern] || {
    invariant: "Each step preserves the information needed to compute the final result.",
    steps: [["Initialize", "Create the required working state"], ["Process", "Update state from the current input"], ["Return", "Produce the result from the completed state"]]
  };
  return {
    context: item.problemContext || `Solve ${item.number}. ${item.title}.`,
    input: item.exampleInput || "Problem input",
    invariant: template.invariant,
    steps: template.steps.map(([label, state]) => ({ label, state })),
    result: item.exampleOutput ? `Expected output: ${item.exampleOutput}` : "Computed result"
  };
}

function mermaidText(value) {
  return compactText(value, 180)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "'")
    .replace(/`/g, "'");
}

export function buildMermaidDiagram(submission, review = {}) {
  const item = normalizeSubmission(submission);
  const suppliedVisual = normalizeSolutionVisual(review.visual);
  const visual = suppliedVisual || fallbackSolutionVisual(item, review);
  const context = visual.context || item.problemContext || `Solve ${item.number}. ${item.title}.`;
  const nodes = [
    `  n0["Goal<br/>${mermaidText(context)}"]`,
    `  n1["Sample input<br/>${mermaidText(visual.input)}"]`,
    ...visual.steps.map((step, index) => `  n${index + 2}["Step ${index + 1}: ${mermaidText(step.label)}<br/>${mermaidText(step.state)}"]`),
    `  n${visual.steps.length + 2}["Sample output<br/>${mermaidText(visual.result)}"]`,
    `  inv["Invariant<br/>${mermaidText(visual.invariant)}"]`
  ];
  const path = Array.from({ length: visual.steps.length + 3 }, (_, index) => `n${index}`).join(" --> ");
  const invariantLinks = visual.steps.map((_, index) => `  inv -.-> n${index + 2}`);
  return ["flowchart TD", ...nodes, `  ${path}`, ...invariantLinks].join("\n");
}

export function folderFor(submission) {
  const item = normalizeSubmission(submission);
  return `${item.number.padStart(4, "0")}-${item.slug}`;
}

const LANGUAGE_FOLDERS = {
  sh: "bash",
  c: "c",
  cpp: "cpp",
  cs: "csharp",
  dart: "dart",
  ex: "elixir",
  erl: "erlang",
  go: "go",
  java: "java",
  js: "javascript",
  kt: "kotlin",
  sql: "sql",
  php: "php",
  py: "python",
  rkt: "racket",
  rb: "ruby",
  rs: "rust",
  scala: "scala",
  swift: "swift",
  ts: "typescript"
};

export function languageFolderFor(submission) {
  const item = normalizeSubmission(submission);
  return LANGUAGE_FOLDERS[item.extension] || slugify(item.language);
}

export function sameProblem(left, right) {
  const first = normalizeSubmission(left);
  const second = normalizeSubmission(right);
  if (first.number !== "0" && second.number !== "0") return first.number === second.number;
  return first.id === second.id;
}

export function isSubmissionPushReady(submission = {}) {
  return submission.pushReady === true
    && submission.status === "Accepted"
    && Boolean(String(submission.code || "").trimEnd());
}

export function formatSolvedAt(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

export function formatCommit(template, submission) {
  const item = normalizeSubmission(submission);
  return String(template || DEFAULT_SETTINGS.commitTemplate)
    .replaceAll("{number}", item.number)
    .replaceAll("{title}", item.title)
    .replaceAll("{difficulty}", item.difficulty)
    .replaceAll("{language}", item.language);
}

export function buildReview(submission) {
  const item = normalizeSubmission(submission);
  const text = item.code.toLowerCase();
  const patterns = [];
  if (/left|right|two.?pointer/.test(text)) patterns.push("Two Pointers");
  if (/while\s*\(?.*(left|right)|window|start.*end/.test(text)) patterns.push("Sliding Window");
  if (/heap|priorityqueue|priority_queue/.test(text)) patterns.push("Heap");
  if (/dfs|bfs|queue|visited/.test(text)) patterns.push("Graph Traversal");
  if (/memo|dp\[|cache/.test(text)) patterns.push("Dynamic Programming");
  if (/map|dict|set\(|unordered_/.test(text)) patterns.push("Arrays & Hashing");
  if (/stack|push\(|pop\(/.test(text)) patterns.push("Stack");
  if (/binary.?search|mid\s*=|\/\s*2/.test(text)) patterns.push("Binary Search");
  if (/union|find\(|parent\[|disjoint/.test(text)) patterns.push("Union-Find");
  if (/trie|children\[|prefix/.test(text)) patterns.push("Trie");
  if (!patterns.length) patterns.push("Problem-specific reasoning");
  return {
    patterns: [...new Set(patterns)].slice(0, 3),
    summary: `Use ${patterns[0].toLowerCase()} to organize the key decisions, then verify the invariants against an edge case.`,
    steps: [
      "State the direct approach and identify its bottleneck.",
      `Explain why ${patterns[0].toLowerCase()} fits the constraints.`,
      "Walk through one edge case and justify the final complexity."
    ]
  };
}

export function buildReadme(submission, settings = DEFAULT_SETTINGS, suppliedReview) {
  const item = normalizeSubmission(submission);
  const review = suppliedReview || buildReview(item);
  const lines = [`# ${item.number}. ${item.title}`, ""];
  if (settings.includeLink !== false && item.url) lines.push(`[View problem on LeetCode](${item.url})`, "");
  lines.push(`- **Difficulty:** ${item.difficulty}`, `- **Language:** ${item.language}`);
  const solvedAt = formatSolvedAt(item.solvedAt);
  if (solvedAt) lines.push(`- **Solved:** ${solvedAt}`);
  if (settings.includeStats !== false) lines.push(`- **Runtime:** ${item.runtime}`, `- **Memory:** ${item.memory}`);
  if (settings.includeReview !== false) {
    lines.push("", "## Interview overview", "", `**Patterns:** ${review.patterns.join(", ")}`, "");
    if (review.summary) lines.push(review.summary, "");
    lines.push("### Solution replay", "", "```mermaid", buildMermaidDiagram(item, review), "```", "");
    lines.push("### Approach", "");
    const steps = review.approach || review.steps || [];
    steps.forEach((step, index) => lines.push(`${index + 1}. ${step}`));
    if (review.complexity?.time && review.complexity?.space) {
      lines.push("", "### Complexity", "", `- **Time:** ${review.complexity.time}`, `- **Space:** ${review.complexity.space}`);
    }
    if (review.complexityCheck?.note) {
      lines.push("", "### Complexity self-check", "", `- **Verdict:** ${review.complexityCheck.verdict || "unclear"}`);
      if (review.complexityCheck.intended) lines.push(`- **Intended:** ${review.complexityCheck.intended}`);
      lines.push(`- ${review.complexityCheck.note}`);
    }
    if (review.edgeCases?.length) {
      lines.push("", "### Edge cases", "");
      review.edgeCases.forEach((edgeCase) => lines.push(`- ${edgeCase}`));
    }
    if (review.generatedBy) lines.push("", `_AI-generated with ${review.generatedBy}; verify the analysis before relying on it._`);
  }
  if (settings.includeNotes !== false && item.notes) lines.push("", "## Personal notes", "", item.notes);
  lines.push("", "---", "_Synced by [LeetRepo](https://github.com/)_");
  return lines.join("\n");
}

export function historyInsights(items = []) {
  const patterns = new Map();
  const languages = new Map();
  for (const input of items) {
    const item = normalizeSubmission(input);
    languages.set(item.language, (languages.get(item.language) || 0) + 1);
    const review = item.review || buildReview(item);
    for (const pattern of review.patterns || []) patterns.set(pattern, (patterns.get(pattern) || 0) + 1);
  }
  const sortCounts = (entries) => [...entries].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  return { patterns: sortCounts(patterns), languages: sortCounts(languages) };
}

export function buildProfileReadme(items = [], settings = {}) {
  const normalized = items.map(normalizeSubmission);
  const counts = Object.fromEntries(["Easy", "Medium", "Hard"].map((difficulty) => [difficulty, normalized.filter((item) => item.difficulty === difficulty).length]));
  const insights = historyInsights(normalized);
  const owner = settings.owner || "LeetRepo user";
  const repo = settings.repo || "leetcode-solutions";
  const recent = normalized
    .slice()
    .sort((a, b) => (Date.parse(b.syncedAt) || 0) - (Date.parse(a.syncedAt) || 0))
    .slice(0, 25);
  const lines = [
    `# ${owner} / ${repo}`,
    "",
    "Accepted LeetCode submissions, organized by problem and language and kept up to date by LeetRepo.",
    "",
    `**${normalized.length} solved** · ${counts.Easy} easy · ${counts.Medium} medium · ${counts.Hard} hard · ${insights.languages.length} languages`,
    "",
    "## Pattern coverage",
    "",
    insights.patterns.length ? insights.patterns.slice(0, 12).map(([pattern, count]) => `- ${pattern}: ${count}`).join("\n") : "Pattern data will appear after the first synced solution.",
    "",
    "## Recent solutions",
    "",
    "| # | Problem | Difficulty | Language |",
    "| -: | --- | --- | --- |",
    ...recent.map((item) => `| ${item.number} | [${item.title}](${item.url || `./${folderFor(item)}`}) | ${item.difficulty} | ${item.language} |`),
    "",
    "---",
    "_Profile generated by LeetRepo._"
  ];
  return lines.join("\n");
}

export function reviewDueAt(item, intervalDays = 30) {
  if (item.reviewDueAt) return new Date(item.reviewDueAt);
  const base = item.lastReviewedAt || item.syncedAt;
  if (!base) return null;
  const due = new Date(base);
  due.setUTCDate(due.getUTCDate() + intervalDays);
  return due;
}

export function dueForReview(items = [], now = new Date()) {
  return items
    .filter((item) => {
      const due = reviewDueAt(item);
      return due && due <= now;
    })
    .sort((a, b) => reviewDueAt(a) - reviewDueAt(b));
}

export function relativeTime(value, now = Date.now()) {
  if (!value) return "not yet";
  const seconds = Math.max(0, Math.round((now - new Date(value).getTime()) / 1000));
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 172800) return "yesterday";
  return `${Math.floor(seconds / 86400)}d ago`;
}

export function calculateStreak(items = [], now = new Date()) {
  const days = new Set(items.filter((x) => x.syncedAt).map((x) => new Date(x.syncedAt).toISOString().slice(0, 10)));
  let cursor = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const today = cursor.toISOString().slice(0, 10);
  if (!days.has(today)) cursor.setUTCDate(cursor.getUTCDate() - 1);
  let streak = 0;
  while (days.has(cursor.toISOString().slice(0, 10))) {
    streak += 1;
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  return streak;
}
