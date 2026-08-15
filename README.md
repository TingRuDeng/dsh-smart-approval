# dsh-smart-approval

English | [中文](README.zh.md)

`dsh-smart-approval` is a fail-closed approval plugin for
[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness). It adds
three approval modes on top of the same `workspace-write` sandbox: manual,
smart, and unattended. Smart approval is the recommended default.

The plugin reuses the current session's provider and model unless an independent
review route is configured. Switching modes takes effect on the next approval
request and does not require restarting DSH.

> [!WARNING]
> This project and DSH are both in developer preview. Review the security
> boundaries below and pin exact versions in reproducible environments.

## Approval modes

| Mode | Safe request | High-risk or uncertain | Clearly malicious |
|---|---|---|---|
| Workspace Write · Manual | Ask a human | Ask a human | Ask a human |
| Workspace Write · Smart (recommended) | Allow once | Ask a human | Reject |
| Workspace Write · Unattended | Allow once | Reject | Reject |

All three modes use `sandbox: workspace-write` and `approval: ask`. The `ask`
setting sends approval requests through DSH's `approval/request` waterfall;
this plugin then decides whether to allow once, delegate to the next human
answerer, or reject. Manual mode bypasses the reviewer immediately and does not
read tool arguments or user authorization context.

## Install

### Requirements

- Node.js 24 or later.
- DeepSeek Harness `>=0.1.0-rc.5 <0.2.0`.
- `pnpm` on `PATH`; DSH forwards plugin-management operations to pnpm.

The currently published plugin version is `0.1.0-rc.1`. Install it with an
already-installed DSH CLI:

```sh
npm install --global @deepseek-ai/dsh@0.1.0-rc.6
dsh plugin --profile web add dsh-smart-approval@0.1.0-rc.1
dsh --profile web --dump-config
dsh web
```

For a one-off DSH invocation, follow the upstream `npx` form:

```sh
npx @deepseek-ai/dsh@0.1.0-rc.6 plugin --profile web add dsh-smart-approval@0.1.0-rc.1
npx @deepseek-ai/dsh@0.1.0-rc.6 --profile web --dump-config
npx @deepseek-ai/dsh@0.1.0-rc.6 web
```

`npm dsh ...` is not a valid npm command. Use `dsh ...` after a global install,
`npx @deepseek-ai/dsh ...` for a one-off invocation, or `pnpm dsh ...` from a
DeepSeek Harness source checkout.

The DSH plugin command accepts an exact npm package version. Therefore
`dsh plugin --profile web add dsh-smart-approval@0.1.0` will work after version
`0.1.0` is published; it does not work today because that version is not yet in
the npm registry.

### Install from a checkout or GitHub

From this repository:

```sh
dsh plugin --profile web add .
```

From a DeepSeek Harness source checkout:

```sh
pnpm dsh plugin --profile web add /absolute/path/to/dsh-smart-approval
pnpm dsh --profile web --dump-config
pnpm dsh --profile web
```

From GitHub, pin a reviewed commit:

```sh
dsh plugin --profile web add github:TingRuDeng/dsh-smart-approval#<commit-sha>
```

Git dependencies run this package's `prepare` build. pnpm 10 and later block
dependency build scripts by default. On the first Git install, follow DSH's
message to add the exact package name to the profile's `pnpm-workspace.yaml`
`allowBuilds`, review the source, and retry. Registry packages already contain
the built output and do not need this Git-build allowance.

### Verify or remove

The config dump should list `dsh-smart-approval` in the profile bundle stack,
the `smart-approval` plugin row, and the three Workspace Write presets:

```sh
dsh --profile web --dump-config
```

Remove the plugin with:

```sh
dsh plugin --profile web remove dsh-smart-approval
```

## Use and switch modes

DSH currently exposes one flat Permissions selector, so the three Workspace
Write choices share a prefix and appear next to each other. Select one in the
Web UI or run the corresponding command in the current session:

- Manual approval: `/permission workspace-write`
- Smart approval: `/permission smart-approval`
- Unattended: `/permission unattended`

The plugin reads the current preset for every approval request. A mode change
therefore applies immediately to the next request.

## How it works

The plugin is an early answerer in DSH's `approval/request` waterfall:

1. It resolves the real `tool/call` event by `callId`. Only DSH `bash` and
   `pwsh` calls have an automatic-review contract; other tools are delegated or
   rejected according to the selected mode.
2. It uses only direct, plain-text user messages from the current turn as
   authorization context. Earlier turns, assistant messages, tool output, and
   the model-written approval reason do not grant authority.
3. It sends only shell fields that affect execution: `command`, `timeoutMs`,
   `workdir`, `run_in_background`, and `sandbox_permissions`. Unknown fields,
   images, non-text content, or over-limit context fail closed without
   truncation.
4. Deterministic checks run before the model. Credential access, destructive
   commands, system changes, background work, dependency installation,
   publishing, remote writes, data upload, and sensitive workspace/workdir
   conditions are never classified as automatically safe.
5. The reviewer must return strict two-field JSON. `allow` means safe, `human`
   means high-risk or uncertain, and `reject` is reserved for clearly malicious
   behavior such as credential exfiltration, bypassing a safety control, or an
   unauthorized remote write.
