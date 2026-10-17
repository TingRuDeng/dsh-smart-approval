/**
 * Live approval context folded from committed Session events.
 *
 * External reviewers never see this material: the context is held in process
 * memory only and is dropped when its sessions are disposed. DSH intentionally
 * offers no synchronous reader for arbitrary log positions
 * (`snapshotEvents`/`eventAt`/`ownEvents` are deprecated), so the plugin folds
 * the `session/event` push instead of rescanning event history per request.
 */

import type { ToolCallId, UserMessage } from '@deepseek-ai/dsh-llm'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'

/** Bounds that keep one session's live context small and its omissions explicit. */
export interface SessionContextLimits {
  /**
   * Direct-user messages retained per turn. One extra message is retained so the
   * count limit itself stays reproducible; the review layer rejects the overflow.
   */
  readonly maxUserMessages: number
  /**
   * Raw characters retained per tool call, plus one character so an oversized
   * argument stays recognizable as oversized without keeping the whole payload.
   * Must match the review layer's `maxToolArgumentChars`.
   */
  readonly maxToolArgumentChars: number
  /** Tool calls retained for the open turn, newest kept. */
  readonly maxTrackedToolCalls: number
}

/** One `tool/call` committed inside the open turn. */
export interface TrackedToolCall {
  /** Exact call identity. */
  readonly callId: ToolCallId
  /** Tool name from the committed call. */
  readonly name: string
  /** Raw JSON arguments, clamped to `maxToolArgumentChars + 1` characters. */
  readonly arguments: string
  /** Direct-user messages of the open turn committed before this call. */
  readonly userMessagesBefore: number
}

/**
 * Immutable approval context captured at one instant for one request.
 *
 * `currentUserMessages` is empty unless exactly one tracked call matches the
 * requested call id: without a unique call there is no position to read the
 * turn's authorization context up to.
 */
export interface ApprovalContext {
  /** Tracked calls matching the requested call id: zero, one, or (pathologically) more. */
  readonly calls: readonly TrackedToolCall[]
  /** Direct-user messages committed in the open turn before the requested call, in log order. */
  readonly currentUserMessages: readonly UserMessage[]
  /** Direct-user messages committed before the open turn, most recent last. */
  readonly previousUserMessages: readonly UserMessage[]
  /** Whether older previous-turn messages were dropped; the review layer must disclose it. */
  readonly previousTruncated: boolean
}

/** Context for a session that was never observed or has already been disposed. */
const EMPTY_CONTEXT: ApprovalContext = {
  calls: [],
  currentUserMessages: [],
  previousUserMessages: [],
  previousTruncated: false,
}

/** Turn-scoped accumulation for the most recent `turn/start`. */
interface TurnBucket {
  /** Turn number opened by that `turn/start`. */
  readonly turn: number
  /** Direct-user messages committed in this turn, in log order and bounded. */
  readonly messages: UserMessage[]
}

/** Per-session accumulation; one entry per live session. */
interface SessionEntry {
  /** Direct-user messages committed before the first `turn/start`. */
  readonly preTurn: UserMessage[]
  /** Bucket opened by the latest `turn/start`; undefined until one commits. */
  current?: TurnBucket | undefined
  /** Direct-user messages of settled turns, most recent last and bounded. */
  readonly previous: UserMessage[]
  /** Whether `previous` dropped older messages. */
  previousTruncated: boolean
  /** Tool calls of the open turn, oldest first and bounded. */
  readonly calls: TrackedToolCall[]
}

/**
 * Fold one committed Session event into the session's live context.
 *
 * The tracker deliberately never reads `session.events`: every fact it exposes
 * was pushed to it by the host as a committed event, so a request can never
 * observe a half-written log. Anything unaccounted for degrades to "no
 * context", which the review layer turns into a human handoff.
 */
export class SessionContextTracker {
  private readonly entries = new Map<Session, SessionEntry>()

  constructor(private readonly limits: SessionContextLimits) {}

