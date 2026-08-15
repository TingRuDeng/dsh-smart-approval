import { CallId } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ApprovalRequest } from '@deepseek-ai/dsh-user-approval'
import { describe, expect, it, vi } from 'vitest'
import { createLlmReviewer, resolveLlmReviewerConfig } from '../src/llm-reviewer.ts'
import type { ReviewPayload } from '../src/review-context.ts'

const payload: ReviewPayload = {
  workspaceRoot: '/work/main',
  action: {
    toolName: 'bash',
    arguments: {
      command: 'pnpm test',
      workdir: '/work/other',
      sandbox_permissions: 'danger-full-access',
    },
  },
  userRequests: ['在 /work/other 运行测试'],
}

function requestOf(options: {
  provider?: string
  model?: string
  signal?: AbortSignal
} = {}): ApprovalRequest {
  const session = {
    requestContext: () => options.provider === undefined || options.model === undefined
      ? undefined
      : { provider: options.provider, model: options.model },
  }
  const agent = { session, options: {} } as unknown as Agent
  return {
    agent,
    toolName: 'bash',
    callId: CallId('call-1'),
    ...options.signal === undefined ? {} : { signal: options.signal },
  }
}

function chunks(text: string, finish: StreamChunk = { type: 'finish', reason: { kind: 'stop' } }): StreamChunk[] {
  return [
    { type: 'text-delta', index: 0, text },
    finish,
  ]
}

function streaming(sequence: readonly StreamChunk[]) {
  const seen: GenerateOptions[] = []
  return {
    seen,
    stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
      seen.push(options)
      return (async function* () {
        yield * sequence
      })()
    },
  }
}

describe('resolveLlmReviewerConfig', () => {
  it('uses the current session route by default', () => {
    expect(resolveLlmReviewerConfig({})).toEqual({ timeoutMs: 15_000, maxTokens: 128 })
  })

  it('requires a configured provider and model as a pair', () => {
    expect(() => resolveLlmReviewerConfig({ provider: 'reviewer' })).toThrow(/provider and model must be configured together/)
    expect(() => resolveLlmReviewerConfig({ model: 'review-model' })).toThrow(/provider and model must be configured together/)
  })
})

