# dsh-smart-approval

English | [中文](README.zh.md)

`dsh-smart-approval` is a fail-closed approval plugin for
[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness). It separates
access permission from automatic review: DSH continues to own Read Only,
Workspace Write, and Full access, while this plugin adds an independent review
selector beside `Workspace Write`.

New sessions use smart approval by default. Changing review mode does not change
the sandbox, and changing access permission does not change review mode. Both
changes apply to the next approval request without restarting DSH.

> [!WARNING]
> This project and DSH are both in developer preview. Review the security
> boundaries below and pin exact versions in reproducible environments.

## Two independent selectors

The Web composer should show two controls:

```text
[ Workspace Write ▾ ] [ Smart approval ▾ ]
```

- Access: Read Only, Workspace Write, and Full access, owned by DSH.
- Automatic review: Manual approval, Smart approval, and Unattended, owned by
  this plugin.

| Review mode | Safe request | High-risk or uncertain | Clearly malicious |
|---|---|---|---|
| Manual approval | Ask a human | Ask a human | Ask a human |
| Smart approval (recommended default) | Allow once | Ask a human | Reject |
| Unattended | Allow once | Reject | Reject |

Automatic review only handles requests that already enter DSH's
`approval/request` waterfall. It never expands the current access permission or
switches a session to Full access.

## Install

### Requirements

- Node.js 24 or later.
- DeepSeek Harness `>=0.1.0-rc.5 <0.2.0`.
- `pnpm` on `PATH`; DSH forwards plugin-management operations to pnpm.

After installing the DSH CLI globally:

```sh
npm install --global @deepseek-ai/dsh@0.1.0-rc.6
dsh plugin --profile web add dsh-smart-approval@0.1.0-rc.5
dsh --profile web --dump-config
dsh web
```

For one-off execution:

```sh
npx @deepseek-ai/dsh@0.1.0-rc.6 plugin --profile web add dsh-smart-approval@0.1.0-rc.5
npx @deepseek-ai/dsh@0.1.0-rc.6 --profile web --dump-config
npx @deepseek-ai/dsh@0.1.0-rc.6 web
```

`npm dsh ...` is not a valid npm command. Use `dsh ...` after a global install,
`npx @deepseek-ai/dsh ...` for one-off execution, or `pnpm dsh ...` from a
DeepSeek Harness source checkout.

DSH accepts an exact plugin version. After the stable release is published, the
following form is supported:

```sh
dsh plugin --profile web add dsh-smart-approval@0.1.0
```

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

Pin a reviewed GitHub commit:

```sh
dsh plugin --profile web add github:TingRuDeng/dsh-smart-approval#<commit-sha>
```

Git dependencies run this package's `prepare` build. pnpm 10 and later block
dependency build scripts by default. On first Git install, follow DSH's prompt
to add the exact package name to that profile's `pnpm-workspace.yaml`
`allowBuilds`, review the source, and retry. Registry packages already include
built output and do not need that permission.

### Verify or remove

```sh
dsh --profile web --dump-config
```

The result should contain the `dsh-smart-approval` bundle and `smart-approval`
plugin row. The permission configuration should still contain only DSH's native
Read Only, Workspace Write, and Full access choices. After Web starts, the
automatic-review selector should appear separately beside access permission.

Remove the plugin with:

```sh
dsh plugin --profile web remove dsh-smart-approval
```

## Use and switch modes

Use the independent automatic-review selector in Web, or run one of these in
the current session:

```text
/approval-mode manual
/approval-mode smart
/approval-mode unattended
```

`/approval-mode` without an argument returns the current mode. Access permission
continues to use DSH's native `/permission` command; the two command families do
not rewrite each other's state.

Sessions without an explicit selection use `defaultMode`, which defaults to
`smart`. Explicit selections are stored as a Session-bound `storage-domain`
sidecar; an unselected session continues to follow the configured default so
the host decision and browser projection stay aligned after configuration
changes. The plugin never appends a non-portable event to the Session log.
During an upgrade from an earlier preview, legacy `smart-approval/mode` events
are read only for one-way sidecar migration; older `smart-approval` and
`unattended` permission presets migrate to `smart` and `unattended`. Migration
does not modify permission events.

## How it works

The plugin is an early answerer in DSH's `approval/request` waterfall:

1. It resolves the real `tool/call` event by `callId`. DSH `bash`, `pwsh`,
   `write`, and `edit` have closed, versioned action adapters. Unknown tools or
   future argument fields fail closed.
2. It combines the current turn with bounded recent direct-user text. Newer
   constraints override older scope, and the payload says when older history
   was omitted. Assistant messages, tool output, model-written justifications,
   and earlier approval outcomes never establish authority.
3. It sends only execution semantics. Shell review receives the command and
   execution fields; `write` receives the exact path and complete new content;
   `edit` receives the exact path, old/new strings, and replace-all flag.
   Model-authored descriptions and justifications are removed.
4. File mutations use DSH's filesystem service for read-only evidence: resolved
   display path, workspace containment, path/target type, and optional byte
   size. File content is not read. Final symlinks, canonical path aliases,
   malformed metadata, sensitive paths, and protected system locations stop
   before model review.