  /** Fold one committed event. Unknown and log-only event types are ignored. */
  observe(session: Session, event: SessionEvent): void {
    const entry = this.entryOf(session)
    if (event.type === 'turn/start') {
      this.settleTurn(entry)
      entry.current = { turn: event.data.turn, messages: [] }
      entry.calls.length = 0
      return
    }
    if (event.type === 'user/message') {
      if (!isDirectUserMessage(event.data)) return
      const messages = entry.current?.messages ?? entry.preTurn
      // Retain one message past the limit: the review layer reports the overflow
      // itself, and keeping the excess would grow without bound.
      if (messages.length > this.limits.maxUserMessages) return
      messages.push(event.data)
      return
    }
    if (event.type === 'tool/call') {
      if (entry.current === undefined || entry.current.turn !== event.data.turn) return
      entry.calls.push({
        callId: event.data.callId,
        name: event.data.name,
        arguments: this.clampArguments(event.data.arguments),
        userMessagesBefore: entry.current.messages.length,
      })
      if (entry.calls.length > this.limits.maxTrackedToolCalls) entry.calls.shift()
    }
    // `turn/end` intentionally leaves the bucket in place: a trailing approval for
    // the turn that just ended still resolves. Other event types carry no context.
  }

  /** Drop every fact held for one session; called when the session is disposed. */
  release(session: Session): void {
    this.entries.delete(session)
  }

  /**
   * Fold a session's already-committed history, as delivered at construction.
   *
   * A resumed session installs its seed events before any observer can be
   * attached and dispatches no `session/event` for them, so the push stream
   * alone leaves a resumed session's context empty. The caller supplies the
   * inherited prefix it is allowed to read; folding is the same accumulator the
   * push stream feeds, so a backfilled session and a live one behave alike.
   *
   * @param session - session whose history was installed before observation.
   * @param events - committed events, oldest first.
   */
  backfill(session: Session, events: readonly SessionEvent[]): void {
    for (const event of events) this.observe(session, event)
  }

  /** Capture the context relevant to one pending approval request. */
  snapshot(session: Session, callId: ToolCallId | undefined): ApprovalContext {
    const entry = this.entries.get(session)
    if (entry === undefined) return EMPTY_CONTEXT
    const calls = callId === undefined
      ? []
      : entry.calls.filter(call => call.callId === callId)
    const matched = calls.length === 1 ? calls[0] : undefined
    if (matched === undefined) {
      return { ...EMPTY_CONTEXT, calls, previousTruncated: entry.previousTruncated }
    }
    const messages = entry.current?.messages ?? entry.preTurn
    return {
      calls,
      currentUserMessages: messages.slice(0, matched.userMessagesBefore),
      // A snapshot is a value: hand out a copy so no caller can mutate the
      // tracker's live history.
      previousUserMessages: [...entry.previous],
      previousTruncated: entry.previousTruncated,
    }
  }

  /** Move a closing turn's messages into the bounded history ring. */
  private settleTurn(entry: SessionEntry): void {
    this.appendHistory(entry, entry.preTurn)
    entry.preTurn.length = 0
    const messages = entry.current?.messages
    if (messages !== undefined) this.appendHistory(entry, messages)
    entry.current = undefined
  }

  /**
   * Append settled messages, keeping only the newest `maxUserMessages + 1`.
   *
   * `maxUserMessages - 1` would be the exact consumption bound of the review
   * loop, but empty-text messages advance that scan without consuming budget.
   * The extra slack keeps the ring faithful for ordinary logs; when it does
   * overflow, `previousTruncated` makes the review layer disclose the omission
   * instead of silently presenting a shorter history as complete.
   */
  private appendHistory(entry: SessionEntry, messages: readonly UserMessage[]): void {
    if (messages.length === 0) return
    const combined = [...entry.previous, ...messages]
    const cap = this.limits.maxUserMessages + 1
    if (combined.length > cap) {
      entry.previousTruncated = true
      combined.splice(0, combined.length - cap)
    }
    entry.previous.splice(0, entry.previous.length, ...combined)
  }

  /** Keep an oversized argument recognizable without retaining all of it. */
  private clampArguments(raw: string): string {
    return raw.length > this.limits.maxToolArgumentChars
      ? raw.slice(0, this.limits.maxToolArgumentChars + 1)
      : raw
  }

  /** Lazily create the accumulation for a session. */
  private entryOf(session: Session): SessionEntry {
    let entry = this.entries.get(session)
    if (entry === undefined) {
      entry = { preTurn: [], previous: [], previousTruncated: false, calls: [] }
      this.entries.set(session, entry)
    }
    return entry
  }
}

/** Whether a model-history row is direct human input rather than injected context. */
function isDirectUserMessage(message: UserMessage): boolean {
  return message.role === 'user' && message.source.kind === 'user'
}
