import {
  siAnthropic,
  siBaidu,
  siCline,
  siCloudflare,
  siCursor,
  siDeepseek,
  siDelphi,
  siGoogle,
  siGooglecloud,
  siGooglegemini,
  siHuawei,
  siHuggingface,
  siKimi,
  siLmstudio,
  siMeta,
  siMinimax,
  siMistralai,
  siNvidia,
  siOllama,
  siOpenrouter,
  siPerplexity,
  siQwen,
  siReplicate,
  siVercel,
  siVllm,
  siWindsurf,
  siXiaomi,
} from 'simple-icons';
import { EXTRA_OPENAI } from './extraBrands';

export interface BrandIcon {
  title: string;
  hex: string;
  path: string;
}

const BRANDS: Record<string, BrandIcon> = {
  anthropic: siAnthropic,
  openai: EXTRA_OPENAI,
  google: siGoogle,
  gemini: siGooglegemini,
  meta: siMeta,
  mistral: siMistralai,
  deepseek: siDeepseek,
  perplexity: siPerplexity,
  ollama: siOllama,
  openrouter: siOpenrouter,
  googlecloud: siGooglecloud,
  vertexai: siGooglecloud,
  bedrock: { title: 'AWS', hex: 'FF9900', path: '' },
  azure: { title: 'Azure', hex: '0078D4', path: '' },
  copilot: { title: 'Copilot', hex: '181717', path: '' },
  cursor: siCursor,
  windsurf: siWindsurf,
  cline: siCline,
  lmstudio: siLmstudio,
  vllm: siVllm,
  kimi: siKimi,
  minimax: siMinimax,
  qwen: siQwen,
  baidu: siBaidu,
  huawei: siHuawei,
  xiaomi: siXiaomi,
  huggingface: siHuggingface,
  replicate: siReplicate,
  vercel: siVercel,
  cloudflare: siCloudflare,
  nvidia: siNvidia,
  delphi: siDelphi,
};

const HUES = [262, 210, 160, 20, 330, 190, 280, 130, 0, 240];

/** Normalize a provider id to a brand key, or null when it has no brand. */
export function brandKeyFor(provider: string): string | null {
  const id = provider.toLowerCase();
  if (BRANDS[id] !== undefined) return id;
  for (const key of Object.keys(BRANDS)) {
    if (id.includes(key)) return key;
  }
  return null;
}

export function brandFor(provider: string): BrandIcon | null {
  const key = brandKeyFor(provider);
  if (!key) return null;
  const brand = BRANDS[key];
  if (!brand?.path) return null;
  return brand;
}

/** Deterministic fallback hue for brand-less providers (proxies, plans). */
export function fallbackHue(provider: string): number {
  let hash = 0;
  for (const ch of provider) hash = (hash * 31 + ch.charCodeAt(0)) % 997;
  return HUES[hash % HUES.length] ?? 262;
}
