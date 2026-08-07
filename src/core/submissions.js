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
  aiModel: "llama-3.3-70b-versatile",
  aiDailyLimit: 20,
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
    syncedAt: input.syncedAt || null,
    commitUrl: input.commitUrl || "",
    commitSha: input.commitSha || "",
    notes: String(input.notes || "").trim().slice(0, 4_000),
    review: input.review && typeof input.review === "object" ? input.review : null,
    reviewDueAt: input.reviewDueAt || null,
    lastReviewedAt: input.lastReviewedAt || null
  };
}

export function folderFor(submission) {
  const item = normalizeSubmission(submission);
  return `${item.number.padStart(4, "0")}-${item.slug}`;
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
  if (settings.includeStats !== false) lines.push(`- **Runtime:** ${item.runtime}`, `- **Memory:** ${item.memory}`);
  if (settings.includeReview !== false) {
    lines.push("", "## Interview overview", "", `**Patterns:** ${review.patterns.join(", ")}`, "");
    if (review.summary) lines.push(review.summary, "");
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
    "Accepted LeetCode submissions, organized one folder per problem and kept up to date by LeetRepo.",
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
