import { logo } from "../../shared/client.js";

const documents = {
  privacy: { file: "../../../PRIVACY.md", title: "Privacy Notice" },
  terms: { file: "../../../TERMS.md", title: "Terms and Conditions" },
  license: { file: "../../../LICENSE", title: "MIT License" }
};

function escapeHtml(value = "") {
  return String(value).replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#039;",
    '"': "&quot;"
  })[character]);
}

function documentHref(value) {
  if (value === "PRIVACY.md") return "?document=privacy";
  if (value === "TERMS.md") return "?document=terms";
  if (value === "LICENSE") return "?document=license";
  return /^https:\/\//.test(value) ? value : "#";
}

function inlineMarkdown(value) {
  return escapeHtml(value)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_match, label, href) => {
      const safeHref = documentHref(href.replaceAll("&amp;", "&"));
      const external = safeHref.startsWith("https://") ? ' target="_blank" rel="noreferrer"' : "";
      return `<a href="${escapeHtml(safeHref)}"${external}>${label}</a>`;
    });
}

function renderMarkdown(markdown) {
  const output = [];
  let list = "";
  const closeList = () => {
    if (!list) return;
    output.push(`</${list}>`);
    list = "";
  };

  for (const line of markdown.replaceAll("\r\n", "\n").split("\n")) {
    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    const bullet = line.match(/^[-*]\s+(.+)$/);
    const numbered = line.match(/^\d+\.\s+(.+)$/);
    if (heading) {
      closeList();
      const level = heading[1].length;
      output.push(`<h${level}>${inlineMarkdown(heading[2])}</h${level}>`);
    } else if (bullet || numbered) {
      const nextList = bullet ? "ul" : "ol";
      if (list !== nextList) {
        closeList();
        output.push(`<${nextList}>`);
        list = nextList;
      }
      output.push(`<li>${inlineMarkdown((bullet || numbered)[1])}</li>`);
    } else if (!line.trim()) {
      closeList();
    } else {
      closeList();
      output.push(`<p>${inlineMarkdown(line)}</p>`);
    }
  }
  closeList();
  return output.join("\n");
}

async function loadDocument() {
  document.querySelector("#logo").innerHTML = logo();
  const requested = new URLSearchParams(globalThis.location.search).get("document") || "privacy";
  const selected = documents[requested] || documents.privacy;
  document.title = `${selected.title} · LeetRepo Lite`;
  document.querySelectorAll("[data-document]").forEach((link) => link.classList.toggle("active", link.dataset.document === requested));
  const response = await fetch(selected.file);
  if (!response.ok) throw new Error(`Could not load ${selected.title}.`);
  document.querySelector("#legal-document").innerHTML = renderMarkdown(await response.text());
}

loadDocument().catch((error) => {
  document.querySelector("#legal-document").innerHTML = `<h1>Document unavailable</h1><p class="legal-error">${escapeHtml(error.message)}</p>`;
});
