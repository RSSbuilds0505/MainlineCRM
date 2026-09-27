/**
 * Provider-agnostic model access. Feature code calls complete() and never imports a provider SDK.
 * Every call declares its purpose, token budget and timeout, and returns null on any failure
 * so the feature can fall back gracefully.
 */
export type LlmCall = { purpose: string; system: string; prompt: string; maxTokens: number; timeoutMs: number };
export type LlmResult = { text: string; inputTokens: number; outputTokens: number };

interface Provider { name: string; complete(call: LlmCall): Promise<LlmResult> }

const anthropic: Provider = {
  name: 'anthropic',
  async complete(call) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), call.timeoutMs);
    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        signal: ctl.signal,
        headers: { 'content-type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY ?? '', 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({
          model: process.env.LLM_MODEL || 'claude-haiku-4-5-20251001',
          max_tokens: call.maxTokens,
          system: call.system,
          messages: [{ role: 'user', content: call.prompt }],
        }),
      });
      if (!res.ok) throw new Error(`anthropic ${res.status}`);
      const body = (await res.json()) as { content?: { type: string; text?: string }[]; usage?: { input_tokens?: number; output_tokens?: number } };
      const text = (body.content ?? []).filter((c) => c.type === 'text').map((c) => c.text ?? '').join('');
      return { text, inputTokens: body.usage?.input_tokens ?? 0, outputTokens: body.usage?.output_tokens ?? 0 };
    } finally {
      clearTimeout(timer);
    }
  },
};

function provider(): Provider | null {
  if (process.env.ANTHROPIC_API_KEY) return anthropic;
  return null;
}

export const llmEnabled = (): boolean => provider() !== null;

export async function complete(call: LlmCall): Promise<LlmResult | null> {
  const p = provider();
  if (!p) return null;
  const t0 = Date.now();
  try {
    const out = await p.complete(call);
    console.info(JSON.stringify({ llm: call.purpose, provider: p.name, in: out.inputTokens, out: out.outputTokens, ms: Date.now() - t0 }));
    return out;
  } catch (e) {
    console.error(JSON.stringify({ llm: call.purpose, provider: p.name, error: String(e), ms: Date.now() - t0 }));
    return null;
  }
}
