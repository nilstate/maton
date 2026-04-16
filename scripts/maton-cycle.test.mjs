import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";

import {
  buildDispatchPlan,
  discoverOpportunities,
  loadSelectionPolicy,
  runMatonCycle,
  scoreOpportunities,
  selectOpportunity,
} from "./maton-cycle.mjs";

const baseSelectionPolicy = {
  title: "Maton Selection Policy",
  version: 1,
  updated: "2026-04-17",
  weights: {
    stranger_value: 0.24,
    proof_strength: 0.24,
    compounding_value: 0.19,
    tractability: 0.16,
    novelty: 0.09,
    maintenance_efficiency: 0.08,
  },
  thresholds: {
    stranger_value_min: 0.6,
    proof_strength_min: 0.7,
    minimum_select_score: 0.68,
  },
  cooldown_hours: {
    success: 72,
    ignored: 168,
    rejected: 504,
    severe: 2160,
    failed: 24,
  },
  selection_contract: {
    preferred_default: "no_op",
    max_priority_queue: 3,
    dispatch_count_per_cycle: 1,
  },
};

async function writeSelectionPolicy(filePath, overrides = {}) {
  const policy = {
    ...baseSelectionPolicy,
    ...overrides,
    weights: {
      ...baseSelectionPolicy.weights,
      ...(overrides.weights ?? {}),
    },
    thresholds: {
      ...baseSelectionPolicy.thresholds,
      ...(overrides.thresholds ?? {}),
    },
    cooldown_hours: {
      ...baseSelectionPolicy.cooldown_hours,
      ...(overrides.cooldown_hours ?? {}),
    },
    selection_contract: {
      ...baseSelectionPolicy.selection_contract,
      ...(overrides.selection_contract ?? {}),
    },
  };
  await writeFile(filePath, `${JSON.stringify(policy, null, 2)}\n`);
}

test("loadSelectionPolicy parses weights, thresholds, and cooldowns", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "maton-scoring-"));
  const selectionPolicyPath = path.join(tempRoot, "selection-policy.json");
  await writeSelectionPolicy(selectionPolicyPath);

  const policy = await loadSelectionPolicy(selectionPolicyPath);

  assert.equal(policy.weights.stranger_value, 0.24);
  assert.equal(policy.thresholds.stranger_value_min, 0.6);
  assert.equal(policy.thresholds.minimum_select_score, 0.68);
  assert.equal(policy.cooldown_hours.success, 72);
  assert.equal(policy.cooldown_hours.ignored, 168);
});

test("discover, score, and select curated prerelease targets inside nilstate scope", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "maton-cycle-"));
  const repoRoot = path.join(tempRoot, "repo");
  await mkdir(path.join(repoRoot, "doctrine"), { recursive: true });
  await mkdir(path.join(repoRoot, "state", "targets"), { recursive: true });
  await mkdir(path.join(repoRoot, "history"), { recursive: true });
  await mkdir(path.join(repoRoot, "reflections"), { recursive: true });

  await writeSelectionPolicy(path.join(repoRoot, "state", "selection-policy.json"));

  await writeFile(
    path.join(repoRoot, "state", "targets", "nilstate-maton.md"),
    [
      "---",
      "title: Target Dossier — nilstate/maton",
      "subject_locator: nilstate/maton",
      "---",
      "",
      "# nilstate/maton",
      "",
      "## Default Lanes",
      "",
      "- `issue-triage`",
      "- `proving-ground`",
      "",
      "## Recent Outcomes",
      "",
      "- 2026-04-16 · `proving-ground` · `completed` · recent proving-ground run",
      "",
    ].join("\n"),
  );
  await writeFile(
    path.join(repoRoot, "state", "targets", "nilstate-runx.md"),
    [
      "---",
      "title: Target Dossier — nilstate/runx",
      "subject_locator: nilstate/runx",
      "---",
      "",
      "# nilstate/runx",
      "",
      "## Default Lanes",
      "",
      "- `issue-triage`",
      "- `issue-triage`",
      "",
    ].join("\n"),
  );

  const discoveryPath = path.join(repoRoot, "discovery.json");
  await writeFile(
    discoveryPath,
    `${JSON.stringify(
      {
        "nilstate/maton": {
          issues: [],
          prs: [],
        },
        "nilstate/runx": {
          issues: [],
          prs: [
            {
              number: 101,
              title: "docs: fix broken app router example",
              body: "Small fix with public impact.",
              url: "https://github.com/nilstate/runx/pull/101",
              isDraft: false,
              authorAssociation: "CONTRIBUTOR",
              author: { login: "outside-dev" },
              updatedAt: "2026-04-15T00:00:00Z",
            },
          ],
        },
      },
      null,
      2,
    )}\n`,
  );

  const result = await runMatonCycle({
    repoRoot,
    repo: "nilstate/maton",
    discoveryInput: discoveryPath,
    now: "2026-04-16T12:00:00Z",
  });

  assert.equal(result.selection.status, "selected");
  assert.equal(result.selection.selected.target_repo, "nilstate/runx");
  assert.equal(result.selection.selected.lane, "issue-triage");
  assert.match(result.selection.priorities[0].subject_locator, /nilstate\/runx#pr\/101/);
  assert.equal(result.selection.priorities[0].within_v1_scope, true);
  assert.equal(result.selection.priorities[0].vetoed, false);
  assert.equal(result.maton_control.targets.length >= 2, true);
  assert.equal(result.maton_control.opportunities[0].opportunity_id, result.opportunities[0].id);
  assert.equal(result.maton_control.cycle_records[0].status, "selected");
  assert.equal(result.maton_control.priorities[0].status, "selected");
});

