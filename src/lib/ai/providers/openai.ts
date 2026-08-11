import { AiError, type ProviderResult } from '../types'
import { MAX_OUTPUT_TOKENS } from '../defaults'
import {
  mergeConsecutive,
  normalizeUsage,
  providerHttpError,
  toNetworkError,
  type ProviderArgs,
} from './shared'

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions'

interface OpenAiResponse {
  choices?: { message?: { content?: string } }[]
  usage?: {
    prompt_tokens?: number
    completion_tokens?: number
    total_tokens?: number
  }
}

/**
 * Options for calling an OpenAI-compatible Chat Completions endpoint.
 * OpenRouter reuses this adapter with a different `url`, provider label
 * for error messages, and a few extra headers (HTTP-Referer / X-Title).
 */
interface OpenAiCompatibleOptions {
  url?: string
  providerLabel?: string
  extraHeaders?: Record<string, string>
  /** Some OpenAI-compatible gateways (OpenRouter) don't accept
   *  `max_completion_tokens` and want the legacy `max_tokens` name. */
  useLegacyMaxTokens?: boolean
}

/**
 * Call OpenAI's Chat Completions endpoint with the caller's own key.
 * Returns the raw assistant text + token usage (handoff parsing happens
 * in `generateReply`).
 */
export async function generateOpenAi(
  args: ProviderArgs,
  opts: OpenAiCompatibleOptions = {},
): Promise<ProviderResult> {
  const { apiKey, model, systemPrompt, messages, timeoutMs } = args
  const url = opts.url ?? OPENAI_URL
  const providerLabel = opts.providerLabel ?? 'OpenAI'

  const body: Record<string, unknown> = {
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      ...mergeConsecutive(messages),
    ],
  }
  if (opts.useLegacyMaxTokens) {
    body.max_tokens = MAX_OUTPUT_TOKENS
  } else {
    body.max_completion_tokens = MAX_OUTPUT_TOKENS
  }

  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        ...(opts.extraHeaders ?? {}),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (err) {
    throw toNetworkError(err)
  }

  if (!res.ok) {
    throw await providerHttpError(providerLabel, res)
  }

  const data = (await res.json().catch(() => null)) as OpenAiResponse | null
  const text = data?.choices?.[0]?.message?.content
  if (!text || typeof text !== 'string' || !text.trim()) {
    throw new AiError(`${providerLabel} returned an empty response.`, {
      code: 'empty_response',
    })
  }
  const usage = normalizeUsage({
    prompt: data?.usage?.prompt_tokens,
    completion: data?.usage?.completion_tokens,
    total: data?.usage?.total_tokens,
  })
  return { text, usage }
}
