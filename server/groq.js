// Groq Chat Completions client (OpenAI-compatible API) using built-in fetch.

// Overridable for tests (GROQ_BASE_URL points at a local mock server).
const endpoint = () => process.env.GROQ_BASE_URL || 'https://api.groq.com/openai/v1';

export class GroqError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const sleep = (ms, signal) => new Promise((resolve, reject) => {
  const t = setTimeout(resolve, ms);
  signal?.addEventListener('abort', () => { clearTimeout(t); reject(new Error('aborted')); }, { once: true });
});

export async function groqChat(body, apiKey, { signal, retries = 2 } = {}) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${endpoint()}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
      signal,
    });
    if (res.ok) return res.json();

    let detail = {};
    try { detail = (await res.json())?.error ?? {}; } catch { /* non-JSON error body */ }
    const retryable = res.status === 429 || res.status >= 500;
    if (retryable && attempt < retries) {
      const after = Number(res.headers.get('retry-after'));
      await sleep(Math.min(Number.isFinite(after) && after > 0 ? after * 1000 : 1500 * (attempt + 1), 12000), signal);
      continue;
    }
    const code = res.status === 401 ? 'auth' : res.status === 429 ? 'rate_limit' : detail.code ?? `http_${res.status}`;
    throw new GroqError(res.status, detail.message ?? `Groq request failed (${res.status})`, code);
  }
}

export async function listModels(apiKey) {
  const res = await fetch(`${endpoint()}/models`, {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new GroqError(res.status, `Cannot list models (${res.status})`, res.status === 401 ? 'auth' : 'models');
  const data = await res.json();
  // Keep chat-capable text models only (drop speech, TTS and guard models).
  return (data.data ?? [])
    .map((m) => m.id)
    .filter((id) => !/whisper|tts|orpheus|guard|playai|distil/i.test(id))
    .sort();
}
