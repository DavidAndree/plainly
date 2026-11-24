// On-device AI (WebLLM on WebGPU). The letter never leaves the device: model weights are
// downloaded once and cached; inference runs on the user's GPU.
const WEBLLM_URL = 'https://cdn.jsdelivr.net/npm/@mlc-ai/web-llm@0.2.86/+esm';
export const MODEL_ID = 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC';

export const LANGS = {
  en: { name: 'English', english: 'English', voice: 'en-US' },
  es: { name: 'Español', english: 'Spanish', voice: 'es-US' },
  zh: { name: '中文', english: 'Simplified Chinese', voice: 'zh-CN' },
  vi: { name: 'Tiếng Việt', english: 'Vietnamese', voice: 'vi-VN' },
  tl: { name: 'Tagalog', english: 'Tagalog', voice: 'fil-PH' },
  fr: { name: 'Français', english: 'French', voice: 'fr-FR' },
  pt: { name: 'Português', english: 'Portuguese', voice: 'pt-BR' },
  ar: { name: 'العربية', english: 'Arabic', voice: 'ar-SA', rtl: true },
};

let engine = null; let loading = null;
export const aiSupported = () => typeof navigator !== 'undefined' && !!navigator.gpu;
export const aiReady = () => !!engine;

export async function loadAI(onProgress = () => {}) {
  if (engine) return engine;
  if (!aiSupported()) throw new Error('This browser has no WebGPU (try Chrome or Edge on a computer)');
  loading ??= (async () => {
    if (!(await navigator.gpu.requestAdapter())) throw new Error('No compatible GPU found');
    const webllm = await import(WEBLLM_URL);
    engine = await webllm.CreateMLCEngine(MODEL_ID, { initProgressCallback: (r) => onProgress(r.progress ?? 0, r.text ?? '') });
    return engine;
  })().catch((e) => { loading = null; throw e; });
  return loading;
}

const SCHEMA = JSON.stringify({
  type: 'object',
  properties: {
    summary: { type: 'string' },
    steps: { type: 'array', items: { type: 'string' } },
    ifNot: { type: 'string' },
  },
  required: ['summary', 'steps', 'ifNot'],
});

/**
 * Simplify + translate the rule engine's verified explanation. The model never reads the letter
 * here: it rewrites sentences that are already correct, keeping every date, amount and number.
 */
export async function explain(verified, facts, lang = 'en', kind = '') {
  const eng = await loadAI();
  const L = LANGS[lang]?.english || 'English';
  const input = JSON.stringify({ summary: verified.summary, steps: verified.steps, ifNot: verified.ifNot });
  const res = await eng.chat.completions.create({
    temperature: 0.1,
    max_tokens: 520,
    response_format: { type: 'json_object', schema: SCHEMA },
    messages: [
      { role: 'system', content: `You rewrite explanations of official letters so anyone can understand them.
Rewrite the JSON you are given in ${L}, at a 5th-grade reading level: short sentences, everyday words, warm and calm, no legal jargon.
Keep exactly the same meaning and the same number of steps. Copy every date, money amount, phone number, website and case number EXACTLY as written. Do not add any new facts.
"summary": at most 2 short sentences. "steps": each starts with a verb. "ifNot": 1 sentence (empty string if the input is empty).` },
      { role: 'user', content: `This is a ${kind}.\n${input}\n\nRewrite it in ${L} only.` },
    ],
  });
  const out = JSON.parse(res.choices[0].message.content);
  out.steps = (out.steps || []).filter((s) => typeof s === 'string' && s.trim()).slice(0, 4);
  if (!out.steps.length) out.steps = verified.steps;
  // Safety net: if the rewrite dropped or changed a verified amount or phone number, keep the verified text.
  const digits = (s) => String(s).replace(/\D/g, '');
  const must = [facts.money, facts.phone].filter(Boolean).map(digits);
  const all = digits([out.summary, ...out.steps, out.ifNot].join(' '));
  const src = digits([verified.summary, ...verified.steps, verified.ifNot].join(' '));
  if (must.some((m) => src.includes(m) && !all.includes(m))) return { ...verified, keptOriginal: true };
  if (!out.ifNot && verified.ifNot) out.ifNot = verified.ifNot;
  return out;
}

/** Streaming phone script for calling the office about the letter. */
export async function* callScript(letter, facts, lang = 'en') {
  const eng = await loadAI();
  const L = LANGS[lang]?.english || 'English';
  const stream = await eng.chat.completions.create({
    stream: true, temperature: 0.4, max_tokens: 300,
    messages: [
      { role: 'system', content: `Write a short phone script in ${L} for someone calling about an official letter. Format:
Say: (2-3 sentences introducing themselves and the letter, using the reference number if given)
Ask: (3 short questions as bullet points with "•")
Have ready: (what to have in hand)
Use only these facts: reference ${facts.ref || 'none'}, deadline ${facts.deadline || 'none'}, amount ${facts.money || 'none'}. Use "[your name]" for the caller's name. Keep it under 110 words.` },
      { role: 'user', content: `LETTER:\n${letter.slice(0, 2400)}\n\nWrite the whole script in ${L} only.` },
    ],
  });
  for await (const part of stream) yield part.choices[0]?.delta?.content ?? '';
}