6. Only a valid `allow` becomes `allowed-once`. Timeouts, exceptions, malformed
   output, incomplete context, and a preset change during review all fail
   closed according to the active mode.

The plugin never grants permanent permission and never switches a session to
`danger-full-access`.

## Configuration

By default, the current session route performs the review. To use an independent
route, override the plugin row in the profile's `cordis.patch.yml`:

```yaml
- id: smart-approval
  config:
    reviewerProvider: your-provider-route
    reviewerModel: your-model-id
    timeoutMs: 15000
    maxTokens: 128
```

`reviewerProvider` and `reviewerModel` must be configured together.

| Field | Default | Purpose |
|---|---:|---|
| `preset` | `smart-approval` | Permission preset that enables smart review |
| `unattendedPreset` | `unattended` | Permission preset that enables unattended review; must differ from `preset` |
| `reviewerProvider` / `reviewerModel` | Current session route | Optional independent reviewer route; configure as a pair |
| `timeoutMs` | `15000` | Hard deadline for the complete review call |
| `maxTokens` | `128` | Maximum reviewer output |
| `maxToolArgumentChars` | `12000` | Tool-argument limit; overflow fails closed without truncation |
| `maxUserMessages` | `4` | Direct current-turn user-message limit |
| `maxUserContextChars` | `8000` | User-context limit; overflow fails closed without truncation |

### Permission preset merge warning

DSH bundle patches replace the target row's complete `config`; they do not
deep-merge individual keys. This bundle therefore restates the entire
`permission` row and makes `smart-approval` the default. If the profile already
customizes permission presets or the default preset, restate and merge them in
the profile's own `cordis.patch.yml`, which has higher precedence. Always inspect
the final tree with `dsh --profile <name> --dump-config` before launch.

## Model and data boundary

Manual mode invokes no reviewer. In smart and unattended modes, the selected
review provider receives the workspace root, minimized shell execution fields,
and direct plain-text user messages from the current turn. It does not receive
assistant messages, tool results, approval descriptions, justifications,
unknown tool fields, or stored model reasoning.

Using the current session model is convenient, but it is not an independent
security review. For sensitive deployments, configure a separate controlled
provider route and evaluate its data-handling policy.

## Cross-directory requests

DSH currently gives `workspace-write` one workspace root. Accessing another
project normally triggers a one-time `danger-full-access` request. The plugin
may allow that call when the current user message explicitly authorizes the
other project and the command is limited to reading, building, testing, or a
clearly bounded development write. Deletion, dependency installation, system
changes, publishing, remote writes, and similar operations are delegated in
smart mode and rejected in unattended mode.

This is not a multi-root sandbox: an allowed `danger-full-access` process still
has broad filesystem authority for that call. Use manual approval when strict
directory isolation is required.

## Security boundaries

- Only requests that already enter DSH's approval channel can be reviewed.
  Network or remote operations that do not trigger approval are outside this
  plugin's control.
- Model classification is not a security proof. Deterministic checks cover
  known high-risk forms, but no shell or PowerShell pattern matcher is complete.
- Unknown tools, unknown arguments, background execution, non-text context, and
  incomplete context fail closed: smart mode asks a human; unattended mode
  rejects.
- Every automatic approval is one-time. The plugin stores no directory
  allowlist or permanent grant.
- Logs contain the tool name, outcome, and short reason code, not full prompts,
  arguments, credentials, or model reasoning.
- Smart fallback and manual mode require another Web, ACP, or custom human
  approval answerer. Without one, DSH remains fail-closed. Unattended mode never
  opens a human prompt.
- DSH currently has one `workspace-write` root. A one-time
  `danger-full-access` approval still has broad filesystem authority; this
  plugin does not turn it into a multi-root sandbox.

## Repository map for maintainers and agents

| Path | Responsibility |
|---|---|
| `src/index.ts` | Plugin configuration, service injection, and lifecycle |
| `src/approval-handler.ts` | Preset routing, waterfall decisions, and post-review preset recheck |
| `src/review-context.ts` | Current-call and current-turn context extraction/minimization |
| `src/review-policy.ts` | Deterministic fail-closed prechecks |
| `src/llm-reviewer.ts` | Reviewer prompt, streaming parser, strict verdict protocol, and timeout |
| `cordis.patch.yml` | DSH bundle layer, plugin row, and permission presets |
| `tests/*.spec.ts` | Approval, context, policy, protocol, and bundle regression contracts |

Behavioral invariants to preserve:

- Missing or ambiguous evidence never becomes an automatic allow.
- Only direct user text from the same turn can establish authorization.
- Only strict `allow` can return `allowed-once`.
- Manual mode must not inspect approval content or call a model.
- A preset change while review is in flight must invalidate automatic approval.

## Development

```sh
pnpm install
pnpm test
pnpm run typecheck
pnpm run build
pnpm pack --dry-run
```

The supported DSH range is `>=0.1.0-rc.5 <0.2.0`. The published plugin has been
installed into an isolated real DSH profile, and the composed config contains
the bundle, plugin row, and all three presets. A real-provider end-to-end review
and Web/ACP human-fallback interaction still depend on deployment credentials
and environment-specific acceptance testing.

## License

[MIT](LICENSE)
