import test from "node:test";
import assert from "node:assert/strict";

import {
  CONTROL_SCHEMA_REFS,
  collectWorkerValidationIssues,
  normalizeAutomationBranchName,
  normalizeWorkerRequest,
  normalizeIssueToPrRequest,
  normalizeWorkspaceChangePlanRequest,
  resolveVerificationPlan,
  validateVerificationProfileCatalog,
} from "./maton-v1-contracts.mjs";
import { loadRunxControlSchemaSync } from "./runx-control-schemas.mjs";

const catalog = validateVerificationProfileCatalog({
  version: "runx.verification_profile_catalog.v1",
  repo_defaults: {
    "nilstate/maton": "maton.site-ci",
  },
  profiles: {
    "maton.site-ci": {
      repo: "nilstate/maton",
      description: "Run the site CI checks.",
      commands: ["npm run site:ci"],
    },
  },
});

test("normalizeIssueToPrRequest applies the repo default verification profile", () => {
  const request = normalizeIssueToPrRequest(
    {
      issue_title: "Fix docs drift",
      source: "github_issue",
      source_id: "101",
    },
    {
      defaultRepo: "nilstate/maton",
      catalog,
    },
  );

  assert.equal(request.target_repo, "nilstate/maton");
  assert.equal(request.verification_profile, "maton.site-ci");
});

test("normalizeIssueToPrRequest rejects out-of-scope repos", () => {
  assert.throws(() => {
    normalizeIssueToPrRequest(
      {
        issue_title: "Fix docs drift",
        source: "github_issue",
        source_id: "101",
        target_repo: "vercel/next.js",
      },
      { catalog },
    );
  }, /outside prerelease v1 scope/);
});

test("normalizeIssueToPrRequest preserves an explicit verification profile when no catalog is provided", () => {
  const request = normalizeIssueToPrRequest({
    issue_title: "Fix docs drift",
    source: "github_issue",
    source_id: "101",
    verification_profile: "maton.site-ci",
  }, {
    defaultRepo: "nilstate/maton",
  });

  assert.equal(request.verification_profile, "maton.site-ci");
  assert.ok(!Object.hasOwn(request, "validation_commands"));
});

test("normalizeIssueToPrRequest rejects direct publication branches outside runx/*", () => {
  assert.throws(() => {
    normalizeIssueToPrRequest({
      issue_title: "Fix docs drift",
      source: "github_issue",
      source_id: "101",
      branch: "main",
    }, {
      defaultRepo: "nilstate/maton",
      catalog,
    });
  }, /issue_to_pr_request\.branch/);
});

test("normalizeAutomationBranchName accepts bounded automation branches", () => {
  assert.equal(
    normalizeAutomationBranchName("runx/issue-101-docs-drift"),
    "runx/issue-101-docs-drift",
  );
});

test("resolveVerificationPlan maps legacy validation commands onto a declared profile", () => {
  const resolved = resolveVerificationPlan({
    catalog,
    targetRepo: "nilstate/maton",
    issueToPrRequest: {
      issue_title: "Fix docs drift",
      source: "github_issue",
      source_id: "101",
      validation_commands: ["npm run site:ci"],
    },
  });

  assert.equal(resolved.profile_id, "maton.site-ci");
  assert.equal(resolved.compatibility_mode, "legacy_validation_command_mapping");
  assert.deepEqual(resolved.commands, ["npm run site:ci"]);
});

test("collectWorkerValidationIssues filters invalid worker requests", () => {
  const result = collectWorkerValidationIssues(
    [
      {
        worker: "issue-to-pr",
        issue_to_pr_request: {
          issue_title: "Fix docs drift",
          source: "github_issue",
          source_id: "101",
        },
      },
      {
        worker: "issue-to-pr",
        issue_to_pr_request: {
          issue_title: "Cross-repo mutation",
          source: "github_issue",
          source_id: "102",
          target_repo: "acme/api",
        },
      },
    ],
    {
      defaultRepo: "nilstate/maton",
      catalog,
    },
  );

  assert.equal(result.accepted.length, 1);
  assert.equal(result.issues.length, 1);
  assert.match(result.issues[0], /outside prerelease v1 scope/);
});

test("normalizeWorkerRequest rejects schema-invalid extra properties", () => {
  assert.throws(() => {
    normalizeWorkerRequest({
      worker: "issue-to-pr",
      issue_to_pr_request: {
        issue_title: "Fix docs drift",
        source: "github_issue",
        source_id: "101",
      },
      target_repo: "nilstate/maton",
    }, {
      defaultRepo: "nilstate/maton",
      catalog,
    });
  }, /worker-request\.schema\.json/);
});

test("normalizeWorkspaceChangePlanRequest preserves structured target surfaces", () => {
  const request = normalizeWorkspaceChangePlanRequest(
    {
      objective: "Roll out the docs fix",
      project_context: "maton workspace",
      target_surfaces: [
        {
          surface: "nilstate/maton",
          kind: "repo",
          mutating: true,
          rationale: "Single prerelease repo scope.",
        },
      ],
      shared_invariants: ["No external mutation."],
      success_criteria: ["One bounded plan exists before changes start."],
    },
    {
      targetRepo: "nilstate/maton",
    },
  );

  assert.equal(request.target_surfaces.length, 1);
  assert.equal(request.target_surfaces[0].surface, "nilstate/maton");
  assert.equal(request.target_surfaces[0].mutating, true);
});

test("local runx control schema mirrors stay aligned with the published schema ids", () => {
  for (const [name, ref] of Object.entries(CONTROL_SCHEMA_REFS)) {
    const schema = loadRunxControlSchemaSync(name);
    assert.equal(schema.$id, ref);
  }
});