test("runMatonCycle vetoes curated external targets outside prerelease v1 scope", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "maton-external-veto-"));
  const repoRoot = path.join(tempRoot, "repo");
  await mkdir(path.join(repoRoot, "doctrine"), { recursive: true });
  await mkdir(path.join(repoRoot, "state", "targets"), { recursive: true });
  await mkdir(path.join(repoRoot, "history"), { recursive: true });
  await mkdir(path.join(repoRoot, "reflections"), { recursive: true });

  await writeSelectionPolicy(path.join(repoRoot, "state", "selection-policy.json"));

  await writeFile(
    path.join(repoRoot, "state", "targets", "vercel-next-js.md"),
    [
      "---",
      "title: Target Dossier — vercel/next.js",
      "subject_locator: vercel/next.js",
      "---",
      "",
      "# vercel/next.js",
      "",
      "## Default Lanes",
      "",
      "- `issue-triage`",
      "",
    ].join("\n"),
  );

  const discoveryPath = path.join(repoRoot, "discovery.json");
  await writeFile(
    discoveryPath,
    `${JSON.stringify(
      {
        "vercel/next.js": {
          issues: [],
          prs: [
            {
              number: 101,
              title: "docs: fix broken app router example",
              body: "Small fix with public impact.",
              url: "https://github.com/vercel/next.js/pull/101",
              isDraft: false,
              authorAssociation: "CONTRIBUTOR",
              author: { login: "outside-dev" },
              updatedAt: "2026-04-15T00:00:00Z",
            },
          ],
        },
      },
      null,
      2,
    )}\n`,
  );

  const result = await runMatonCycle({
    repoRoot,
    repo: "nilstate/maton",
    discoveryInput: discoveryPath,
    now: "2026-04-16T12:00:00Z",
  });
  const blockedPr = result.opportunities.find((entry) => entry.subject_locator === "vercel/next.js#pr/101");

  assert.equal(blockedPr?.within_v1_scope, false);
  assert.match(blockedPr?.veto_reasons.join(",") ?? "", /target_outside_prerelease_v1_scope/);
  assert.notEqual(result.selection.selected?.target_repo, "vercel/next.js");
});

test("scoreOpportunities enforces cooldowns from target dossiers", async () => {
  const policy = {
    weights: {
      stranger_value: 0.24,
      proof_strength: 0.24,
      compounding_value: 0.19,
      tractability: 0.16,
      novelty: 0.09,
      maintenance_efficiency: 0.08,
    },
    thresholds: {
      stranger_value_min: 0.6,
      proof_strength_min: 0.7,
      minimum_select_score: 0.68,
    },
    cooldown_hours: {
      success: 72,
      ignored: 168,
      rejected: 504,
      failed: 24,
    },
  };

  const opportunities = [
    {
      id: "maintenance-proving-ground",
      lane: "proving-ground",
      source: "maintenance",
      title: "Run proving-ground",
      summary: "Run proving-ground",
      subject_locator: "nilstate/maton",
      target_repo: "nilstate/maton",
      stale_days: 0.2,
      dossier: {
        default_lanes: ["proving-ground"],
        recent_outcomes: [
          {
            date: "2026-04-16",
            lane: "proving-ground",
            status: "completed",
            summary: "recent proving-ground run",
          },
        ],
      },
      memory_records: [],
    },
  ];

  const scored = scoreOpportunities({
    opportunities,
    dossiers: {
      "nilstate-maton": opportunities[0].dossier,
    },
    memory: { history: [], reflections: [] },
    policy,
    now: new Date("2026-04-16T12:00:00Z"),
  });

  assert.equal(scored[0].vetoed, true);
  assert.match(scored[0].veto_reasons.join(","), /cooldown/);
});

