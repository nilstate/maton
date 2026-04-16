import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";

import {
  buildDispatchPlan,
  discoverOpportunities,
  loadScoringPolicy,
  runAutomatonCycle,
  scoreOpportunities,
  selectOpportunity,
} from "./automaton-cycle.mjs";

test("loadScoringPolicy parses weights, thresholds, and cooldowns", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "automaton-scoring-"));
  const scoringPath = path.join(tempRoot, "SCORING.md");
  await writeFile(
    scoringPath,
    [
      "# Automaton Scoring Policy",
      "",
      "- `stranger_value`: `0.24`",
      "- `proof_strength`: `0.24`",
      "- `compounding_value`: `0.19`",
      "- `tractability`: `0.16`",
      "- `novelty`: `0.09`",
      "- `maintenance_efficiency`: `0.08`",
      "",
      "- `stranger_value < 0.60`",
      "- `proof_strength < 0.70`",
      "If the top non-vetoed candidate scores below `0.68`, prefer `no_op`.",
      "",
      "- `completed`, `success`, `merged`, `published`: `72h`",
      "- `noop`, `ignored`, `stale`, `silence`: `7d`",
      "- `rejected`, `corrected`: `21d`",
      "- `failed`, `error`: `24h`",
      "",
    ].join("\n"),
  );

  const policy = await loadScoringPolicy(scoringPath);

  assert.equal(policy.weights.stranger_value, 0.24);
  assert.equal(policy.thresholds.stranger_value_min, 0.6);
  assert.equal(policy.thresholds.minimum_select_score, 0.68);
  assert.equal(policy.cooldown_hours.success, 72);
  assert.equal(policy.cooldown_hours.ignored, 168);
});