describe('createLlmReviewer', () => {
  it('uses the current session route and accepts strict reviewer JSON', async () => {
    const llm = streaming(chunks('{"decision":"allow","reasonCode":"bounded-build-test"}'))
    const review = createLlmReviewer(llm, resolveLlmReviewerConfig({}))

    await expect(review(payload, requestOf({ provider: 'current-provider', model: 'current-model' }))).resolves.toEqual({
      decision: 'allow',
      reasonCode: 'bounded-build-test',
    })
    expect(llm.seen).toHaveLength(1)
    expect(llm.seen[0]).toMatchObject({
      provider: 'current-provider',
      model: 'current-model',
      temperature: 0,
      maxTokens: 128,
      tools: [],
    })
    expect(JSON.stringify(llm.seen[0]?.messages)).toContain('/work/other')
    expect(llm.seen[0]?.signal?.aborted).toBe(true)
  })

  it('uses an explicitly configured reviewer route', async () => {
    const llm = streaming(chunks('{"decision":"human","reasonCode":"uncertain"}'))
    const review = createLlmReviewer(llm, resolveLlmReviewerConfig({
      provider: 'review-provider',
      model: 'review-model',
    }))

    await review(payload, requestOf({ provider: 'current-provider', model: 'current-model' }))
    expect(llm.seen[0]).toMatchObject({ provider: 'review-provider', model: 'review-model' })
  })

  it('returns a strict malicious-request rejection from the reviewer', async () => {
    const llm = streaming(chunks('{"decision":"reject","reasonCode":"credential-exfiltration"}'))
    const review = createLlmReviewer(llm, resolveLlmReviewerConfig({}))

    await expect(review(payload, requestOf({ provider: 'p', model: 'm' }))).resolves.toEqual({
      decision: 'reject',
      reasonCode: 'credential-exfiltration',
    })
  })

  it('ignores bounded reasoning and parses only the visible JSON decision', async () => {
    const decision = '{"decision":"allow","reasonCode":"bounded-build-test"}'
    const llm = streaming([
      { type: 'block-start', index: 0, blockType: 'reasoning' },
      { type: 'reasoning-delta', index: 0, text: 'Check scope and reversibility.' },
      { type: 'block-end', index: 0, block: { type: 'reasoning', text: 'Check scope and reversibility.' } },
      { type: 'block-start', index: 1, blockType: 'text' },
      { type: 'text-delta', index: 1, text: decision },
      { type: 'block-end', index: 1, block: { type: 'text', text: decision } },
      { type: 'finish', reason: { kind: 'stop' } },
    ])
    const review = createLlmReviewer(llm, resolveLlmReviewerConfig({}))

    await expect(review(payload, requestOf({ provider: 'p', model: 'm' }))).resolves.toEqual({
      decision: 'allow',
      reasonCode: 'bounded-build-test',
    })
  })

  it('rejects a stream index reused across text and reasoning block types', async () => {
    const llm = streaming([
      { type: 'block-start', index: 0, blockType: 'text' },
      {
        type: 'reasoning-delta',
        index: 0,
        text: '{"decision":"allow","reasonCode":"read-only"}',
      },
      { type: 'finish', reason: { kind: 'stop' } },
    ])
    const review = createLlmReviewer(llm, resolveLlmReviewerConfig({}))

    await expect(review(payload, requestOf({ provider: 'p', model: 'm' }))).resolves.toBeNull()
  })

  it.each([-1, 0.5, Number.NaN])('rejects an invalid stream block index: %s', async (index) => {
    const llm = streaming([
      { type: 'text-delta', index, text: '{"decision":"allow","reasonCode":"read-only"}' },
      { type: 'finish', reason: { kind: 'stop' } },
    ])
    const review = createLlmReviewer(llm, resolveLlmReviewerConfig({}))

    await expect(review(payload, requestOf({ provider: 'p', model: 'm' }))).resolves.toBeNull()
  })

  it('hands missing routes, provider failures, and malformed output to a human', async () => {
    const noRouteLlm = streaming(chunks('{"decision":"allow","reasonCode":"read-only"}'))
    await expect(createLlmReviewer(noRouteLlm, resolveLlmReviewerConfig({}))(payload, requestOf())).resolves.toBeNull()
    expect(noRouteLlm.seen).toHaveLength(0)

    const failed = streaming(chunks('', {
      type: 'finish',
      reason: { kind: 'error', failure: { code: 'PROVIDER', message: 'failed' } },
    }))
    await expect(createLlmReviewer(failed, resolveLlmReviewerConfig({}))(payload, requestOf({ provider: 'p', model: 'm' }))).resolves.toBeNull()

    const malformed = streaming(chunks('```json\n{"decision":"allow","reasonCode":"read-only"}\n```'))
    await expect(createLlmReviewer(malformed, resolveLlmReviewerConfig({}))(payload, requestOf({ provider: 'p', model: 'm' }))).resolves.toBeNull()

    const truncated = streaming([
      { type: 'text-delta', index: 0, text: '{"decision":"allow","reasonCode":"read-only"}' },
    ])
    await expect(createLlmReviewer(truncated, resolveLlmReviewerConfig({}))(payload, requestOf({ provider: 'p', model: 'm' }))).resolves.toBeNull()
  })

  it('abandons oversized reviewer text before consuming another chunk', async () => {
    const next = vi.fn<() => Promise<IteratorResult<StreamChunk>>>()
      .mockResolvedValueOnce({ done: false, value: { type: 'text-delta', index: 0, text: 'x'.repeat(513) } })
      .mockResolvedValueOnce({ done: false, value: { type: 'finish', reason: { kind: 'stop' } } })
    const close = vi.fn(async () => ({ done: true as const, value: undefined }))
    const llm = {
      stream(_options: GenerateOptions): AsyncIterable<StreamChunk> {
        return { [Symbol.asyncIterator]: () => ({ next, return: close }) }
      },
    }
    const review = createLlmReviewer(llm, resolveLlmReviewerConfig({}))

    await expect(review(payload, requestOf({ provider: 'p', model: 'm' }))).resolves.toBeNull()
    expect(next).toHaveBeenCalledOnce()
    expect(close).toHaveBeenCalledOnce()
  })

  it('returns at the configured deadline even if the stream ignores cancellation', async () => {
    const close = vi.fn(async () => ({ done: true as const, value: undefined }))
    const llm = {
      stream(_options: GenerateOptions): AsyncIterable<StreamChunk> {
        return {
          [Symbol.asyncIterator]() {
            return {
              next: () => new Promise<IteratorResult<StreamChunk>>(() => {}),
              return: close,
            }
          },
        }
      },
    }
    const review = createLlmReviewer(llm, resolveLlmReviewerConfig({ timeoutMs: 10 }))
    const started = Date.now()
    await expect(review(payload, requestOf({ provider: 'p', model: 'm' }))).resolves.toBeNull()
    expect(Date.now() - started).toBeLessThan(500)
    expect(close).toHaveBeenCalledOnce()
  })
})
