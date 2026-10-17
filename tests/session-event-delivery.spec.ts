/**
 * Pins the two delivery guarantees the event-driven approval context relies on.
 *
 * R1 - a plugin registered at the host scope receives `session/event` for every
 *      live session (the scope filter admits listeners with no scope tag).
 * R2 - the push happens synchronously inside the append, so an event is already
 *      visible to listeners before `append()` returns; `tool/call` is therefore
 *      observable before the approval request it belongs to is dispatched.
 *
 * If either guarantee stops holding, the approval context silently degrades to
 * "no context" and every request falls back to a human answerer.
 */

import { Context } from '@deepseek-ai/cordis'
import { ToolCallId, createUserMessage } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import { describe, expect, it } from 'vitest'

interface Delivery {
  readonly session: Session
  readonly event: SessionEvent
}

/** Boot a real session store with one host-scope observer attached. */
async function bench(): Promise<{
  readonly ctx: Context
  readonly deliveries: Delivery[]
  readonly typesOf: (session: Session) => string[]
}> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  const deliveries: Delivery[] = []
  // Registration level identical to the plugin's own `ctx.on('session/event')`.
  ctx.on('session/event', (session, event) => {
    deliveries.push({ session, event })
  })
  return {
    ctx,
    deliveries,
    typesOf: (session) =>
      deliveries.filter(delivery => delivery.session === session).map(delivery => delivery.event.type),
  }
}

describe('session/event delivery to a host-scope observer', () => {
  it('delivers each committed event synchronously, before append returns', async () => {
    const { ctx, typesOf } = await bench()
    const session = ctx.sessions.create(SessionId('delivery-1'))

    session.append('turn/start', { turn: 1 })
    // No await between the append and the read: the push must already have happened.
    expect(typesOf(session)).toContain('turn/start')

    session.append('user/message', createUserMessage({
      source: { kind: 'user' },
      content: [{ type: 'text', text: 'run the tests' }],
    }), { surfaceOp: 'append' })
    expect(typesOf(session)).toContain('user/message')

    session.append('tool/call', {
      turn: 1,
      step: 1,
      callId: ToolCallId('call-1'),
      name: 'bash',
      arguments: '{"command":"pnpm test"}',
    })
    expect(typesOf(session)).toContain('tool/call')
  })

  it('reports the exact committed event, so a tracker can index its payload', async () => {
    const { ctx, deliveries } = await bench()
    const session = ctx.sessions.create(SessionId('delivery-2'))

    const appended = session.append('tool/call', {
      turn: 1,
      step: 1,
      callId: ToolCallId('call-2'),
      name: 'write',
      arguments: '{"file_path":"/work/a.md","content":"x"}',
    })
    const observed = deliveries.find(delivery => delivery.event.type === 'tool/call')
    expect(observed?.session).toBe(session)
    expect(observed?.event).toEqual(appended)
    expect(observed?.event.seq).toBe(appended.seq)
  })

  it('receives events for every live session, not only the first one', async () => {
    const { ctx, typesOf } = await bench()
    const first = ctx.sessions.create(SessionId('delivery-3a'))
    const second = ctx.sessions.create(SessionId('delivery-3b'))

    first.append('turn/start', { turn: 1 })
    second.append('turn/start', { turn: 1 })

    expect(typesOf(first)).toContain('turn/start')
    expect(typesOf(second)).toContain('turn/start')
  })
})
