export const DEFAULT_PUBLIC_WORK_POLICY = {
  blocked_author_patterns: ["[bot]", "app/", "renovate", "dependabot", "github-actions", "github-actions[bot]"],
  blocked_head_ref_prefixes: ["renovate/", "dependabot/", "runx/issue-", "runx/evidence-projection-derive"],
  blocked_exact_labels: [
    "dependencies",
    "dependency",
    "deps",
    "rust dependencies",
    "javascript dependencies",
    "python dependencies",
    "artifact drift",
    "artifact-update",
    "artifact update",
    "internal",
  ],
  blocked_label_prefixes: ["build:", "release:"],
  trust_recovery_statuses: ["spam", "minimized", "harmful"],
  require_welcome_signal_for_pull_request_comments: true,
};

export function evaluatePublicPullRequestCandidate(request, policy = {}) {
  const normalized = normalizePublicWorkPolicy(policy);
  const reasons = [];
  if (isBlockedAuthor(request.authorLogin, normalized)) {
    reasons.push("bot_authored_pull_request");
  }
  if (isDependencyUpdatePullRequest(request, normalized)) {
    reasons.push("dependency_update_pull_request");
  }
  if (hasBlockedPullRequestLabels(request.labels, normalized)) {
    reasons.push("internal_or_build_only_pull_request");
  }
  return {
    blocked: reasons.length > 0,
    reasons,
  };
}

export function evaluatePublicCommentOpportunity(request, policy = {}) {
  const normalized = normalizePublicWorkPolicy(policy);
  const pullRequestPolicy = evaluatePublicPullRequestCandidate(request, normalized);
  const reasons = [...pullRequestPolicy.reasons];
  const welcomeSignal = hasWelcomeSignal(request, normalized);
  if (
    request.source === "github_pull_request"
    && request.lane === "issue-triage"
    && normalized.require_welcome_signal_for_pull_request_comments
    && !welcomeSignal
  ) {
    reasons.push("comment_without_welcome_signal");
  }
  if (request.lane === "issue-triage" && isCommentLaneInTrustRecovery(request.recentOutcomes, normalized)) {
    reasons.push("comment_lane_in_trust_recovery");
  }
  return {
    blocked: reasons.length > 0,
    reasons,
    welcome_signal: welcomeSignal,
  };
}

function normalizePublicWorkPolicy(policy = {}) {
  return {
    blocked_author_patterns: normalizeValues(policy.blocked_author_patterns, DEFAULT_PUBLIC_WORK_POLICY.blocked_author_patterns),
    blocked_head_ref_prefixes: normalizeValues(policy.blocked_head_ref_prefixes, DEFAULT_PUBLIC_WORK_POLICY.blocked_head_ref_prefixes),
    blocked_exact_labels: normalizeValues(policy.blocked_exact_labels, DEFAULT_PUBLIC_WORK_POLICY.blocked_exact_labels),
    blocked_label_prefixes: normalizeValues(policy.blocked_label_prefixes, DEFAULT_PUBLIC_WORK_POLICY.blocked_label_prefixes),
    trust_recovery_statuses: normalizeValues(policy.trust_recovery_statuses, DEFAULT_PUBLIC_WORK_POLICY.trust_recovery_statuses),
    require_welcome_signal_for_pull_request_comments:
      policy.require_welcome_signal_for_pull_request_comments
      ?? DEFAULT_PUBLIC_WORK_POLICY.require_welcome_signal_for_pull_request_comments,
  };
}

function isBlockedAuthor(authorLogin, policy) {
  const login = String(authorLogin ?? "").trim().toLowerCase();
  return login.length > 0 && policy.blocked_author_patterns.some((pattern) => login.includes(pattern));
}

function isDependencyUpdatePullRequest(request, policy) {
  const normalizedLabels = normalizeLabels(request.labels);
  const normalizedTitle = String(request.title ?? "").trim().toLowerCase();
  const normalizedHead = String(request.headRefName ?? "").trim().toLowerCase();
  if (policy.blocked_head_ref_prefixes.some((prefix) => normalizedHead.startsWith(prefix))) {
    return true;
  }
  if (normalizedLabels.some((label) => policy.blocked_exact_labels.includes(label))) {
    return true;
  }
  if (/(^|\b)(update|upgrade|bump)(\b|:)/.test(normalizedTitle) && /\bv?\d+\.\d+/.test(normalizedTitle)) {
    return true;
  }
  return /dependency|dependencies|deps\b/.test(normalizedTitle);
}

function hasBlockedPullRequestLabels(labels, policy) {
  const normalizedLabels = normalizeLabels(labels);
  return normalizedLabels.some((label) => {
    return policy.blocked_exact_labels.includes(label) || policy.blocked_label_prefixes.some((prefix) => label.startsWith(prefix));
  });
}

function normalizeLabels(labels) {
  return Array.isArray(labels)
    ? labels.map((label) => String(label ?? "").trim().toLowerCase()).filter(Boolean)
    : [];
}

function hasWelcomeSignal(request, policy) {
  if (!policy.require_welcome_signal_for_pull_request_comments || request.source !== "github_pull_request") {
    return true;
  }
  if (["OWNER", "MEMBER", "COLLABORATOR", "CONTRIBUTOR"].includes(String(request.authorAssociation ?? "").toUpperCase())) {
    return true;
  }
  return Number(request.commentsCount ?? 0) + Number(request.reviewCommentsCount ?? 0) > 0;
}

function isCommentLaneInTrustRecovery(recentOutcomes, policy) {
  return Array.isArray(recentOutcomes)
    && recentOutcomes.some((entry) => policy.trust_recovery_statuses.includes(String(entry?.status ?? "").trim().toLowerCase()));
}

function normalizeValues(values, fallback) {
  return Array.isArray(values)
    ? values.map((value) => String(value ?? "").trim().toLowerCase()).filter(Boolean)
    : fallback;
}