5. Deterministic checks also stop credential material, destructive commands,
   system changes, background work, dependency installation, publishing,
   remote writes, uploads, and sensitive workspace/workdir conditions.
6. The model returns a strict four-field classification: `riskLevel`,
   `authorization`, `intent`, and a closed `reasonCode`. It cannot directly
   grant permission. Local code allows only low-risk benign work with high or
   medium direct-user authorization; uncertainty is handed off and clearly
   malicious intent is rejected according to the selected mode.
7. Every successful classification becomes only `allowed-once`. The next
   similar request is inspected and classified again. Timeouts, exceptions,
   malformed output, incomplete evidence, cancellation, or a mode change fail
   closed under the active mode.

### Repeated requests are re-reviewed, not remembered

If the user asks for several ordinary writes and each exact request is clearly
within that intent, smart approval can allow the second and later requests
without another click. Each request still makes its own model call and receives
its own one-shot grant. A previous human click or model result never creates a
directory allowlist, cached precedent, or permanent permission.

## Configuration

The current session route performs review by default. To use an independent
route, override the plugin row in the profile's `cordis.patch.yml`:

```yaml
- id: smart-approval
  config:
    defaultMode: smart
    reviewerProvider: your-provider-route
    reviewerModel: your-model-id
    timeoutMs: 15000
    maxTokens: 128
```

`reviewerProvider` and `reviewerModel` must be configured together.

| Field | Default | Purpose |
|---|---:|---|
| `defaultMode` | `smart` | New-session mode: `manual`, `smart`, or `unattended` |
| `reviewerProvider` / `reviewerModel` | Current session route | Optional independent reviewer route; configure as a pair |
| `timeoutMs` | `15000` | Hard deadline for the complete review call |
| `maxTokens` | `128` | Maximum reviewer output |
| `maxToolArgumentChars` | `12000` | Tool-argument limit; overflow fails closed without truncation |
| `maxUserMessages` | `4` | Current plus recent direct-user message limit; older history is omitted explicitly |
| `maxUserContextChars` | `8000` | User-context limit; the current turn is never truncated, while older history may be omitted explicitly |

The bundle does not override the `permission` row, so it does not replace a
profile's existing permission presets.

## Model, data, and security boundaries

- Manual mode invokes no reviewer. Smart and unattended modes send the
  workspace root, normalized action, bounded recent direct-user text, and
  content-free file-target metadata to the review provider. For `write` and
  `edit`, the normalized action includes the exact new/replacement text needed
  to classify the mutation; detected credential material is stopped locally.
- Reusing the current session model is convenient but is not an independent
  security review. Sensitive deployments should use a separate controlled
  provider route.
- Only requests that already enter DSH's approval channel can be reviewed.
  Network or remote actions that do not trigger approval are outside this
  plugin's control.
- Model classification is not a security proof. Unknown tools or arguments,
  filesystem aliases, background execution, and non-text or incomplete context
  fail closed: smart mode asks a human and unattended mode rejects.
- Every automatic approval is one-time and every repeated request is reviewed
  again. The plugin stores no decision cache, directory allowlist, approval
  precedent, or permanent grant.
- Logs contain tool name, outcome, and short reason code, not full prompts,
  arguments, credentials, or model reasoning.
- Smart fallback and manual mode require another Web, ACP, or custom human
  answerer. Without one, DSH remains fail-closed.
- DSH currently has one `workspace-write` root. A one-time Full access approval
  still has broad filesystem authority; this plugin does not turn it into a
  multi-root sandbox.

## Repository map for maintainers and agents

| Path | Responsibility |
|---|---|
| `src/index.ts` | Service injection, legacy migration, projection, command, and lifecycle |
| `src/review-mode.ts` | Legacy-event migration, command lifecycle fold, and browser projection |
| `src/review-mode-storage.ts` | Session-lifecycle-bound automatic-review mode sidecar |
| `src/client/` | Web selector and browser-plugin registration |
| `src/approval-handler.ts` | Three-mode routing, waterfall decisions, and post-review mode recheck |
| `src/review-context.ts` | Closed action adapters and bounded direct-user context extraction |
| `src/file-target-inspector.ts` | Read-only DSH filesystem evidence and path safety classification |
| `src/review-policy.ts` | Deterministic prechecks, strict classification parser, and local decision mapping |
| `src/llm-reviewer.ts` | Reviewer prompt, stream parser, strict assessment protocol, and timeout |
| `cordis.patch.yml` | Host-plugin mount only; it does not override permission presets |
| `tests/` | Host, policy, protocol, migration, projection, and browser contracts |

Invariants: permission and review mode never rewrite each other; missing or
ambiguous evidence never becomes an automatic allow; only bounded direct-user
text can establish authority and newer constraints win; previous approvals are
never authorization; only a locally mapped low-risk benign assessment returns
`allowed-once`; manual mode inspects no request content and calls no model; and
a mode change during inspection or review invalidates the original result.

## Development

```sh
pnpm install
pnpm test
pnpm run typecheck
pnpm run build
pnpm pack --dry-run
```

The supported DSH range is `>=0.1.0-rc.5 <0.2.0`. Real-provider end-to-end
review and human-fallback interaction still require deployment credentials and
environment-specific acceptance testing.

## License

[MIT](LICENSE)