test("scoreOpportunities uses dossier current opportunities to boost lane fit", () => {
  const policy = {
    weights: {
      stranger_value: 0.24,
      proof_strength: 0.24,
      compounding_value: 0.19,
      tractability: 0.16,
      novelty: 0.09,
      maintenance_efficiency: 0.08,
    },
    thresholds: {
      stranger_value_min: 0.6,
      proof_strength_min: 0.7,
      minimum_select_score: 0.68,
    },
    cooldown_hours: {
      success: 72,
      ignored: 168,
      rejected: 504,
      failed: 24,
    },
  };

  const baseOpportunity = {
    lane: "issue-triage",
    source: "github_issue",
    title: "docs: clarify command",
    summary: "docs: clarify command",
    subject_locator: "nilstate/maton#issue/10",
    target_repo: "nilstate/maton",
    is_external: true,
    body_length: 80,
    stale_days: 5,
    age_days: 5,
    memory_records: [],
  };

  const [withOpportunity] = scoreOpportunities({
    opportunities: [
      {
        ...baseOpportunity,
        id: "with-opportunity",
        dossier: {
          default_lanes: ["issue-triage"],
          current_opportunities: [
            {
              lane: "issue-triage",
              summary: "Keep intake bounded and high-signal.",
            },
          ],
          recent_outcomes: [],
        },
      },
    ],
    dossiers: {},
    memory: { history: [], reflections: [] },
    policy,
    now: new Date("2026-04-16T12:00:00Z"),
  });
  const [withoutOpportunity] = scoreOpportunities({
    opportunities: [
      {
        ...baseOpportunity,
        id: "without-opportunity",
        dossier: {
          default_lanes: ["issue-triage"],
          current_opportunities: [],
          recent_outcomes: [],
        },
      },
    ],
    dossiers: {},
    memory: { history: [], reflections: [] },
    policy,
    now: new Date("2026-04-16T12:00:00Z"),
  });

  assert.ok(withOpportunity.metrics.compounding_value > withoutOpportunity.metrics.compounding_value);
  assert.ok(withOpportunity.score > withoutOpportunity.score);
});

test("buildDispatchPlan dispatches curated prerelease opportunities", () => {
  const plan = buildDispatchPlan({
    repo: "nilstate/maton",
    dispatchRef: "main",
    selection: {
      status: "selected",
      reason: "highest_non_vetoed_score",
      priorities: [],
      selected: {
        lane: "issue-triage",
        target_repo: "nilstate/runx",
        subject_locator: "nilstate/runx#pr/101",
        pr_number: "101",
        score: 0.81,
        within_v1_scope: true,
      },
    },
  });

  assert.equal(plan.status, "ready");
  assert.equal(plan.lane, "issue-triage");
  assert.equal(plan.workflow, "issue-triage.yml");
  assert.equal(plan.inputs.target_repo, "nilstate/runx");
  assert.equal(plan.inputs.pr_number, "101");
});

test("runMatonCycle vetoes candidates with an open operator-memory PR", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "maton-open-pr-"));
  const repoRoot = path.join(tempRoot, "repo");
  await mkdir(path.join(repoRoot, "doctrine"), { recursive: true });
  await mkdir(path.join(repoRoot, "state", "targets"), { recursive: true });
  await mkdir(path.join(repoRoot, "history"), { recursive: true });
  await mkdir(path.join(repoRoot, "reflections"), { recursive: true });

  await writeSelectionPolicy(path.join(repoRoot, "state", "selection-policy.json"));

  await writeFile(
    path.join(repoRoot, "state", "targets", "nilstate-runx.md"),
    [
      "---",
      "title: Target Dossier — nilstate/runx",
      "subject_locator: nilstate/runx",
      "---",
      "",
      "# nilstate/runx",
      "",
      "## Default Lanes",
      "",
      "- `issue-triage`",
      "- `issue-triage`",
      "",
    ].join("\n"),
  );

  const discoveryPath = path.join(repoRoot, "discovery.json");
  await writeFile(
    discoveryPath,
    `${JSON.stringify(
      {
        "nilstate/runx": {
          issues: [
            {
              number: 202,
              title: "docs: clarify resolver failure messaging",
              body: "Narrow issue with a bounded next step.",
              url: "https://github.com/nilstate/runx/issues/202",
              authorAssociation: "NONE",
              author: { login: "outside-dev" },
              updatedAt: "2026-04-15T10:00:00Z",
            },
          ],
          prs: [
            {
              number: 101,
              title: "docs: tighten resolver validation",
              body: "Small external PR.",
              url: "https://github.com/nilstate/runx/pull/101",
              isDraft: false,
              authorAssociation: "NONE",
              author: { login: "outside-dev" },
              updatedAt: "2026-04-15T12:00:00Z",
              headRefName: "feature/docs-fix",
            },
          ],
        },
      },
      null,
      2,
    )}\n`,
  );

  const result = await runMatonCycle({
    repoRoot,
    repo: "nilstate/maton",
    discoveryInput: discoveryPath,
    openOperatorMemoryBranches: ["runx/operator-memory-issue-triage-nilstate-runx-pr-101"],
    now: "2026-04-16T12:00:00Z",
  });
  const vetoedPr = result.opportunities.find((entry) => entry.subject_locator === "nilstate/runx#pr/101");

  assert.equal(result.selection.status, "selected");
  assert.equal(result.selection.selected.target_repo, "nilstate/runx");
  assert.equal(result.selection.selected.lane, "issue-triage");
  assert.equal(result.selection.selected.issue_number, "202");
  assert.equal(vetoedPr?.subject_locator, "nilstate/runx#pr/101");
  assert.match(vetoedPr?.veto_reasons.join(",") ?? "", /open_operator_memory_pr/);
  assert.equal(vetoedPr?.within_v1_scope, true);
});

