export const DEFAULT_SETTINGS = {
  connected: false,
  owner: "",
  repo: "",
  branch: "",
  autoPush: true,
  includeReadme: true,
  includeStats: true,
  includeLink: true,
  includeReview: true,
  commitTemplate: "solve: {number}. {title} ({difficulty})",
  theme: "system"
};

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
    syncedAt: input.syncedAt || null
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
  if (/heap|priorityqueue|priority_queue/.test(text)) patterns.push("Heap");
  if (/dfs|bfs|queue|visited/.test(text)) patterns.push("Graph Traversal");
  if (/memo|dp\[|cache/.test(text)) patterns.push("Dynamic Programming");
  if (/map|dict|set\(|unordered_/.test(text)) patterns.push("Hashing");
  if (!patterns.length) patterns.push("Problem-specific reasoning");
  return {
    patterns: [...new Set(patterns)].slice(0, 3),
    steps: [
      "State the direct approach and identify its bottleneck.",
      `Explain why ${patterns[0].toLowerCase()} fits the constraints.`,
      "Walk through one edge case and justify the final complexity."
    ]
  };
}

export function buildReadme(submission, settings = DEFAULT_SETTINGS) {
  const item = normalizeSubmission(submission);
  const review = buildReview(item);
  const lines = [`# ${item.number}. ${item.title}`, ""];
  if (settings.includeLink !== false && item.url) lines.push(`[View problem on LeetCode](${item.url})`, "");
  lines.push(`- **Difficulty:** ${item.difficulty}`, `- **Language:** ${item.language}`);
  if (settings.includeStats !== false) lines.push(`- **Runtime:** ${item.runtime}`, `- **Memory:** ${item.memory}`);
  if (settings.includeReview !== false) {
    lines.push("", "## Interview overview", "", `**Patterns:** ${review.patterns.join(", ")}`, "");
    review.steps.forEach((step, index) => lines.push(`${index + 1}. ${step}`));
  }
  lines.push("", "---", "_Synced by [LeetRepo](https://github.com/)_");
  return lines.join("\n");
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
