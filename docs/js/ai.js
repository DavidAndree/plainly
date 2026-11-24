// On-device AI (WebLLM on WebGPU). The letter never leaves the device: model weights are
// downloaded once and cached; inference runs on the user's GPU.
const WEBLLM_URL = 'https://cdn.jsdelivr.net/npm/@mlc-ai/web-llm@0.2.86/+esm';
export const MODEL_ID = 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC';

export const LANGS = {
  en: { name: 'English', voice: 'en-US' },
  es: { name: 'Español', voice: 'es-US' },
  zh: { name: '中文', voice: 'zh-CN' },
  vi: { name: 'Tiếng Việt', voice: 'vi-VN' },
  tl: { name: 'Tagalog', voice: 'fil-PH' },
  fr: { name: 'Français', voice: 'fr-FR' },
  pt: { name: 'Português', voice: 'pt-BR' },
  ar: { name: 'العربية', voice: 'ar-SA', rtl: true },
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
 * Plain-language explanation. Facts (deadline, amounts, numbers) are passed in from the rule
 * engine and the model is told to use only those, so it explains rather than invents.
 */
export async function explain(letter, facts, lang = 'en') {
  const eng = await loadAI();
  const L = LANGS[lang]?.name || 'English';
  const res = await eng.chat.completions.create({
    temperature: 0.2,
    max_tokens: 420,
    response_format: { type: 'json_object', schema: SCHEMA },
    messages: [
      { role: 'system', content: `You help people understand official letters. Write in ${L}, at a 5th-grade reading level, short sentences, warm and calm, no legal jargon.
Return JSON: "summary" = 2 short sentences: what this letter is and the most important thing to do. "steps" = 2 to 4 short action steps, most urgent first, each starting with a verb. "ifNot" = 1 sentence: what happens if they do nothing.
Use ONLY these verified facts for dates, money and phone numbers; do not add any others:
Deadline: ${facts.deadline || 'none found'}. Amounts: ${facts.money || 'none'}. Phone: ${facts.phone || 'none'}. Website: ${facts.site || 'none'}.` },
      { role: 'user', content: letter.slice(0, 3500) },
    ],
  });
  const out = JSON.parse(res.choices[0].message.content);
  out.steps = (out.steps || []).filter((s) => typeof s === 'string' && s.trim()).slice(0, 4);
  return out;
}

/** Streaming phone script for calling the office about the letter. */
export async function* callScript(letter, facts, lang = 'en') {
  const eng = await loadAI();
  const L = LANGS[lang]?.name || 'English';
  const stream = await eng.chat.completions.create({
    stream: true, temperature: 0.4, max_tokens: 300,
    messages: [
      { role: 'system', content: `Write a short phone script in ${L} for someone calling about an official letter. Format:
Say: (2-3 sentences introducing themselves and the letter, using the reference number if given)
Ask: (3 short questions as bullet points with "•")
Have ready: (what to have in hand)
Use only these facts: reference ${facts.ref || 'none'}, deadline ${facts.deadline || 'none'}, amount ${facts.money || 'none'}. Use "[your name]" for the caller's name. Keep it under 110 words.` },
      { role: 'user', content: letter.slice(0, 2500) },
    ],
  });
  for await (const part of stream) yield part.choices[0]?.delta?.content ?? '';
}
