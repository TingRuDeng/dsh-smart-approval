# Changelog

All notable user-facing changes to `dsh-smart-approval` are documented here.
This project is in developer preview, so release candidates may still change
before `0.1.0`.

## [0.1.0-rc.12] - 2026-10-18

- Align with DeepSeek Harness `0.2.1-rc.2` (adjacent source checkout at tag
  `dsh-v0.2.1-rc.2`, plus the published `0.2.1-rc.2` packages on npm `next`).
  Peer ranges move to `~0.2.1-alpha.2` for the `dsh-*` packages and
  `~4.0.5-alpha.1` for `@deepseek-ai/cordis`; prerelease ranges cannot span two
  different `major.minor.patch` tuples, so the `0.2.0-rc.2` release that npm
  `latest` still serves is out of scope for this candidate.
- Build the reviewer context from committed `session/event` pushes instead of
  reading Session event history. `Session.events` was removed by DSH and
  `snapshotEvents`/`eventAt`/`ownEvents` are deprecated and closed to new
  callers, so this removes the plugin's dependency on all four.
- Add `src/session-context.ts`: a bounded, per-session, in-memory fold that
  indexes the exact `tool/call` arguments for the turn in force and keeps the
  current turn's direct-user text separate from bounded earlier history. It is
  never persisted, and the host's `session/disposed` signal releases it.
- Keep the decision rules unchanged wherever the same evidence is available.
  A request is only reviewed when exactly one tracked call matches its `callId`
  and that call belongs to the turn a `turn/start` opened; anything else fails
  closed to a human answerer. New `maxTrackedToolCalls` (default `32`) bounds
  the per-turn call index.
- Drop the pre-release compatibility layer. The legacy `smart-approval/mode`
  event, the `smart-approval`/`unattended` permission-preset migration, the
  mode-projection `origin`/`fallback` fields, and the `permissionPresets`
  dependency are gone; the mode-projection `stateVersion` moves to `4`, so
  cached fold rows are discarded and refolded from the log.
- Fold a resumed or forked Session's seed at announcement. DSH never publishes
  constructor seed events on `session/event`, so history installed before the
  observer attached would otherwise leave the tracker empty and hand every
  approval in a resumed session to a human. This is the plugin's only remaining
  history read: exactly one bounded `snapshotEvents(0, firstLiveSeq)` per
  announced session, not a per-request scan.
- Remove the now-unused `@deepseek-ai/dsh-permission-presets` peer and dev
  dependency, and the `sessions` service dependency.
- Declare `engines.dsh` as well as the peers. DSH `0.2.1-alpha.3` made
  `engines.dsh` the authoritative compatibility range: when it is present, the
  host ignores the dsh peers and checks that range alone. Both carry the same
  `~0.2.1-alpha.2`, so the accepted window is unchanged today and future bumps
  have one place to land.
- Pin CI and the release workflow's Harness checkout to `687f282e86`
  (`dsh-v0.2.1-rc.2`) instead of the `dsh-v0.2.1-alpha.2` commit, so the formal
  tarball and its DSH install smoke are built against the baseline the peers
  declare.
- Make CI check this plugin against that same Harness checkout. It previously
  installed only this repository, so `tsc` could not resolve any
  `@deepseek-ai/dsh-*` type and the job failed for an unrelated reason on every
  run since `0.1.0-rc.10`.
- Add `tests/host-integration.spec.ts`: a real Cordis context, real
  `SessionStore`, real `ApprovalService`, and the real JSON storage domain drive
  the plugin end to end. It covers a live append, a resumed session, and the
  fail-closed path, so the append-to-approval ordering is now enforced by a test
  rather than by reasoning about the source.
- Note what the host's compatibility check actually admits. DSH evaluates ranges
  with `includePrerelease`, so it also admits `0.2.2-alpha.1` for a
  `~0.2.1-alpha.2` declaration; the declared range, not the host check, stays the
  supported contract, and any `0.2.2` baseline still needs its own verification.

## [0.1.0-rc.11] - 2026-08-31