test("runMatonCycle vetoes bot-authored dependency update pull requests", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "maton-bot-pr-"));
  const repoRoot = path.join(tempRoot, "repo");
  await mkdir(path.join(repoRoot, "doctrine"), { recursive: true });
  await mkdir(path.join(repoRoot, "state", "targets"), { recursive: true });
  await mkdir(path.join(repoRoot, "history"), { recursive: true });
  await mkdir(path.join(repoRoot, "reflections"), { recursive: true });

  await writeSelectionPolicy(path.join(repoRoot, "state", "selection-policy.json"));

  await writeFile(
    path.join(repoRoot, "state", "targets", "nilstate-runx.md"),
    [
      "---",
      "title: Target Dossier — nilstate/runx",
      "subject_locator: nilstate/runx",
      "---",
      "",
      "# nilstate/runx",
      "",
      "## Default Lanes",
      "",
      "- `issue-triage`",
      "",
    ].join("\n"),
  );

  const discoveryPath = path.join(repoRoot, "discovery.json");
  await writeFile(
    discoveryPath,
    `${JSON.stringify(
      {
        "nilstate/runx": {
          issues: [
            {
              number: 202,
              title: "docs: clarify resolver failure messaging",
              body: "Narrow issue with a bounded next step.",
              url: "https://github.com/nilstate/runx/issues/202",
              authorAssociation: "NONE",
              author: { login: "outside-dev" },
              updatedAt: "2026-04-15T10:00:00Z",
            },
          ],
          prs: [
            {
              number: 18991,
              title: "Update Rust crate similar to v3",
              body: "Renovate artifact drift.",
              url: "https://github.com/nilstate/runx/pull/18991",
              isDraft: false,
              authorAssociation: "NONE",
              author: { login: "app/renovate" },
              updatedAt: "2026-04-15T12:00:00Z",
              headRefName: "renovate/similar-3.x",
              labels: ["internal", "build:artifacts"],
            },
          ],
        },
      },
      null,
      2,
    )}\n`,
  );

  const result = await runMatonCycle({
    repoRoot,
    repo: "nilstate/maton",
    discoveryInput: discoveryPath,
    now: "2026-04-16T12:00:00Z",
  });
  const vetoedPr = result.opportunities.find((entry) => entry.subject_locator === "nilstate/runx#pr/18991");

  assert.equal(result.selection.status, "selected");
  assert.equal(result.selection.selected.subject_locator, "nilstate/runx#issue/202");
  assert.equal(vetoedPr?.subject_locator, "nilstate/runx#pr/18991");
  assert.match(vetoedPr?.veto_reasons.join(",") ?? "", /bot_authored_pull_request/);
  assert.match(vetoedPr?.veto_reasons.join(",") ?? "", /dependency_update_pull_request/);
  assert.match(vetoedPr?.veto_reasons.join(",") ?? "", /internal_or_build_only_pull_request/);
});

