(() => {
  const languageNames = {
    bash: "Bash",
    c: "C",
    "c++": "C++",
    cpp: "C++",
    "c#": "C#",
    csharp: "C#",
    dart: "Dart",
    elixir: "Elixir",
    erlang: "Erlang",
    go: "Go",
    golang: "Go",
    java: "Java",
    javascript: "JavaScript",
    kotlin: "Kotlin",
    mysql: "MySQL",
    php: "PHP",
    python: "Python",
    python3: "Python3",
    racket: "Racket",
    ruby: "Ruby",
    rust: "Rust",
    scala: "Scala",
    swift: "Swift",
    typescript: "TypeScript"
  };

  function normalizeLanguage(value) {
    return languageNames[String(value || "").replace(/\s+/g, " ").trim().toLowerCase()] || "";
  }

  function detectLanguage(root = document) {
    const editorMode = root.querySelector('[data-track-load="code_editor"] [data-mode-id], #editor [data-mode-id]')?.getAttribute("data-mode-id");
    const modeLanguage = normalizeLanguage(editorMode);
    if (modeLanguage) return modeLanguage;

    const candidates = root.querySelectorAll('#editor button, button[id*="lang"], [data-cy="lang-select"], [class*="lang-select"]');
    for (const candidate of candidates) {
      const language = normalizeLanguage(candidate.textContent);
      if (language) return language;
    }
    return "Code";
  }

  globalThis.LeetRepoLanguage = Object.freeze({ detectLanguage, normalizeLanguage });
})();
