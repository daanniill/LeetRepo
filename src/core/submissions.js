import { DEFAULT_DAILY_STUDY_LIMIT, MAX_REVIEW_EVENTS, REVIEW_RATINGS } from "./study.js";

export { dueForReview, reviewDueAt } from "./study.js";

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
  includeProfile: false,
  spacedRepetition: true,
  studyIntervalValue: 30,
  studyIntervalUnit: "days",
  dailyStudyLimit: DEFAULT_DAILY_STUDY_LIMIT,
  aiEnabled: false,
  aiConsent: false,
  commitTemplate: "solve: {number}. {title} ({difficulty})",
  theme: "system"
};

export const THEME_IDS = ["system", "light", "dark", "teal"];
export const MAX_AI_CODE_CHARACTERS = 24_000;

export function normalizeTheme(value) {
  return THEME_IDS.includes(value) ? value : DEFAULT_SETTINGS.theme;
}

export function aiLimitReached(usage = {}) {
  return [usage.daily, usage.monthly].some((period = {}) => {
    const requests = Number(period.requests);
    const limit = Number(period.limit);
    return Number.isFinite(requests) && Number.isFinite(limit) && limit >= 0 && requests >= limit;
  });
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

function boundedText(value, maxLength) {
  return String(value || "").replace(/\r/g, "").trim().slice(0, maxLength);
}

function boundedList(value, maxItems, maxLength) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => boundedText(item, maxLength)).filter(Boolean))].slice(0, maxItems);
}

function normalizeProblemExamples(value) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((example) => {
    if (!example || typeof example !== "object" || Array.isArray(example)) return [];
    const input = boundedText(example.input, 1_500);
    const output = boundedText(example.output, 1_500);
    if (!input || !output) return [];
    return [{ input, output, explanation: boundedText(example.explanation, 1_500) }];
  }).slice(0, 4);
}

function normalizeReviewEvents(value) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((event) => {
    if (!event || typeof event !== "object") return [];
    const ratedAt = new Date(event.ratedAt);
    if (Number.isNaN(ratedAt.getTime())) return [];
    if (!REVIEW_RATINGS.includes(event.rating)) return [];
    const intervalDaysAfter = Number(event.intervalDaysAfter);
    if (!Number.isFinite(intervalDaysAfter) || intervalDaysAfter <= 0) return [];
    return [{
      ratedAt: ratedAt.toISOString(),
      rating: event.rating,
      intervalDaysAfter: Math.floor(intervalDaysAfter),
      recall: boundedText(event.recall, 2_000)
    }];
  }).slice(-MAX_REVIEW_EVENTS);
}

