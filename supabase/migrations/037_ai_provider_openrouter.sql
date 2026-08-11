-- Allow OpenRouter as a third BYO AI provider. OpenRouter exposes an
-- OpenAI-compatible Chat Completions API and gives access to hundreds
-- of models (OpenAI, Anthropic, Google, Meta, Mistral, ...), so admins
-- can pick any model they like without us having to add a new adapter
-- per vendor.

alter table public.ai_configs
  drop constraint if exists ai_configs_provider_check;

alter table public.ai_configs
  add constraint ai_configs_provider_check
  check (provider in ('openai', 'anthropic', 'openrouter'));
