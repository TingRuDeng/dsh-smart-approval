import { describe, expect, it, vi } from 'vitest'
import {
  reviewerConfigForRequest,
  reviewerModelCatalog,
  reviewerModelProjection,
  routeAvailable,
  savedReviewerRoute,
  validateSmartApprovalSettings,
} from '../src/reviewer-settings.ts'

function state(settings: { reviewerProvider?: string; reviewerModel?: string } = {}) {
  return {
    scope: { get: () => settings },
    profile: { provider: 'profile-provider', model: 'profile-model' },
  }
}

describe('smart approval reviewer settings', () => {
  it('rejects partial and empty reviewer route settings', () => {
    expect(() => validateSmartApprovalSettings({ reviewerProvider: 'provider' }))
      .toThrow(/reviewerProvider and reviewerModel/)
    expect(() => validateSmartApprovalSettings({ reviewerProvider: '', reviewerModel: 'model' }))
      .toThrow(/reviewerProvider and reviewerModel/)
  })

  it('prefers a saved route and restores the profile fallback after clearing it', () => {
    expect(reviewerConfigForRequest(state({ reviewerProvider: 'saved-provider', reviewerModel: 'saved-model' }), {
      timeoutMs: 10,
      maxTokens: 12,
    })).toMatchObject({ provider: 'saved-provider', model: 'saved-model' })
    expect(reviewerConfigForRequest(state(), { timeoutMs: 10, maxTokens: 12 }))
      .toMatchObject({ provider: 'profile-provider', model: 'profile-model' })
    expect(savedReviewerRoute({})).toEqual({})
  })

  it('lists only text models and omits providers whose catalog fails', async () => {
    const warn = vi.fn()
    const llm = {
      listProviders: () => [{ id: 'text', name: 'Text' }, { id: 'broken', name: 'Broken' }],
      listModels: async (provider: string) => {
        if (provider === 'broken') throw new Error('offline')
        return [
          { id: 'text-model', name: 'Text model', inputModalities: ['text'] },
          { id: 'image-model', name: 'Image model', inputModalities: ['image'] },
          { id: 'unknown-model', name: 'Unknown model' },
        ]
      },
    }

    const catalog = await reviewerModelCatalog(llm as never, warn)
    expect(catalog).toEqual([{
      id: 'text', name: 'Text', models: [{ id: 'text-model', name: 'Text model' }],
    }])
    expect(warn).toHaveBeenCalledOnce()
    expect(routeAvailable(catalog, 'text', 'text-model')).toBe(true)
    expect(routeAvailable(catalog, 'text', 'image-model')).toBe(false)
  })

  it('returns a credential-free browser projection', () => {
    const view = reviewerModelProjection(
      { reviewerProvider: 'provider', reviewerModel: 'model' },
      [{ id: 'provider', name: 'Provider', models: [{ id: 'model', name: 'Model' }] }],
      true,
    )
    expect(view).toEqual({
      selection: { reviewerProvider: 'provider', reviewerModel: 'model' },
      providers: [{ id: 'provider', name: 'Provider', models: [{ id: 'model', name: 'Model' }] }],
      hasProfileRoute: true,
    })
    expect(JSON.stringify(view)).not.toMatch(/key|credential|endpoint/i)
  })
})