export function normalizeSubmission(input = {}) {
  const number = String(input.number || "0").replace(/\D/g, "") || "0";
  const title = String(input.title || "Untitled problem").trim();
  const language = String(input.language || "text").trim();
  const tags = Array.isArray(input.tags)
    ? [...new Set(input.tags.map((tag) => String(tag || "").replace(/\s+/g, " ").trim()).filter(Boolean))].slice(0, 20)
    : [];
  const problemDescription = boundedText(input.problemDescription || input.problemContext, 5_000);
  const examples = normalizeProblemExamples(input.examples);
  const firstExample = examples[0] || {};
  const item = {
    id: `${number}-${slugify(title)}`,
    number,
    title,
    slug: slugify(input.slug || title),
    difficulty: ["Easy", "Medium", "Hard"].includes(input.difficulty) ? input.difficulty : "Unknown",
    tags,
    language,
    extension: LANGUAGE_EXTENSIONS[language.toLowerCase()] || "txt",
    path: String(input.path || "").trim(),
    code: String(input.code || "").trimEnd(),
    runtime: String(input.runtime || "—"),
    memory: String(input.memory || "—"),
    status: input.status || "Accepted",
    url: input.url || "",
    problemDescription,
    problemContext: boundedText(input.problemContext || problemDescription, 1_200),
    examples,
    exampleInput: boundedText(input.exampleInput || firstExample.input, 1_500),
    exampleOutput: boundedText(input.exampleOutput || firstExample.output, 1_500),
    constraints: boundedList(input.constraints, 30, 500),
    hints: boundedList(input.hints, 6, 1_000),
    followUp: boundedText(input.followUp, 1_500),
    solvedAt: input.solvedAt || input.syncedAt || null,
    syncedAt: input.syncedAt || null,
    commitUrl: input.commitUrl || "",
    commitSha: input.commitSha || "",
    notes: String(input.notes || "").trim().slice(0, 4_000),
    review: input.review && typeof input.review === "object" ? input.review : null,
    reviewDueAt: input.reviewDueAt || null,
    lastReviewedAt: input.lastReviewedAt || null,
    reviewIntervalDays: Number.isFinite(Number(input.reviewIntervalDays)) && Number(input.reviewIntervalDays) > 0 ? Math.floor(Number(input.reviewIntervalDays)) : null,
    reviewCount: Number.isFinite(Number(input.reviewCount)) && Number(input.reviewCount) >= 0 ? Math.floor(Number(input.reviewCount)) : 0,
    reviewLapses: Number.isFinite(Number(input.reviewLapses)) && Number(input.reviewLapses) >= 0 ? Math.floor(Number(input.reviewLapses)) : 0,
    lastReviewRating: ["again", "hard", "good"].includes(input.lastReviewRating) ? input.lastReviewRating : null,
    reviewEvents: normalizeReviewEvents(input.reviewEvents)
  };
  item.solutions = Array.isArray(input.solutions)
    ? input.solutions.map((solution) => normalizeSolution(solution, item))
    : [];
  return item;
}

export function aiSubmissionPayload(input = {}) {
  const item = normalizeSubmission(input);
  return {
    number: item.number,
    title: item.title,
    difficulty: item.difficulty,
    tags: item.tags.slice(0, 8),
    language: item.language,
    code: item.code.slice(0, MAX_AI_CODE_CHARACTERS),
    problemDescription: item.problemDescription.slice(0, 1_400),
    problemContext: item.problemContext,
    examples: item.examples.slice(0, 1),
    exampleInput: item.exampleInput,
    exampleOutput: item.exampleOutput,
    constraints: item.constraints.slice(0, 12),
    followUp: item.followUp.slice(0, 500),
    status: item.status
  };
}

function normalizeSolution(input = {}, fallback = {}) {
  const language = String(input.language || fallback.language || "text").trim();
  const extension = String(input.extension || LANGUAGE_EXTENSIONS[language.toLowerCase()] || fallback.extension || "txt").toLowerCase();
  const path = String(input.path || "").trim();
  return {
    key: String(input.key || `${language.toLowerCase()}:${extension}`),
    path,
    language,
    extension,
    difficulty: ["Easy", "Medium", "Hard"].includes(input.difficulty) ? input.difficulty : fallback.difficulty || "Unknown",
    code: String(input.code || "").trimEnd(),
    runtime: String(input.runtime || "—"),
    memory: String(input.memory || "—"),
    status: input.status || "Accepted",
    solvedAt: input.solvedAt || input.syncedAt || null,
    syncedAt: input.syncedAt || null,
    commitUrl: input.commitUrl || "",
    commitSha: input.commitSha || "",
    review: input.review && typeof input.review === "object" ? input.review : null
  };
}

function mergeReviewEvents(previous = [], update = []) {
  const merged = new Map();
  for (const event of [...previous, ...update]) {
    merged.set(`${event.ratedAt}:${event.rating}`, event);
  }
  return [...merged.values()]
    .sort((left, right) => Date.parse(left.ratedAt) - Date.parse(right.ratedAt))
    .slice(-MAX_REVIEW_EVENTS);
}

function mergeSolution(left, right) {
  const next = { ...left };
  for (const [key, value] of Object.entries(right)) {
    if (value !== "" && value !== null && value !== "—") next[key] = value;
  }
  return next;
}

