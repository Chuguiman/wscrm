import type { ProviderResult } from '../types'
import { generateOpenAi } from './openai'
import type { ProviderArgs } from './shared'

// OpenRouter (https://openrouter.ai) is a router in front of hundreds
// of hosted LLMs (OpenAI, Anthropic, Google, Meta, Mistral, ...). Its
// Chat Completions endpoint is OpenAI-compatible, so we reuse the
// OpenAI adapter and just point it at a different URL. The optional
// HTTP-Referer / X-Title headers help OpenRouter attribute usage on
// their dashboard — harmless when they're missing.

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions'

/**
 * Call OpenRouter's Chat Completions endpoint. `model` is any slug from
 * https://openrouter.ai/models (e.g. `anthropic/claude-3.5-sonnet`,
 * `openai/gpt-4o-mini`, `meta-llama/llama-3.1-70b-instruct`).
 */
export async function generateOpenRouter(
  args: ProviderArgs,
): Promise<ProviderResult> {
  const referer =
    process.env.NEXT_PUBLIC_SITE_URL ??
    process.env.APP_URL ??
    'https://github.com/'
  return generateOpenAi(args, {
    url: OPENROUTER_URL,
    providerLabel: 'OpenRouter',
    // OpenRouter rejects `max_completion_tokens`; it wants `max_tokens`.
    useLegacyMaxTokens: true,
    extraHeaders: {
      'HTTP-Referer': referer,
      'X-Title': 'WSCRM',
    },
  })
}
