import { readFile, writeFile } from "node:fs/promises";

export async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const report = JSON.parse(await readFile(options.input, "utf8"));
  const output = prepareIssueSupervisorDecision(report);

  if (options.output) {
    await writeFile(options.output, `${JSON.stringify(output, null, 2)}\n`);
  } else {
    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  }
}

export function prepareIssueSupervisorDecision(report) {
  const triage = extractTriageReport(report);
  const recommendedLane = firstString(triage.recommended_lane) ?? "manual-triage";
  const commenceDecision = normalizeEnum(
    triage.commence_decision,
    triage.needs_human ? "needs_human" : "approve",
    ["approve", "hold", "reject", "needs_human"],
  );
  const actionDecision = normalizeEnum(
    triage.action_decision,
    defaultActionDecision({ commenceDecision, recommendedLane }),
    ["proceed_to_build", "request_review", "stop"],
  );
  const reviewTarget = normalizeEnum(
    triage.review_target,
    actionDecision === "request_review" ? "issue" : "none",
    ["issue", "draft_pr", "none"],
  );
  const proposedWorkerRequests = collectProposedWorkerRequests(triage);
  const shouldStartWorker =
    commenceDecision === "approve"
    && actionDecision === "proceed_to_build"
    && proposedWorkerRequests.length > 0;
  const workerRequests = shouldStartWorker ? proposedWorkerRequests : [];
  const commentBody = buildSupervisorComment({
    triage,
    commenceDecision,
    actionDecision,
    recommendedLane,
    reviewTarget,
    workerCount: workerRequests.length,
  });

  return {
    mode: workerRequests.length > 0 ? "issue-to-pr" : "comment",
    triage_report: triage,
    issue_to_pr_request: workerRequests[0]?.issue_to_pr_request,
    comment_body: commentBody,
    supervisor_decision: {
      commence_decision: commenceDecision,
      action_decision: actionDecision,
      recommended_lane: recommendedLane,
      review_target: reviewTarget,
      should_post_comment: commentBody.length > 0,
      should_start_worker: workerRequests.length > 0,
      worker_requests: workerRequests,
    },
  };
}

export function buildSupervisorComment({
  triage,
  commenceDecision,
  actionDecision,
  recommendedLane,
  reviewTarget,
  workerCount = 0,
}) {
  const lines = [
    "## runx issue supervisor",
    "",
    `- Commence: \`${commenceDecision}\``,
    `- Next lane: \`${recommendedLane}\``,
    `- Action: \`${actionDecision}\``,
  ];

  if (reviewTarget !== "none") {
    lines.push(`- Review target: \`${reviewTarget}\``);
  }
  if (workerCount > 0) {
    lines.push(`- Worker fanout: \`${workerCount}\``);
  }

  const narrative = firstString(
    actionDecision === "request_review" ? triage.review_comment : undefined,
  )
    ?? firstString(triage.suggested_reply)
    ?? firstString(triage.review_comment)
    ?? `runx classified this request as ${recommendedLane} and did not open a worker yet.`;

  lines.push("");
  lines.push(narrative);

  const rationale = firstString(triage.rationale);
  if (rationale) {
    lines.push("");
    lines.push(`Rationale: ${rationale}`);
  }

  const operatorNotes = Array.isArray(triage.operator_notes)
    ? triage.operator_notes.filter((entry) => typeof entry === "string" && entry.trim().length > 0)
    : [];
  if (operatorNotes.length > 0) {
    lines.push("");
    lines.push("Operator notes:");
    for (const note of operatorNotes) {
      lines.push(`- ${note.trim()}`);
    }
  }

  return lines.join("\n").trim();
}

function extractTriageReport(report) {
  if (asRecord(report)?.triage_report) {
    return asRecord(report.triage_report) ?? {};
  }
  const stdout = firstString(asRecord(report)?.execution?.stdout);
  if (!stdout) {
    return {};
  }
  try {
    return asRecord(JSON.parse(stdout)?.triage_report) ?? {};
  } catch {
    return {};
  }
}

function defaultActionDecision({ commenceDecision, recommendedLane }) {
  if (commenceDecision !== "approve") {
    return "stop";
  }
  if (recommendedLane === "issue-to-pr" || recommendedLane === "multi-repo-issue-to-pr") {
    return "proceed_to_build";
  }
  if (recommendedLane === "reply-only") {
    return "stop";
  }
  return "request_review";
}

function collectProposedWorkerRequests(triage) {
  const explicitRequests = Array.isArray(triage.worker_requests)
    ? triage.worker_requests
    : [];
  const normalizedExplicit = explicitRequests
    .map(normalizeWorkerRequest)
    .filter(Boolean);
  if (normalizedExplicit.length > 0) {
    return normalizedExplicit;
  }

  const issueToPrRequests = Array.isArray(triage.issue_to_pr_requests)
    ? triage.issue_to_pr_requests
    : [];
  const normalizedIssueToPr = issueToPrRequests
    .map((request) => normalizeWorkerRequest({ worker: "issue-to-pr", issue_to_pr_request: request }))
    .filter(Boolean);
  if (normalizedIssueToPr.length > 0) {
    return normalizedIssueToPr;
  }

  const singleRequest = asRecord(triage.issue_to_pr_request);
  if (singleRequest) {
    return [
      {
        worker: "issue-to-pr",
        issue_to_pr_request: singleRequest,
      },
    ];
  }

  return [];
}

function normalizeWorkerRequest(value) {
  const record = asRecord(value);
  if (!record) {
    return undefined;
  }
  const issueToPrRequest = asRecord(record.issue_to_pr_request);
  if (issueToPrRequest) {
    return {
      worker: firstString(record.worker) ?? "issue-to-pr",
      issue_to_pr_request: issueToPrRequest,
    };
  }
  if (firstString(record.worker) === "issue-to-pr" && asRecord(record.request)) {
    return {
      worker: "issue-to-pr",
      issue_to_pr_request: asRecord(record.request),
    };
  }
  return undefined;
}

function normalizeEnum(value, fallback, allowed) {
  const candidate = firstString(value);
  return candidate && allowed.includes(candidate) ? candidate : fallback;
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--input") {
      options.input = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--output") {
      options.output = requireValue(argv, ++index, token);
      continue;
    }
    throw new Error(`Unknown argument: ${token}`);
  }
  if (!options.input) {
    throw new Error("--input is required.");
  }
  return options;
}

function requireValue(argv, index, flag) {
  const value = argv[index];
  if (!value) {
    throw new Error(`${flag} requires a value.`);
  }
  return value;
}

function firstString(value) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function asRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : undefined;
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  await main();
}