export function submissionSolutions(input = {}) {
  const item = normalizeSubmission(input);
  const variants = new Map(item.solutions.map((solution) => [solution.key, solution]));
  const current = normalizeSolution(item);
  variants.set(current.key, variants.has(current.key) ? mergeSolution(variants.get(current.key), current) : current);
  return [...variants.values()].sort((left, right) => {
    const dateDifference = (Date.parse(right.syncedAt) || 0) - (Date.parse(left.syncedAt) || 0);
    return dateDifference || left.key.localeCompare(right.key);
  });
}

export function reusableGeneratedReview(existing = {}, incoming = {}) {
  const update = normalizeSubmission(incoming);
  const match = submissionSolutions(existing).find((solution) => (
    solution.language.toLowerCase() === update.language.toLowerCase()
    && solution.code.trimEnd() === update.code.trimEnd()
  ));
  return match?.review?.generatedBy ? match.review : null;
}

export function mergeSubmissionSolutions(existing = {}, incoming = {}) {
  const hasPrevious = Object.keys(existing).length > 0;
  const previous = normalizeSubmission(existing);
  const update = normalizeSubmission(incoming);
  const variants = new Map();
  const previousSolutions = hasPrevious ? submissionSolutions(previous) : [];
  for (const solution of [...previousSolutions, ...submissionSolutions(update)]) {
    variants.set(solution.key, variants.has(solution.key) ? mergeSolution(variants.get(solution.key), solution) : solution);
  }
  const solutions = [...variants.values()].sort((left, right) => {
    const dateDifference = (Date.parse(right.syncedAt) || 0) - (Date.parse(left.syncedAt) || 0);
    return dateDifference || left.key.localeCompare(right.key);
  });
  const latest = solutions[0];
  const difficulty = update.difficulty === "Unknown" ? previous.difficulty : update.difficulty;
  const merged = normalizeSubmission({
    ...previous,
    ...update,
    title: hasPrevious ? previous.title : update.title,
    slug: hasPrevious ? previous.slug : update.slug,
    difficulty,
    tags: update.tags.length ? update.tags : previous.tags,
    url: update.url || previous.url,
    problemDescription: update.problemDescription || previous.problemDescription,
    problemContext: update.problemContext || previous.problemContext,
    examples: update.examples.length ? update.examples : previous.examples,
    exampleInput: update.exampleInput || previous.exampleInput,
    exampleOutput: update.exampleOutput || previous.exampleOutput,
    constraints: update.constraints.length ? update.constraints : previous.constraints,
    hints: update.hints.length ? update.hints : previous.hints,
    followUp: update.followUp || previous.followUp,
    notes: update.notes || previous.notes,
    solvedAt: previous.solvedAt || update.solvedAt,
    reviewDueAt: update.reviewDueAt || previous.reviewDueAt,
    lastReviewedAt: update.lastReviewedAt || previous.lastReviewedAt,
    reviewIntervalDays: update.reviewIntervalDays || previous.reviewIntervalDays,
    reviewCount: Math.max(update.reviewCount, previous.reviewCount),
    reviewLapses: Math.max(update.reviewLapses, previous.reviewLapses),
    lastReviewRating: update.lastReviewRating || previous.lastReviewRating,
    reviewEvents: mergeReviewEvents(previous.reviewEvents, update.reviewEvents),
    solutions
  });
  return {
    ...merged,
    language: latest.language,
    extension: latest.extension,
    path: latest.path,
    code: latest.code,
    runtime: latest.runtime,
    memory: latest.memory,
    status: latest.status,
    syncedAt: latest.syncedAt,
    commitUrl: latest.commitUrl,
    commitSha: latest.commitSha,
    review: latest.review,
    solutions
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

function fallbackSolutionVisual(item) {
  const pattern = item.tags[0];
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
  const visual = suppliedVisual || fallbackSolutionVisual(item);
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
  if (!value) return "";
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
  const topic = item.tags[0];
  return {
    summary: topic
      ? `Use the ${topic.toLowerCase()} topic to organize the key decisions, then verify the invariants against an edge case.`
      : "Reconstruct the key decisions, then verify the invariants against an edge case.",
    steps: [
      "State the direct approach and identify its bottleneck.",
      topic ? `Explain why ${topic.toLowerCase()} fits the constraints.` : "Explain why the chosen approach fits the constraints.",
      "Walk through one edge case and justify the final complexity."
    ]
  };
}

function markdownText(value) {
  return String(value || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function fencedText(value) {
  const text = String(value || "");
  const fence = text.includes("```") ? "````" : "```";
  return [fence + "text", text, fence];
}

function inlineCode(value) {
  return `\`${String(value || "").replace(/`/g, "'")}\``;
}

const BROAD_STUDY_TOPICS = new Set(["Array", "String", "Math", "Matrix", "Simulation", "Sorting"]);
const README_DATA_START = "<!-- leetrepo:data:v1";
const README_DATA_END = "leetrepo:data:end -->";

function utf8Base64(value) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64Utf8(value) {
  const binary = atob(value);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function readmeSubmission(input, suppliedReview) {
  const item = normalizeSubmission({
    ...input,
    review: suppliedReview || input?.review || null
  });
  const folder = folderFor(item);
  const solutions = submissionSolutions(item).map((solution) => ({
    ...solution,
    path: solution.path || `${folder}/${languageFolderFor(solution)}/solution.${solution.extension}`
  }));
  const current = solutions.find((solution) => solution.key === `${item.language.toLowerCase()}:${item.extension}`) || solutions[0];
  return {
    ...item,
    ...(current || {}),
    id: item.id,
    number: item.number,
    title: item.title,
    slug: item.slug,
    difficulty: item.difficulty,
    tags: item.tags,
    url: item.url,
    problemDescription: item.problemDescription,
    problemContext: item.problemContext,
    examples: item.examples,
    exampleInput: item.exampleInput,
    exampleOutput: item.exampleOutput,
    constraints: item.constraints,
    hints: item.hints,
    followUp: item.followUp,
    notes: item.notes,
    reviewDueAt: item.reviewDueAt,
    lastReviewedAt: item.lastReviewedAt,
    reviewIntervalDays: item.reviewIntervalDays,
    reviewCount: item.reviewCount,
    reviewLapses: item.reviewLapses,
    lastReviewRating: item.lastReviewRating,
    reviewEvents: item.reviewEvents,
    solutions
  };
}

export function buildReadmeData(input, suppliedReview) {
  const payload = JSON.stringify({ version: 1, submission: readmeSubmission(input, suppliedReview) });
  return `${README_DATA_START}\n${utf8Base64(payload)}\n${README_DATA_END}`;
}

function section(markdown, heading) {
  const match = String(markdown || "").match(new RegExp(`^## ${heading}\\s*$([\\s\\S]*?)(?=^## |(?![\\s\\S]))`, "im"));
  return match?.[1]?.trim() || "";
}

function legacyReadmeData(markdown) {
  const heading = String(markdown || "").match(/^#\s+(\d+)\.\s+(.+)$/m);
  if (!heading) return null;
  const metadata = section(markdown, "Solution metadata");
  const field = (name) => metadata.match(new RegExp(`^\\s*-\\s+\\*\\*${name}:\\*\\*\\s+(.+)$`, "im"))?.[1]?.trim() || "";
  const solved = field("Solved");
  const solvedAt = solved && !Number.isNaN(Date.parse(solved.replace(/ UTC$/, "Z")))
    ? new Date(solved.replace(/ UTC$/, "Z")).toISOString()
    : null;
  const problemDescription = section(markdown, "Problem description")
    .replace(/^>\s+Problem details captured[^\n]*\n?/i, "")
    .trim();
  const interview = section(markdown, "Interview overview");
  const summary = interview
    .replace(/^>[^\n]*\n?/i, "")
    .split(/^### /m)[0]
    .trim();
  const approach = interview.match(/^### Approach\s*$([\s\S]*?)(?=^### |(?![\s\S]))/im)?.[1]
    ?.match(/^\s*\d+\.\s+(.+)$/gm)
    ?.map((line) => line.replace(/^\s*\d+\.\s+/, "").trim()) || [];
  const time = interview.match(/^\s*-\s+\*\*Time:\*\*\s+(.+)$/im)?.[1]?.trim() || "";
  const space = interview.match(/^\s*-\s+\*\*Space:\*\*\s+(.+)$/im)?.[1]?.trim() || "";
  const edgeCases = interview.match(/^### Edge cases\s*$([\s\S]*?)(?=^### |(?![\s\S]))/im)?.[1]
    ?.match(/^\s*-\s+(.+)$/gm)
    ?.map((line) => line.replace(/^\s*-\s+/, "").trim()) || [];
  const generatedBy = interview.match(/_AI-generated with ([^;_]+)[;_]/i)?.[1]?.trim() || "";
  const review = summary || approach.length || time || space || edgeCases.length
    ? { summary, approach, complexity: { time, space }, edgeCases, generatedBy }
    : null;
  return normalizeSubmission({
    number: heading[1],
    title: heading[2].trim(),
    difficulty: field("Difficulty"),
    tags: field("Topics").split(",").map((tag) => tag.trim()).filter(Boolean),
    language: field("Language"),
    runtime: field("Runtime"),
    memory: field("Memory"),
    solvedAt,
    url: String(markdown || "").match(/\[View problem on LeetCode\]\((https:\/\/[^)]+)\)/i)?.[1] || "",
    problemDescription,
    problemContext: problemDescription,
    notes: section(markdown, "Personal notes"),
    review
  });
}

export function parseReadmeData(markdown) {
  const tagged = String(markdown || "").match(/<!--\s*leetrepo:data:v1\s*\n([A-Za-z0-9+/=\r\n]+?)\nleetrepo:data:end\s*-->/i);
  if (!tagged) return legacyReadmeData(markdown);
  try {
    const value = JSON.parse(base64Utf8(tagged[1].replace(/\s/g, "")));
    if (value?.version !== 1 || !value.submission || typeof value.submission !== "object") return null;
    return readmeSubmission(value.submission, value.submission.review);
  } catch {
    return null;
  }
}

export function buildReadme(submission, settings = DEFAULT_SETTINGS, suppliedReview) {
  const item = readmeSubmission(submission, suppliedReview);
  const lines = [`# ${item.number}. ${item.title}`, ""];
  if (settings.includeLink !== false && item.url) lines.push(`[View problem on LeetCode](${item.url})`, "");
  lines.push("## Solution metadata", "");
  lines.push(`- **Difficulty:** ${item.difficulty}`, `- **Language:** ${item.language}`);
  if (item.tags.length) lines.push(`- **Topics:** ${item.tags.join(", ")}`);
  const solvedAt = formatSolvedAt(item.solvedAt);
  if (solvedAt) lines.push(`- **Solved:** ${solvedAt}`);
  if (settings.includeStats !== false) lines.push(`- **Runtime:** ${item.runtime}`, `- **Memory:** ${item.memory}`);
  lines.push(`- **Solution:** [${item.language}](./${languageFolderFor(item)}/solution.${item.extension})`);
  const otherSolutions = item.solutions.filter((solution) => solution.key !== `${item.language.toLowerCase()}:${item.extension}`);
  for (const solution of otherSolutions) {
    lines.push(`- **Solution (${solution.language}):** [${solution.language}](./${languageFolderFor(solution)}/solution.${solution.extension})`);
  }

  const problemDescription = item.problemDescription || item.problemContext;
  if (problemDescription) {
    lines.push("", "## Problem description", "");
    if (settings.includeLink !== false && item.url) lines.push(`> Problem details captured from [LeetCode](${item.url}).`, "");
    lines.push(markdownText(problemDescription));
  }

  const examples = item.examples.length
    ? item.examples
    : item.exampleInput && item.exampleOutput
      ? [{ input: item.exampleInput, output: item.exampleOutput, explanation: "" }]
      : [];
  if (examples.length) {
    lines.push("", "## Examples");
    examples.forEach((example, index) => {
      lines.push("", `### Example ${index + 1}`, "", ...fencedText(`Input:\n${example.input}\n\nOutput:\n${example.output}`));
      if (example.explanation) lines.push("", `**Explanation:** ${markdownText(example.explanation)}`);
    });
  }
  if (item.constraints.length) {
    lines.push("", "## Constraints", "");
    item.constraints.forEach((constraint) => lines.push(`- ${/[<>=]|\d/.test(constraint) ? inlineCode(constraint) : markdownText(constraint)}`));
  }
  if (item.followUp) lines.push("", "## Follow-up", "", markdownText(item.followUp));
  if (item.hints.length) {
    lines.push("", "## Hints", "", "<details>", "<summary>Reveal official hints</summary>", "");
    item.hints.forEach((hint, index) => lines.push(`${index + 1}. ${markdownText(hint)}`));
    lines.push("", "</details>");
  }

  if (suppliedReview && (settings.aiEnabled === true || suppliedReview.generatedBy)) {
    const review = suppliedReview;
    lines.push("", "## Interview overview", "", "> Generated from the submitted solution and the official problem details above. Verify AI analysis before relying on it.", "");
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

  const studyTopic = item.tags.find((topic) => !BROAD_STUDY_TOPICS.has(topic)) || item.tags[0];
  lines.push(
    "",
    "## Study guide",
    "",
    "Before reopening the solution:",
    "",
    `1. Identify why ${studyTopic ? `**${studyTopic}**` : "the chosen technique"} fits the problem constraints.`,
    "2. State the invariant that makes the algorithm correct.",
    examples.length ? "3. Replay the first example without looking at the implementation." : "3. Walk through a representative input by hand.",
    "4. Derive the time and space complexity from the implementation.",
    "5. Name an edge case that would break a weaker approach."
  );
  lines.push("", "---", "_Synced by [LeetRepo](https://github.com/)_", "", buildReadmeData(item, suppliedReview));
  return lines.join("\n");
}

export function historyInsights(items = []) {
  const patterns = new Map();
  const languages = new Map();
  for (const input of items) {
    const item = normalizeSubmission(input);
    for (const solution of submissionSolutions(item)) {
      languages.set(solution.language, (languages.get(solution.language) || 0) + 1);
    }
    for (const tag of item.tags) patterns.set(tag, (patterns.get(tag) || 0) + 1);
  }
  const sortCounts = (entries) => [...entries].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  return { patterns: sortCounts(patterns), languages: sortCounts(languages) };
}

export function submissionSearchText(input = {}) {
  const item = normalizeSubmission(input);
  const languages = submissionSolutions(item).map((solution) => solution.language);
  return [item.number, item.title, item.difficulty, item.notes, ...languages, ...item.tags].join(" ").toLowerCase();
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
    "## Topic coverage",
    "",
    insights.patterns.length ? insights.patterns.slice(0, 12).map(([tag, count]) => `- ${tag}: ${count}`).join("\n") : "Topic data will appear after the first synced solution.",
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

export function relativeTime(value, now = Date.now()) {
  if (!value) return "not yet";
  const seconds = Math.max(0, Math.round((now - new Date(value).getTime()) / 1000));
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 172800) return "yesterday";
  return `${Math.floor(seconds / 86400)}d ago`;
}

export function solveTimestamp(item = {}) {
  return item.solvedAt || item.syncedAt || null;
}

export function calculateStreak(items = [], now = new Date()) {
  const days = new Set(items.map(solveTimestamp).filter(Boolean).map((value) => new Date(value).toISOString().slice(0, 10)));
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