test("runMatonCycle vetoes PR comment candidates without a welcome signal", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "maton-no-welcome-"));
  const repoRoot = path.join(tempRoot, "repo");
  await mkdir(path.join(repoRoot, "doctrine"), { recursive: true });
  await mkdir(path.join(repoRoot, "state", "targets"), { recursive: true });
  await mkdir(path.join(repoRoot, "history"), { recursive: true });
  await mkdir(path.join(repoRoot, "reflections"), { recursive: true });

  await writeSelectionPolicy(path.join(repoRoot, "state", "selection-policy.json"));

  await writeFile(
    path.join(repoRoot, "state", "targets", "nilstate-runx.md"),
    [
      "---",
      "title: Target Dossier — nilstate/runx",
      "subject_locator: nilstate/runx",
      "---",
      "",
      "# nilstate/runx",
      "",
      "## Default Lanes",
      "",
      "- `issue-triage`",
      "",
    ].join("\n"),
  );

  const discoveryPath = path.join(repoRoot, "discovery.json");
  await writeFile(
    discoveryPath,
    `${JSON.stringify(
      {
        "nilstate/runx": {
          issues: [
            {
              number: 12,
              title: "docs: clarify parser behavior",
              body: "Bounded issue.",
              url: "https://github.com/nilstate/runx/issues/12",
              authorAssociation: "NONE",
              author: { login: "outside-dev" },
              updatedAt: "2026-04-15T10:00:00Z",
            },
          ],
          prs: [
            {
              number: 101,
              title: "docs: small parser clarification",
              body: "First-time contributor PR without existing discussion.",
              url: "https://github.com/nilstate/runx/pull/101",
              isDraft: false,
              authorAssociation: "NONE",
              author: { login: "first-timer" },
              updatedAt: "2026-04-15T12:00:00Z",
              headRefName: "docs/parser-clarification",
              labels: ["documentation"],
              comments: 0,
              reviewComments: 0,
            },
          ],
        },
      },
      null,
      2,
    )}\n`,
  );

  const result = await runMatonCycle({
    repoRoot,
    repo: "nilstate/maton",
    discoveryInput: discoveryPath,
    now: "2026-04-16T12:00:00Z",
  });
  const vetoedPr = result.opportunities.find((entry) => entry.subject_locator === "nilstate/runx#pr/101");

  assert.equal(result.selection.status, "selected");
  assert.equal(result.selection.selected.subject_locator, "nilstate/runx#issue/12");
  assert.match(vetoedPr?.veto_reasons.join(",") ?? "", /comment_without_welcome_signal/);
});

test("runMatonCycle enforces severe cooldown after a spam outcome", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "maton-severe-cooldown-"));
  const repoRoot = path.join(tempRoot, "repo");
  await mkdir(path.join(repoRoot, "doctrine"), { recursive: true });
  await mkdir(path.join(repoRoot, "state", "targets"), { recursive: true });
  await mkdir(path.join(repoRoot, "history"), { recursive: true });
  await mkdir(path.join(repoRoot, "reflections"), { recursive: true });

  await writeSelectionPolicy(path.join(repoRoot, "state", "selection-policy.json"));

  await writeFile(
    path.join(repoRoot, "state", "targets", "nilstate-runx.md"),
    [
      "---",
      "title: Target Dossier — nilstate/runx",
      "subject_locator: nilstate/runx",
      "---",
      "",
      "# nilstate/runx",
      "",
      "## Default Lanes",
      "",
      "- `issue-triage`",
      "",
      "## Recent Outcomes",
      "",
      "- 2026-04-16 · `issue-triage` · `spam` · public comment was minimized as spam.",
      "",
    ].join("\n"),
  );

  const discoveryPath = path.join(repoRoot, "discovery.json");
  await writeFile(
    discoveryPath,
    `${JSON.stringify(
      {
        "nilstate/runx": {
          issues: [
            {
              number: 202,
              title: "docs: clarify resolver failure messaging",
              body: "Narrow issue with a bounded next step.",
              url: "https://github.com/nilstate/runx/issues/202",
              authorAssociation: "NONE",
              author: { login: "outside-dev" },
              updatedAt: "2026-04-16T10:00:00Z",
            },
          ],
          prs: [],
        },
      },
      null,
      2,
    )}\n`,
  );

  const result = await runMatonCycle({
    repoRoot,
    repo: "nilstate/maton",
    discoveryInput: discoveryPath,
    now: "2026-04-17T12:00:00Z",
  });
  const blockedIssue = result.opportunities.find((entry) => entry.subject_locator === "nilstate/runx#issue/202");

  assert.ok(result.selection.status === "no_op" || result.selection.selected?.lane !== "issue-triage");
  assert.match(blockedIssue?.veto_reasons.join(",") ?? "", /cooldown:severe_/);
  assert.match(blockedIssue?.veto_reasons.join(",") ?? "", /comment_lane_in_trust_recovery/);
});
