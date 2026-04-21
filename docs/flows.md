---
title: Hosted Flows
description: The concrete GitHub workflows that make aster a live runx proving-ground target.
---

# Hosted Flows

## `site-pages`

Builds and deploys `aster.runx.ai` from repo-owned operator content. This
keeps the public site live even when the external caller bridge is offline.

## `issue-triage`

This lane has two entry modes:

1. issue mode listens for every normal issue except `[skill]` proposals, runs
   `support-triage`, prepares one explicit triage decision, optionally runs
   `objective-decompose`, posts or updates one rolling triage comment back to
   the same issue, and starts isolated `issue-to-pr` workers only when thread
   teaching authorizes bounded build work. Trusted maintainer replies on that
   work issue are amendments to the living ledger and retrigger triage from the
   refreshed issue-ledger packet rather than from the stale issue body alone.
   Replay guard blocks duplicate reruns for the same ledger fingerprint, and
   the live issue or PR thread is also parsed for reusable lessons, norms, and
   explicit gate authorizations
2. PR mode builds a live PR snapshot, runs it through `github-triage`, and
   posts a maintainer comment back to the PR. Public-value and replay gates
   block low-signal or duplicate comments for the same head SHA. Generated
   derived-state refresh PRs are blocked before model work because they
   are review surfaces, not new triage subjects

## `evidence-projection-derive`

This lane is the only repo-owned evidence projection lane.

It downloads uploaded workflow artifacts from `issue-triage` and `skill-lab`,
records the processed artifact ids and projection groups in
`state/evidence-projections.json`, dedupes repeated retries onto one latest
projection per bounded objective, and updates one rolling draft PR instead of
spawning one PR per event.

Public projection is narrower than runtime memory:

- `state/evidence-projections.json` keeps the broad artifact-backed runtime and
  training projection
- only durable or teaching-bearing records are promoted into `history/`,
  `reflections/`, and target dossiers
- generic low-signal rows such as bare `lane finished with success` completions
  stay in evidence state only so the rolling PR remains compact
- when a derive run only compacts `state/evidence-projections.json` and carries
  zero public projection deltas, publication is treated as a semantic noop and
  the rolling PR is closed instead of being reopened for learned-state churn

The rolling branch is reset from `main` on every derive run, then rebuilt from
artifact evidence and force-pushed as a derived review surface. The PR body and
uploaded artifact bundle carry a latest-batch summary so reviewers can inspect
the current derive pass without treating the whole open diff as one opaque
change.

## `fix-pr`

Runs on manual dispatch for one bounded bugfix work issue. The workflow reads
the living issue ledger, normalizes it into the governed issue-to-PR contract,
runs the repo through the shared worker path, validates with the target's
verification profile, opens or refreshes one draft `runx/*` PR plus receipts,
and posts a rolling machine status comment back into the same work issue.
Publication is hard-gated by thread teaching on that same work issue through
`fix-pr.publish`.

## `docs-pr`

Runs on manual dispatch for one bounded docs or explanation work issue. The
workflow uses the same governed PR runner as `fix-pr`, but tightens the request
to docs-only changes before validation and draft PR publication. Publication is
hard-gated by thread teaching on that same work issue through
`docs-pr.publish`. Hosted provider work writes live trace files while the lane
is running and the workflow step carries an explicit timeout.

## `skill-lab`

Listens for issues whose title begins with `[skill]`, runs
`objective-to-skill`, materializes the result under `docs/skill-proposals/`,
opens or refreshes one draft PR with the generated proposal, and posts or
updates one rolling issue comment back onto the same skill issue. Trusted
maintainer replies on that issue retrigger skill-lab from the refreshed
issue-ledger packet so the proposal evolves inside one work thread.

## `skill-upstream`

Runs on manual dispatch for one upstream work issue. The workflow reads the
living issue ledger, checks out the target repo named in that issue, prepares a
portable upstream `SKILL.md`, validates the contribution artifacts and public
language, uploads the artifact packet, and posts a rolling machine status
comment back to the same work issue. If that thread already authorizes
`skill-upstream.publish`, the workflow also opens or refreshes one draft PR
against the target repo; otherwise it remains proposal-only until the same
issue is amended and rerun.

The first proving-ground target is `nilstate/icey-cli`.

## `merge-watch`

Runs on schedule or manual dispatch, checks whether an upstream `SKILL.md`
contribution has moved, and emits the updated state plus any registry-binding
request packet.

## `proving-ground`

Runs bounded `runx` catalog calls against the repo to surface receipt,
governance, and evidence-quality drift.

## `generated-pr-policy`

Runs on generated `runx/*` pull requests and enforces the draft-only,
human-reviewed merge policy in the PR body and draft state.

## `rollback`

Runs only on manual dispatch and posts a corrective public comment or closes a
generated PR when an earlier aster output must be superseded.
