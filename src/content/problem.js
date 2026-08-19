(() => {
  const normalizeSpace = (value) => String(value || "").replace(/\s+/g, " ").trim();

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

  globalThis.LeetRepoProblem = Object.freeze({ getProblemIdentity, getProblemTags });
})();
