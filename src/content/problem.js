(() => {
  const normalizeSpace = (value) => String(value || "").replace(/\s+/g, " ").trim();
  const normalizeLines = (value) => String(value || "")
    .replace(/\r/g, "")
    .split("\n")
    .map(normalizeSpace)
    .filter(Boolean)
    .join("\n")
    .trim();

  const descriptionSelectors = [
    '[data-track-load="description_content"]',
    '[data-cy="question-content"]',
    '[data-e2e-locator="description-content"]'
  ];

  function sectionValue(value, label, followingLabels) {
    const next = followingLabels.length ? `(?=\\n\\s*(?:${followingLabels.join("|")})\\s*:|$)` : "$";
    return normalizeLines(value.match(new RegExp(`(?:^|\\n)\\s*${label}\\s*:\\s*([\\s\\S]*?)${next}`, "i"))?.[1] || "");
  }

  function parseExamples(value) {
    const markers = [...value.matchAll(/(?:^|\n)\s*Example\s+(\d+)\s*:?\s*/gi)];
    if (!markers.length && /(?:^|\n)\s*Input\s*:/i.test(value) && /(?:^|\n)\s*Output\s*:/i.test(value)) {
      markers.push({ 0: "", 1: "1", index: 0 });
    }
    return markers.slice(0, 4).flatMap((marker, index) => {
      const start = marker.index + marker[0].length;
      const end = markers[index + 1]?.index ?? value.search(/(?:^|\n)\s*(?:Constraints?|Follow[- ]?up)\s*:/im);
      const chunk = value.slice(start, end > start ? end : value.length);
      const input = sectionValue(chunk, "Input", ["Output"]);
      const output = sectionValue(chunk, "Output", ["Explanation"]);
      const explanation = sectionValue(chunk, "Explanation", []);
      return input && output ? [{ input, output, explanation }] : [];
    });
  }

  function parseProblemText(value) {
    const text = normalizeLines(value);
    if (!text) return { problemDescription: "", examples: [], constraints: [], followUp: "" };
    const firstSection = [
      text.search(/(?:^|\n)\s*Example\s+\d+\s*:?/im),
      text.search(/(?:^|\n)\s*Constraints?\s*:/im),
      text.search(/(?:^|\n)\s*Follow[- ]?up\s*:/im)
    ].filter((index) => index >= 0).sort((left, right) => left - right)[0] ?? text.length;
    const constraintsText = sectionValue(text, "Constraints?", ["Follow[- ]?up"]);
    const constraints = constraintsText.split("\n")
      .map((line) => normalizeSpace(line.replace(/^[•*\-–—]+\s*/, "")))
      .filter(Boolean)
      .slice(0, 30);
    const followUp = sectionValue(text, "Follow[- ]?up", []);
    return {
      problemDescription: text.slice(0, firstSection).trim().slice(0, 5_000),
      examples: parseExamples(text).map((example) => ({
        input: example.input.slice(0, 1_500),
        output: example.output.slice(0, 1_500),
        explanation: example.explanation.slice(0, 1_500)
      })),
      constraints,
      followUp: followUp.slice(0, 1_500)
    };
  }

  function getProblemIdentity(root = document, pageLocation = location) {
    const urlParts = pageLocation.pathname.split("/").filter(Boolean);
    const rawSlug = urlParts[urlParts.indexOf("problems") + 1] || "problem";
    const slug = /^[a-z0-9]+(?:-[a-z0-9]+)*$/i.test(rawSlug) ? rawSlug : "problem";
    const problemPath = `/problems/${slug}/`;
    const heading = normalizeSpace(
      root.querySelector('[data-cy="question-title"]')?.textContent
      || root.querySelector('[data-e2e-locator="problem-title"]')?.textContent
      || root.querySelector(`a[href="${problemPath}"]`)?.textContent
      || root.querySelector("h1")?.textContent
    );
    const headingMatch = heading.match(/^(\d+)\.\s*(.+)$/);
    const titleMatch = String(root.title || "").match(/^(\d+)\.\s*(.+?)(?:\s*-\s*LeetCode)?$/i);
    return {
      number: headingMatch?.[1] || titleMatch?.[1] || "0",
      title: headingMatch?.[2] || titleMatch?.[2] || slug.split("-").map((part) => part[0]?.toUpperCase() + part.slice(1)).join(" "),
      slug
    };
  }

  function getProblemTags(root = document) {
    const tags = Array.from(root.querySelectorAll('a[href^="/tag/"], a[href^="https://leetcode.com/tag/"], a[href^="https://www.leetcode.com/tag/"]'))
      .map((link) => normalizeSpace(link.textContent))
      .filter(Boolean);
    return [...new Set(tags)];
  }

  function getProblemDetails(root = document) {
    const descriptionRoot = descriptionSelectors.map((selector) => root.querySelector(selector)).find(Boolean);
    const details = parseProblemText(descriptionRoot?.innerText || descriptionRoot?.textContent || "");
    const hints = Array.from(root.querySelectorAll([
      '[data-e2e-locator*="hint"]',
      '[data-cy*="hint"]',
      '[class*="hint"]'
    ].join(",")))
      .filter((node) => !node.children?.length)
      .map((node) => normalizeSpace(node.textContent).replace(/^Hint\s*\d*\s*:?\s*/i, ""))
      .filter((hint) => hint.length >= 15 && !/^show\s+hint/i.test(hint));
    return { ...details, hints: [...new Set(hints)].slice(0, 6) };
  }

  globalThis.LeetRepoProblem = Object.freeze({ getProblemDetails, getProblemIdentity, getProblemTags, parseProblemText });
})();
