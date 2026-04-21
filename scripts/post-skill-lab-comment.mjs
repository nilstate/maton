import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";

export const SKILL_LAB_MARKER = "<!-- aster:runx-skill-lab -->";

export async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const publish = await readOptionalJson(options.publishJson);
  const commentBody = buildSkillLabComment({
    objective: options.objective,
    runUrl: options.runUrl,
    publish,
    ledgerRevision: options.ledgerRevision,
  });

  const issue = JSON.parse(
    execFileSync(
      "gh",
      [
        "issue",
        "view",
        options.issue,
        "--repo",
        options.repo,
        "--json",
        "comments",
      ],
      { encoding: "utf8" },
    ),
  );
  const existing = (issue.comments ?? []).find(
    (comment) => typeof comment.body === "string" && comment.body.includes(SKILL_LAB_MARKER),
  );
  const existingCommentId = resolveIssueCommentId(existing);

  if (existing?.body?.trim() === commentBody.trim()) {
    process.stdout.write(`${JSON.stringify({ status: "noop", reason: "comment already up to date" }, null, 2)}\n`);
    return;
  }

  if (existingCommentId) {
    execFileSync(
      "gh",
      [
        "api",
        "--method",
        "PATCH",
        `repos/${options.repo}/issues/comments/${existingCommentId}`,
        "-f",
        `body=${commentBody}`,
      ],
      { stdio: "inherit" },
    );
    process.stdout.write(`${JSON.stringify({ status: "updated", comment_id: existingCommentId }, null, 2)}\n`);
    return;
  }

  execFileSync(
    "gh",
    [
      "issue",
      "comment",
      options.issue,
      "--repo",
      options.repo,
      "--body",
      commentBody,
    ],
    { stdio: "inherit" },
  );
  process.stdout.write(`${JSON.stringify({ status: "posted" }, null, 2)}\n`);
}

export function buildSkillLabComment({ objective, runUrl, publish, ledgerRevision }) {
  const lines = [
    SKILL_LAB_MARKER,
    "## runx skill lab",
    "",
    `- Objective: \`${String(objective ?? "Untitled skill proposal").trim()}\``,
    `- Status: \`${resolveSkillLabStatus(publish)}\``,
  ];

  if (publish?.status === "published") {
    lines.push(`- Draft PR: [#${publish.pr_number}](${publish.pr_url})`);
  }
  if (ledgerRevision) {
    lines.push(`- Ledger revision: \`${ledgerRevision}\``);
  }
  if (runUrl) {
    lines.push(`- Workflow run: ${runUrl}`);
  }

  lines.push(
    "",
    "Reply in this issue with amendments, constraints, or teaching notes and skill-lab will refresh the same proposal from the same work ledger.",
  );

  return `${lines.join("\n").trim()}\n`;
}

function resolveSkillLabStatus(publish) {
  if (!publish || typeof publish !== "object") {
    return "run_completed";
  }
  if (publish.status === "published") {
    return "draft_pr_refreshed";
  }
  return String(publish.status ?? "run_completed");
}

async function readOptionalJson(file) {
  if (!file) {
    return null;
  }
  try {
    const raw = await readFile(file, "utf8");
    return JSON.parse(raw);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--repo") {
      options.repo = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--issue") {
      options.issue = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--objective") {
      options.objective = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--run-url") {
      options.runUrl = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--publish-json") {
      options.publishJson = requireValue(argv, ++index, token);
      continue;
    }
    if (token === "--ledger-revision") {
      options.ledgerRevision = requireValue(argv, ++index, token);
      continue;
    }
    throw new Error(`Unknown argument: ${token}`);
  }

  if (!options.repo || !options.issue || !options.objective) {
    throw new Error("--repo, --issue, and --objective are required.");
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

function resolveIssueCommentId(comment) {
  if (!comment || typeof comment !== "object") {
    return undefined;
  }
  if (typeof comment.databaseId === "number") {
    return String(comment.databaseId);
  }
  if (typeof comment.url === "string") {
    const match = comment.url.match(/issuecomment-(\d+)$/);
    if (match?.[1]) {
      return match[1];
    }
  }
  return undefined;
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  await main();
}
