(() => {
  function submissionKey(submission) {
    return `${submission?.number || "0"}:${String(submission?.code || "").trimEnd()}`;
  }

  function beginAttempt(submission, startedAt = Date.now()) {
    return { key: submissionKey(submission), submission: { ...submission }, startedAt };
  }

  function finishAttempt(pending, status, result = {}) {
    if (!pending?.submission || !status) return null;
    return {
      ...pending.submission,
      runtime: result.runtime || pending.submission.runtime,
      memory: result.memory || pending.submission.memory,
      status
    };
  }

  globalThis.LeetRepoAttempt = Object.freeze({ beginAttempt, finishAttempt, submissionKey });
})();
