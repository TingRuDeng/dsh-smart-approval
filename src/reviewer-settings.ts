import z from '@deepseek-ai/schemastery'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import type { LlmRuntime } from '@deepseek-ai/dsh-llm'
import { resolveLlmReviewerConfig, type LlmReviewerConfig, type LlmReviewerConfigInput } from './llm-reviewer.ts'

/** Settings namespace owned by the smart approval plugin. */
export const SMART_APPROVAL_SETTINGS_NAMESPACE = settingsNamespace('smart-approval')

/** Non-sensitive user override for the approval reviewer route. */
export interface SmartApprovalSettings {
  readonly reviewerProvider?: string
  readonly reviewerModel?: string
}

/** Settings schema for the optional reviewer route override. */
export const SmartApprovalSettingsSchema: z<SmartApprovalSettings> = z.object({
  reviewerProvider: z.string(),
  reviewerModel: z.string(),
})

/** One provider/model entry exposed to the settings card. */
export interface ReviewerModelProvider {
  readonly id: string
  readonly name: string
  readonly models: { readonly id: string; readonly name: string }[]
}

/** Settings RPC projection; it deliberately contains no provider credentials. */
export interface ReviewerModelProjection {
  readonly selection: { readonly reviewerProvider: string; readonly reviewerModel: string } | null
  readonly providers: readonly ReviewerModelProvider[]
  readonly hasProfileRoute: boolean
}

/** Minimal readable face of the settings registration. */
export interface ReviewerSettingsReader {
  get(): SmartApprovalSettings
}

/** Settings scope plus static profile fallback used by the live resolver. */
export interface ReviewerRouteState {
  readonly scope: ReviewerSettingsReader
  readonly profile: LlmReviewerConfigInput
}

/** Validate the paired route invariant outside the schema's single-field vocabulary. */
export function validateSmartApprovalSettings(value: SmartApprovalSettings): void {
  const hasProvider = value.reviewerProvider !== undefined
  const hasModel = value.reviewerModel !== undefined
  if (hasProvider !== hasModel
    || (hasProvider && (value.reviewerProvider?.trim() === '' || value.reviewerModel?.trim() === ''))) {
    throw new Error('smart-approval: reviewerProvider and reviewerModel must be non-empty strings configured together')
  }
}

/** Read a saved route override, returning no route when the user cleared it. */
export function savedReviewerRoute(settings: SmartApprovalSettings): LlmReviewerConfigInput {
  validateSmartApprovalSettings(settings)
  return settings.reviewerProvider === undefined || settings.reviewerModel === undefined
    ? {}
    : { provider: settings.reviewerProvider, model: settings.reviewerModel }
}

/** Resolve one approval request's reviewer route, freezing the settings read for that call. */
export function reviewerConfigForRequest(
  state: ReviewerRouteState,
  limits: Pick<LlmReviewerConfigInput, 'timeoutMs' | 'maxTokens'>,
): LlmReviewerConfig {
  const saved = savedReviewerRoute(state.scope.get())
  const route = saved.provider !== undefined && saved.model !== undefined ? saved : state.profile
  return resolveLlmReviewerConfig({
    ...route.provider === undefined ? {} : { provider: route.provider },
    ...route.model === undefined ? {} : { model: route.model },
    ...limits,
  })
}

/** List only live text-capable provider/model identifiers for the settings UI. */
export async function reviewerModelCatalog(llm: LlmRuntime, warn: (message: string) => void): Promise<ReviewerModelProvider[]> {
  const results = await Promise.all(llm.listProviders().map(async (provider) => {
    try {
      const models = await llm.listModels(provider.id)
      const textModels = models
        .filter(model => model.inputModalities?.includes('text') === true)
        .map(model => ({ id: model.id, name: model.name }))
      return textModels.length === 0 ? undefined : {
        id: provider.id,
        name: provider.name,
        models: textModels,
      }
    } catch (error) {
      warn(`smart-approval: could not list models for ${provider.id}: ${String(error)}`)
      return undefined
    }
  }))
  return results.filter((entry): entry is ReviewerModelProvider => entry !== undefined)
}

/** Verify one route belongs to the current live text-model catalog. */
export function routeAvailable(catalog: readonly ReviewerModelProvider[], provider: string, model: string): boolean {
  return catalog.some(entry => entry.id === provider && entry.models.some(candidate => candidate.id === model))
}

/** Build the redacted settings projection returned to the browser. */
export function reviewerModelProjection(
  settings: SmartApprovalSettings,
  providers: readonly ReviewerModelProvider[],
  hasProfileRoute: boolean,
): ReviewerModelProjection {
  const route = savedReviewerRoute(settings)
  return {
    selection: route.provider === undefined || route.model === undefined
      ? null
      : { reviewerProvider: route.provider, reviewerModel: route.model },
    providers,
    hasProfileRoute,
  }
}