test("discover, score, and select curated external targets inside prerelease v1", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "automaton-cycle-"));
  const repoRoot = path.join(tempRoot, "repo");
  await mkdir(path.join(repoRoot, "doctrine"), { recursive: true });
  await mkdir(path.join(repoRoot, "state", "targets"), { recursive: true });
  await mkdir(path.join(repoRoot, "history"), { recursive: true });
  await mkdir(path.join(repoRoot, "reflections"), { recursive: true });

  await writeFile(
    path.join(repoRoot, "doctrine", "SCORING.md"),
    [
      "# Automaton Scoring Policy",
      "",
      "- `stranger_value`: `0.24`",
      "- `proof_strength`: `0.24`",
      "- `compounding_value`: `0.19`",
      "- `tractability`: `0.16`",
      "- `novelty`: `0.09`",
      "- `maintenance_efficiency`: `0.08`",
      "",
      "- `stranger_value < 0.60`",
      "- `proof_strength < 0.70`",
      "If the top non-vetoed candidate scores below `0.68`, prefer `no_op`.",
      "",
      "- `completed`, `success`, `merged`, `published`: `72h`",
      "- `noop`, `ignored`, `stale`, `silence`: `7d`",
      "- `rejected`, `corrected`: `21d`",
      "- `failed`, `error`: `24h`",
      "",
    ].join("\n"),
  );

  await writeFile(
    path.join(repoRoot, "state", "targets", "nilstate-automaton.md"),
    [
      "---",
      "title: Target Dossier — nilstate/automaton",
      "subject_locator: nilstate/automaton",
      "---",
      "",
      "# nilstate/automaton",
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
      "- `issue-triage`",
      "",
    ].join("\n"),
  );

  const discoveryPath = path.join(repoRoot, "discovery.json");
  await writeFile(
    discoveryPath,
    `${JSON.stringify(
      {
        "nilstate/automaton": {
          issues: [],
          prs: [],
        },
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

  const result = await runAutomatonCycle({
    repoRoot,
    repo: "nilstate/automaton",
    discoveryInput: discoveryPath,
    now: "2026-04-16T12:00:00Z",
  });

  assert.equal(result.selection.status, "selected");
  assert.equal(result.selection.selected.target_repo, "vercel/next.js");
  assert.equal(result.selection.selected.lane, "issue-triage");
  assert.match(result.selection.priorities[0].subject_locator, /vercel\/next\.js#pr\/101/);
  assert.equal(result.selection.priorities[0].within_v1_scope, true);
  assert.equal(result.selection.priorities[0].vetoed, false);
  assert.equal(result.automaton_control.targets.length >= 2, true);
  assert.equal(result.automaton_control.opportunities[0].opportunity_id, result.opportunities[0].id);
  assert.equal(result.automaton_control.cycle_records[0].status, "selected");
  assert.equal(result.automaton_control.priorities[0].status, "selected");
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
      subject_locator: "nilstate/automaton",
      target_repo: "nilstate/automaton",
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
      "nilstate-automaton": opportunities[0].dossier,
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
    subject_locator: "nilstate/automaton#issue/10",
    target_repo: "nilstate/automaton",
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

test("buildDispatchPlan dispatches curated external opportunities", () => {
  const plan = buildDispatchPlan({
    repo: "nilstate/automaton",
    dispatchRef: "main",
    selection: {
      status: "selected",
      reason: "highest_non_vetoed_score",
      priorities: [],
      selected: {
        lane: "issue-triage",
        target_repo: "vercel/next.js",
        subject_locator: "vercel/next.js#pr/101",
        pr_number: "101",
        score: 0.81,
      },
    },
  });

  assert.equal(plan.status, "ready");
  assert.equal(plan.lane, "issue-triage");
  assert.equal(plan.workflow, "issue-triage.yml");
  assert.equal(plan.inputs.target_repo, "vercel/next.js");
  assert.equal(plan.inputs.pr_number, "101");
});

test("runAutomatonCycle vetoes candidates with an open operator-memory PR", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "automaton-open-pr-"));
  const repoRoot = path.join(tempRoot, "repo");
  await mkdir(path.join(repoRoot, "doctrine"), { recursive: true });
  await mkdir(path.join(repoRoot, "state", "targets"), { recursive: true });
  await mkdir(path.join(repoRoot, "history"), { recursive: true });
  await mkdir(path.join(repoRoot, "reflections"), { recursive: true });

  await writeFile(
    path.join(repoRoot, "doctrine", "SCORING.md"),
    [
      "# Automaton Scoring Policy",
      "",
      "- `stranger_value`: `0.24`",
      "- `proof_strength`: `0.24`",
      "- `compounding_value`: `0.19`",
      "- `tractability`: `0.16`",
      "- `novelty`: `0.09`",
      "- `maintenance_efficiency`: `0.08`",
      "",
      "- `stranger_value < 0.60`",
      "- `proof_strength < 0.70`",
      "If the top non-vetoed candidate scores below `0.68`, prefer `no_op`.",
      "",
      "- `completed`, `success`, `merged`, `published`: `72h`",
      "- `noop`, `ignored`, `stale`, `silence`: `7d`",
      "- `rejected`, `corrected`: `21d`",
      "- `failed`, `error`: `24h`",
      "",
    ].join("\n"),
  );

  await writeFile(
    path.join(repoRoot, "state", "targets", "astral-sh-uv.md"),
    [
      "---",
      "title: Target Dossier — astral-sh/uv",
      "subject_locator: astral-sh/uv",
      "---",
      "",
      "# astral-sh/uv",
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
        "astral-sh/uv": {
          issues: [
            {
              number: 202,
              title: "docs: clarify resolver failure messaging",
              body: "Narrow issue with a bounded next step.",
              url: "https://github.com/astral-sh/uv/issues/202",
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
              url: "https://github.com/astral-sh/uv/pull/101",
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

  const result = await runAutomatonCycle({
    repoRoot,
    repo: "nilstate/automaton",
    discoveryInput: discoveryPath,
    openOperatorMemoryBranches: ["runx/operator-memory-issue-triage-astral-sh-uv-pr-101"],
    now: "2026-04-16T12:00:00Z",
  });
  const vetoedPr = result.opportunities.find((entry) => entry.subject_locator === "astral-sh/uv#pr/101");

  assert.equal(result.selection.status, "selected");
  assert.equal(result.selection.selected.target_repo, "astral-sh/uv");
  assert.equal(result.selection.selected.lane, "issue-triage");
  assert.equal(result.selection.selected.issue_number, "202");
  assert.equal(vetoedPr?.subject_locator, "astral-sh/uv#pr/101");
  assert.match(vetoedPr?.veto_reasons.join(",") ?? "", /open_operator_memory_pr/);
  assert.equal(vetoedPr?.within_v1_scope, true);
});

test("runAutomatonCycle vetoes bot-authored dependency update pull requests", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "automaton-bot-pr-"));
  const repoRoot = path.join(tempRoot, "repo");
  await mkdir(path.join(repoRoot, "doctrine"), { recursive: true });
  await mkdir(path.join(repoRoot, "state", "targets"), { recursive: true });
  await mkdir(path.join(repoRoot, "history"), { recursive: true });
  await mkdir(path.join(repoRoot, "reflections"), { recursive: true });

  await writeFile(
    path.join(repoRoot, "doctrine", "SCORING.md"),
    [
      "# Automaton Scoring Policy",
      "",
      "- `stranger_value`: `0.24`",
      "- `proof_strength`: `0.24`",
      "- `compounding_value`: `0.19`",
      "- `tractability`: `0.16`",
      "- `novelty`: `0.09`",
      "- `maintenance_efficiency`: `0.08`",
      "",
      "- `stranger_value < 0.60`",
      "- `proof_strength < 0.70`",
      "If the top non-vetoed candidate scores below `0.68`, prefer `no_op`.",
      "",
      "- `completed`, `success`, `merged`, `published`: `72h`",
      "- `noop`, `ignored`, `stale`, `silence`: `7d`",
      "- `rejected`, `corrected`: `21d`",
      "- `failed`, `error`: `24h`",
      "",
    ].join("\n"),
  );

  await writeFile(
    path.join(repoRoot, "state", "targets", "astral-sh-uv.md"),
    [
      "---",
      "title: Target Dossier — astral-sh/uv",
      "subject_locator: astral-sh/uv",
      "---",
      "",
      "# astral-sh/uv",
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
        "astral-sh/uv": {
          issues: [
            {
              number: 202,
              title: "docs: clarify resolver failure messaging",
              body: "Narrow issue with a bounded next step.",
              url: "https://github.com/astral-sh/uv/issues/202",
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
              url: "https://github.com/astral-sh/uv/pull/18991",
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

  const result = await runAutomatonCycle({
    repoRoot,
    repo: "nilstate/automaton",
    discoveryInput: discoveryPath,
    now: "2026-04-16T12:00:00Z",
  });
  const vetoedPr = result.opportunities.find((entry) => entry.subject_locator === "astral-sh/uv#pr/18991");

  assert.equal(result.selection.status, "selected");
  assert.equal(result.selection.selected.subject_locator, "astral-sh/uv#issue/202");
  assert.equal(vetoedPr?.subject_locator, "astral-sh/uv#pr/18991");
  assert.match(vetoedPr?.veto_reasons.join(",") ?? "", /bot_authored_pull_request/);
  assert.match(vetoedPr?.veto_reasons.join(",") ?? "", /dependency_update_pull_request/);
  assert.match(vetoedPr?.veto_reasons.join(",") ?? "", /internal_or_build_only_pull_request/);
});

test("runAutomatonCycle vetoes PR comment candidates without a welcome signal", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "automaton-no-welcome-"));
  const repoRoot = path.join(tempRoot, "repo");
  await mkdir(path.join(repoRoot, "doctrine"), { recursive: true });
  await mkdir(path.join(repoRoot, "state", "targets"), { recursive: true });
  await mkdir(path.join(repoRoot, "history"), { recursive: true });
  await mkdir(path.join(repoRoot, "reflections"), { recursive: true });

  await writeFile(
    path.join(repoRoot, "doctrine", "SCORING.md"),
    [
      "# Automaton Scoring Policy",
      "",
      "- `stranger_value`: `0.24`",
      "- `proof_strength`: `0.24`",
      "- `compounding_value`: `0.19`",
      "- `tractability`: `0.16`",
      "- `novelty`: `0.09`",
      "- `maintenance_efficiency`: `0.08`",
      "",
      "- `stranger_value < 0.60`",
      "- `proof_strength < 0.70`",
      "If the top non-vetoed candidate scores below `0.68`, prefer `no_op`.",
      "",
      "- `completed`, `success`, `merged`, `published`: `72h`",
      "- `noop`, `ignored`, `stale`, `silence`: `7d`",
      "- `rejected`, `corrected`: `21d`",
      "- `spam`, `minimized`, `harmful`: `90d`",
      "- `failed`, `error`: `24h`",
      "",
    ].join("\n"),
  );

  await writeFile(
    path.join(repoRoot, "state", "targets", "biomejs-biome.md"),
    [
      "---",
      "title: Target Dossier — biomejs/biome",
      "subject_locator: biomejs/biome",
      "---",
      "",
      "# biomejs/biome",
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
        "biomejs/biome": {
          issues: [
            {
              number: 12,
              title: "docs: clarify parser behavior",
              body: "Bounded issue.",
              url: "https://github.com/biomejs/biome/issues/12",
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
              url: "https://github.com/biomejs/biome/pull/101",
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

  const result = await runAutomatonCycle({
    repoRoot,
    repo: "nilstate/automaton",
    discoveryInput: discoveryPath,
    now: "2026-04-16T12:00:00Z",
  });
  const vetoedPr = result.opportunities.find((entry) => entry.subject_locator === "biomejs/biome#pr/101");

  assert.equal(result.selection.status, "selected");
  assert.equal(result.selection.selected.subject_locator, "biomejs/biome#issue/12");
  assert.match(vetoedPr?.veto_reasons.join(",") ?? "", /comment_without_welcome_signal/);
});

test("runAutomatonCycle enforces severe cooldown after a spam outcome", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "automaton-severe-cooldown-"));
  const repoRoot = path.join(tempRoot, "repo");
  await mkdir(path.join(repoRoot, "doctrine"), { recursive: true });
  await mkdir(path.join(repoRoot, "state", "targets"), { recursive: true });
  await mkdir(path.join(repoRoot, "history"), { recursive: true });
  await mkdir(path.join(repoRoot, "reflections"), { recursive: true });

  await writeFile(
    path.join(repoRoot, "doctrine", "SCORING.md"),
    [
      "# Automaton Scoring Policy",
      "",
      "- `stranger_value`: `0.24`",
      "- `proof_strength`: `0.24`",
      "- `compounding_value`: `0.19`",
      "- `tractability`: `0.16`",
      "- `novelty`: `0.09`",
      "- `maintenance_efficiency`: `0.08`",
      "",
      "- `stranger_value < 0.60`",
      "- `proof_strength < 0.70`",
      "If the top non-vetoed candidate scores below `0.68`, prefer `no_op`.",
      "",
      "- `completed`, `success`, `merged`, `published`: `72h`",
      "- `noop`, `ignored`, `stale`, `silence`: `7d`",
      "- `rejected`, `corrected`: `21d`",
      "- `spam`, `minimized`, `harmful`: `90d`",
      "- `failed`, `error`: `24h`",
      "",
    ].join("\n"),
  );

  await writeFile(
    path.join(repoRoot, "state", "targets", "astral-sh-uv.md"),
    [
      "---",
      "title: Target Dossier — astral-sh/uv",
      "subject_locator: astral-sh/uv",
      "---",
      "",
      "# astral-sh/uv",
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
        "astral-sh/uv": {
          issues: [
            {
              number: 202,
              title: "docs: clarify resolver failure messaging",
              body: "Narrow issue with a bounded next step.",
              url: "https://github.com/astral-sh/uv/issues/202",
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

  const result = await runAutomatonCycle({
    repoRoot,
    repo: "nilstate/automaton",
    discoveryInput: discoveryPath,
    now: "2026-04-17T12:00:00Z",
  });
  const blockedIssue = result.opportunities.find((entry) => entry.subject_locator === "astral-sh/uv#issue/202");

  assert.ok(result.selection.status === "no_op" || result.selection.selected?.lane !== "issue-triage");
  assert.match(blockedIssue?.veto_reasons.join(",") ?? "", /cooldown:severe_/);
  assert.match(blockedIssue?.veto_reasons.join(",") ?? "", /comment_lane_in_trust_recovery/);
});
