# Changelog

All notable user-facing changes to `dsh-smart-approval` are documented here.
This project is in developer preview, so release candidates may still change
before `0.1.0`.

## [0.1.0-rc.8] - 2026-08-21

- Require DeepSeek Harness `0.1.1-rc.1` or later and migrate the review-mode
  projection to the host-state and client-wire registration API introduced in
  that release.
- Validate persisted review-mode fold state independently from the browser
  projection payload.

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