- Reissue the DeepSeek Harness `0.1.2-alpha.2` compatibility candidate after
  npm accepted `0.1.0-rc.10` but its release verification observed a transient
  registry tarball `404` during propagation.
- Retry transient npm tarball `404` responses before checking the published
  bytes against the attested release digest.

## [0.1.0-rc.10] - 2026-08-31

- Align and verify the host and browser contracts against DeepSeek Harness
  `0.1.2-alpha.2` at official commit
  `0a53fb55bea101816fa226bb964ae2bed71c343b`.
- Require Cordis `^4.0.2` so the plugin and Harness share the same nominal
  context and event types.
- Replace the removed client runtime type surface with the Cordis context,
  session, renderer, and UI-session contracts used by the current Client
  assembly.
- Build and test against the adjacent Harness checkout so unpublished alpha
  packages cannot be mistaken for registry-resolvable dependencies.

## [0.1.0-rc.9] - 2026-08-23

- Reissue the formal release candidate with npm Trusted Publishing enabled for
  the GitHub Actions release workflow; runtime behavior remains aligned with
  `0.1.0-rc.8`.

## [0.1.0-rc.8] - 2026-08-21

- Require DeepSeek Harness `0.1.1-rc.1` or later and migrate the review-mode
  projection to the host-state and client-wire registration API introduced in
  that release.
- Validate persisted review-mode fold state independently from the browser
  projection payload.
- Verify the plugin against DeepSeek Harness `0.1.1-rc.2`; development
  dependencies and the lockfile now pin that release candidate.

## [0.1.0-rc.7] - 2026-08-19

- Persist every automatic decision in a Session-bound `decisions` storage table
  and expose it in-session through `/approval-log` (latest 10 by default,
  `/approval-log 30` for more). Entries carry only time, tool name, outcome,
  reason code, review mode, and tool-call id; `decisionLogSize: 0` disables
  the audit.
- Keep the audit strictly side-channel: a failed audit write never changes the
  approval outcome, and manual mode writes nothing.
- Open older same-version `smart_approval` media unchanged: the new table is
  additive, so existing mode rows keep working without a storage-format bump.

## [0.1.0-rc.6] - 2026-08-16

- Document the residual file-target TOCTOU window and the different containment
  guarantees of `workspace-write` and `danger-full-access`.
- Clarify how bounded user history, deterministic local prechecks, model
  classification, and closed local decision mapping work together.
- Add this changelog to the published package contents.

## [0.1.0-rc.5] - 2026-08-15

- Review each `bash`, `pwsh`, `write`, and `edit` request independently against
  the current action and bounded recent direct-user context.
- Add read-only file-target inspection and deterministic fail-closed checks for
  credentials, sensitive paths, symbolic links, destructive operations, remote
  writes, publishing, and incomplete evidence.
- Replace the binary reviewer response with a strict risk, authorization,
  intent, and reason-code classification that is mapped locally to the three
  review modes.
- Allow repeated safe actions without repeated clicks when each action remains
  within the user's stated intent; no allowlist, cache, or persistent grant is
  created.

## [0.1.0-rc.4] - 2026-08-15

- Store the selected review mode in a session-bound DSH storage sidecar instead
  of writing plugin-defined session event types.
- Migrate legacy review-mode events and early permission presets without
  modifying the original permission history.
- Keep browser projection and command results consistent with persisted mode
  changes and session lifecycles.

## [0.1.0-rc.3] - 2026-08-15

- Split DSH access permission and automatic review into two independent Web
  selectors.
- Add Manual approval, Smart approval, and Unattended modes without replacing
  the profile's native permission presets.
- Add browser registration, localized labels, and projection tests for the
  independent review selector.

## [0.1.0-rc.2] - 2026-08-15

- Add English and Simplified Chinese usage and security documentation.
- Publish the preview package with corrected registry metadata.

## [0.1.0-rc.1] - 2026-08-15

- Introduce the fail-closed LLM-assisted approval waterfall for DeepSeek
  Harness.
- Add deterministic policy checks, strict reviewer parsing, timeout and abort
  handling, three-mode routing, tests, CI, and the initial plugin bundle.
