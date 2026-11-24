import * as chrono from 'https://cdn.jsdelivr.net/npm/chrono-node@2.7.7/+esm';
import { createExtractor, findTerms, GLOSSARY } from './extract.js?v=1';
import { samples } from './samples.js?v=1';
import { LANGS, aiSupported, aiReady, loadAI, explain, callScript } from './ai.js?v=1';

const TESSERACT = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.esm.min.js';
const { extract } = createExtractor(chrono);
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const longDate = (d, lang = 'en') => d.toLocaleDateString(lang === 'en' ? 'en-US' : lang, { weekday: 'long', month: 'long', day: 'numeric' });
let current = null; // { text, facts, plain }

/* ---------- setup ---------- */
$('#lang').innerHTML = Object.entries(LANGS).map(([k, v]) => `<option value="${k}">${v.name}</option>`).join('');
try { $('#lang').value = localStorage.getItem('plainly:lang') || (navigator.language || 'en').slice(0, 2); } catch {}
if (!$('#lang').value) $('#lang').value = 'en';
$('#lang').addEventListener('change', () => { try { localStorage.setItem('plainly:lang', $('#lang').value); } catch {} });
if (!aiSupported()) { $('#ai-toggle').disabled = true; $('#ai-hint').textContent = 'Needs WebGPU (Chrome or Edge on a computer). Plainly still works without it.'; }
else { try { $('#ai-toggle').checked = localStorage.getItem('plainly:ai') === '1'; } catch {} }
$('#ai-toggle').addEventListener('change', () => { try { localStorage.setItem('plainly:ai', $('#ai-toggle').checked ? '1' : '0'); } catch {} if ($('#ai-toggle').checked) warmAI(); });

$('#sample-btns').innerHTML = samples().map((s) => `<button data-sample="${s.id}">${s.label}</button>`).join('');
$('#sample-btns').addEventListener('click', (e) => {
  const id = e.target.closest('[data-sample]')?.dataset.sample; if (!id) return;
  setTab('paste'); $('#paste').value = samples().find((s) => s.id === id).text; run();
});

function setTab(t) {
  document.querySelectorAll('[data-tab]').forEach((b) => b.setAttribute('aria-selected', b.dataset.tab === t));
  $('#pane-photo').hidden = t !== 'photo'; $('#pane-paste').hidden = t !== 'paste';
}
document.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => setTab(b.dataset.tab)));

/* ---------- reading photos & PDFs ---------- */
const drop = $('#drop'); const file = $('#file');
drop.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); file.click(); } });
['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
drop.addEventListener('drop', (e) => readFile(e.dataTransfer.files[0]));
file.addEventListener('change', () => { readFile(file.files[0]); file.value = ''; });

function progress(id, p, text) { const el = $(id); el.hidden = false; $('i', el).style.width = `${Math.round(p * 100)}%`; $('span', el).textContent = text; }

async function ocr(image) {
  const { createWorker } = await import(TESSERACT);
  const worker = await createWorker('eng', 1, { logger: (m) => { if (m.status) progress('#ocr-progress', m.progress || 0, `${m.status[0].toUpperCase()}${m.status.slice(1)}…`); } });
  const { data } = await worker.recognize(image);
  await worker.terminate();
  return data.text;
}

async function readFile(f) {
  if (!f) return;
  try {
    let text = '';
    if (f.type === 'application/pdf' || /\.pdf$/i.test(f.name)) {
      progress('#ocr-progress', 0.1, 'Opening PDF…');
      const pdfjs = window.pdfjsLib;
      pdfjs.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
      const pdf = await pdfjs.getDocument({ data: await f.arrayBuffer() }).promise;
      for (let p = 1; p <= Math.min(pdf.numPages, 6); p++) {
        const page = await pdf.getPage(p);
        const tc = await page.getTextContent();
        let line = null;
        for (const it of tc.items) { const y = Math.round(it.transform[5]); text += (line !== null && Math.abs(y - line) > 2 ? '\n' : ' ') + it.str; line = y; }
        text += '\n\n';
        if (text.trim().length < 40 && p === 1) { // scanned PDF: render and OCR the first page
          const vp = page.getViewport({ scale: 2 }); const c = document.createElement('canvas'); c.width = vp.width; c.height = vp.height;
          await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
          text = await ocr(c); break;
        }
      }
    } else {
      progress('#ocr-progress', 0.02, 'Getting the text reader ready…');
      text = await ocr(f);
    }
    $('#ocr-progress').hidden = true;
    if (text.trim().length < 30) { toast('I could not read much text. Try a flatter, brighter photo, or paste the text.'); return; }
    setTab('paste'); $('#paste').value = text.trim();
    toast('Letter read. Check the text if you like, then press “Explain my letter”.');
    run();
  } catch (err) {
    console.error(err); $('#ocr-progress').hidden = true;
    toast('Sorry, that file could not be read. Try a photo, or paste the text.');
  }
}

/* ---------- analysis ---------- */
async function warmAI() {
  if (aiReady()) return true;
  try {
    await loadAI((p, t) => progress('#ai-progress', p, t.replace(/\[.*?\]\s*/, '') || 'Loading the on-device AI…'));
    progress('#ai-progress', 1, 'On-device AI ready'); setTimeout(() => { $('#ai-progress').hidden = true; }, 1200);
    return true;
  } catch (e) {
    $('#ai-progress').hidden = true; $('#ai-toggle').checked = false;
    toast(`On-device AI unavailable (${e.message}). Using the built-in reader.`); return false;
  }
}

$('#btn-go').addEventListener('click', run);
async function run() {
  const text = $('#paste').value.trim();
  if (text.length < 40) { setTab('paste'); $('#paste').focus(); toast('Add a photo of the letter, or paste its text first.'); return; }
  const btn = $('#btn-go'); btn.disabled = true; btn.textContent = 'Reading your letter…';
  try {
    const r = extract(text);
    const lang = $('#lang').value;
    const moneyDue = r.money.find((m) => new RegExp(`(due|balance|owe|pay|arrears)[^.]{0,60}\\${m.replace('$', '')}|\\${m.replace('$', '')}[^.]{0,40}(due|balance)`, 'i').test(text)) || r.money[0];
    const facts = {
      deadline: r.deadline ? longDate(r.deadline.date) : null,
      money: moneyDue || null, phone: r.phones[0] || null, site: r.sites[0] || null,
      ref: r.refs[0] ? `${r.refs[0].label} ${r.refs[0].value}` : null,
    };
    let plain = null;
    if ($('#ai-toggle').checked && aiSupported() && await warmAI()) {
      btn.textContent = 'Writing it in plain words…';
      try { plain = { ...(await explain(text, facts, lang)), by: 'ai' }; } catch (e) { console.warn('AI explain failed', e); }
    }
    if (!plain) plain = ruleSummary(r, facts, text);
    current = { text, r, facts, plain, lang: plain.by === 'ai' ? lang : 'en' };
    render();
    if (lang !== 'en' && plain.by !== 'ai') toast('Turn on “On-device AI” to get the explanation in your language.');
  } finally { btn.disabled = false; btn.textContent = 'Explain my letter'; }
}

function sender(text) {
  const line = text.split('\n').map((l) => l.trim()).find((l) => l.length > 3 && !/sample|fictional|notice|^date|^to:|^\W+$/i.test(l));
  return line ? line.replace(/\s+/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()).replace(/\b(Of|And|The|For)\b/g, (w) => w.toLowerCase()) : null;
}
function ruleSummary(r, facts, text) {
  const who = sender(text);
  // The core action, trimmed to its verb phrase: "return the enclosed renewal form and verification of income".
  let first = r.steps[0] ? r.steps[0].replace(/^(you must|you need to|to avoid [^,]+,\s*)/i, '').replace(/^please\s+/i, '') : null;
  if (first) first = first.split(/\s\(|,\s| no later than | on or before | by (?=[A-Z0-9])| before (?=[A-Z0-9])/)[0].replace(/\.$/, '').trim();
  const summary = `This is a ${r.category.label.toLowerCase()}${who ? ` from ${who}` : ''}.` +
    (first ? ` You need to ${first.charAt(0).toLowerCase()}${first.slice(1)}${facts.deadline ? ` by ${facts.deadline}` : ''}.` : facts.deadline ? ` The key date is ${facts.deadline}.` : '');
  const plainer = (s) => s.replace(/\bremit\b/gi, 'pay').replace(/\bterminated\b/gi, 'ended').replace(/\bterminate\b/gi, 'end')
    .replace(/\bpursuant to\b/gi, 'under').replace(/\bin lieu of\b/gi, 'instead of').replace(/\bin arrears\b/gi, 'overdue').replace(/\beffective\b/gi, 'starting');
  return { summary: plainer(summary), steps: r.steps.slice(0, 4), ifNot: r.consequences[0] || '', by: 'rules' };
}

/* ---------- render ---------- */
function render() {
  const { r, facts, plain, lang } = current;
  $('#intake').hidden = true; $('#result').hidden = false; window.scrollTo({ top: 0, behavior: 'smooth' });
  $('#plain').dir = LANGS[lang]?.rtl ? 'rtl' : 'ltr';
  const b = $('#banner'); b.className = `banner ${r.urgency}`;
  if (r.deadline && r.daysLeft >= 0) {
    b.innerHTML = `<span class="big">${r.daysLeft}</span><span>${r.daysLeft === 1 ? 'day' : 'days'} left${r.urgency === 'urgent' ? ': act now' : ''}<small>Deadline: ${esc(longDate(r.deadline.date))}</small></span>`;
  } else if (r.deadline) {
    b.innerHTML = `<span>⚠️ The date in this letter (${esc(longDate(r.deadline.date))}) may have passed. Call them today.</span>`; b.className = 'banner urgent';
  } else b.innerHTML = '<span>No deadline found<small>Still read the steps below, and check the original letter.</small></span>';
  $('#kind').textContent = `${r.category.icon} ${r.category.label}`;
  $('#summary').textContent = plain.summary;
  $('#source').textContent = plain.by === 'ai' ? `Explained by on-device AI (${LANGS[lang].name}). Dates and numbers are checked against the letter.` : 'Explained by Plainly’s built-in reader. Turn on on-device AI for simpler wording and other languages.';
  $('#steps').innerHTML = (plain.steps.length ? plain.steps : ['Read the letter carefully and call the number on it if anything is unclear.'])
    .map((s, i) => `<li><label><input type="checkbox" aria-label="Mark step ${i + 1} done"><span>${esc(s)}</span></label></li>`).join('');
  const ifnot = $('#ifnot'); ifnot.hidden = !plain.ifNot; $('p', ifnot).textContent = plain.ifNot;
  $('#script').hidden = true; $('#script').textContent = '';

  const tel = (p) => `<a href="tel:${p.replace(/[^\d+]/g, '')}">${esc(p)}</a>`;
  const rows = [
    r.deadline && ['📅', 'Deadline', esc(longDate(r.deadline.date))],
    facts.money && ['💵', 'Amount', esc(facts.money)],
    r.phones[0] && ['☎️', 'Phone', r.phones.slice(0, 2).map(tel).join(' · ')],
    r.sites[0] && ['🌐', 'Website', `<a href="https://${esc(r.sites[0].replace(/^https?:\/\//, ''))}" target="_blank" rel="noopener">${esc(r.sites[0])}</a>`],
    ...r.refs.slice(0, 2).map((x) => ['🔖', x.label, esc(x.value)]),
  ].filter(Boolean);
  $('#facts').innerHTML = rows.map(([ic, k, v]) => `<div class="fact"><span class="ic" aria-hidden="true">${ic}</span><div><dt>${esc(k)}</dt><dd>${v}</dd></div></div>`).join('') || '<p>No dates, amounts or phone numbers found.</p>';

  const terms = findTerms(current.text);
  $('#words').innerHTML = terms.slice(0, 8).map((t) => `<div class="word"><dt>${esc(t)}</dt><dd>${esc(GLOSSARY[t])}</dd></div>`).join('') || '<p>No hard words found. Nice letter!</p>';
  let html = esc(current.text);
  if (r.deadline) html = html.replace(esc(r.deadline.text), `<mark class="deadline" title="Deadline">${esc(r.deadline.text)}</mark>`);
  for (const t of terms) html = html.replace(new RegExp(`\\b(${t.replace(/ /g, '\\s+')})\\b`, 'gi'), `<mark title="${esc(GLOSSARY[t])}">$1</mark>`);
  $('#letter').innerHTML = html;
}

$('#steps').addEventListener('change', (e) => e.target.closest('li')?.classList.toggle('done', e.target.checked));
$('#btn-new').addEventListener('click', () => { speechSynthesis?.cancel(); $('#result').hidden = true; $('#intake').hidden = false; $('#paste').value = ''; window.scrollTo({ top: 0 }); });
$('#home').addEventListener('click', (e) => { e.preventDefault(); $('#btn-new').click(); });

/* ---------- read aloud ---------- */
$('#btn-read').addEventListener('click', () => {
  const btn = $('#btn-read');
  if (!('speechSynthesis' in window)) { toast('Read aloud is not supported in this browser.'); return; }
  if (speechSynthesis.speaking) { speechSynthesis.cancel(); btn.setAttribute('aria-pressed', 'false'); btn.textContent = '🔊 Read aloud'; return; }
  const { plain, lang, r } = current;
  const parts = [plain.summary, ...(plain.steps || []).map((s, i) => `${i + 1}. ${s}`), plain.ifNot].filter(Boolean);
  if (r.deadline && lang === 'en') parts.splice(1, 0, `The deadline is ${longDate(r.deadline.date)}.`);
  const u = new SpeechSynthesisUtterance(parts.join(' '));
  u.lang = LANGS[lang]?.voice || 'en-US'; u.rate = 0.92;
  u.onend = u.onerror = () => { btn.setAttribute('aria-pressed', 'false'); btn.textContent = '🔊 Read aloud'; };
  speechSynthesis.speak(u); btn.setAttribute('aria-pressed', 'true'); btn.textContent = '⏹ Stop reading';
});

/* ---------- calendar & print ---------- */
$('#btn-cal').addEventListener('click', () => {
  const { r, plain } = current;
  if (!r.deadline) { toast('No deadline found to add.'); return; }
  const d = r.deadline.date; const ymd = (x) => `${x.getFullYear()}${String(x.getMonth() + 1).padStart(2, '0')}${String(x.getDate()).padStart(2, '0')}`;
  const next = new Date(d); next.setDate(d.getDate() + 1);
  const e = (s) => String(s).replace(/[\\;,]/g, (c) => `\\${c}`).replace(/\n/g, '\\n');
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const desc = [plain.summary, '', ...plain.steps.map((s, i) => `${i + 1}. ${s}`), r.phones[0] ? `Phone: ${r.phones[0]}` : ''].join('\n');
  const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Plainly//Letter deadline//EN', 'BEGIN:VEVENT', `UID:${ymd(d)}-${r.category.id}@plainly`, `DTSTAMP:${stamp}`,
    `DTSTART;VALUE=DATE:${ymd(d)}`, `DTEND;VALUE=DATE:${ymd(next)}`, `SUMMARY:${e(`DEADLINE: ${r.category.label}`)}`, `DESCRIPTION:${e(desc)}`,
    'BEGIN:VALARM', 'ACTION:DISPLAY', 'TRIGGER:-P3D', `DESCRIPTION:${e(`3 days left: ${r.category.label}`)}`, 'END:VALARM',
    'BEGIN:VALARM', 'ACTION:DISPLAY', 'TRIGGER:-P1D', `DESCRIPTION:${e(`Tomorrow: ${r.category.label}`)}`, 'END:VALARM', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n') + '\r\n';
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([ics], { type: 'text/calendar' })); a.download = 'letter-deadline.ics'; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  toast('Calendar file downloaded, with reminders 3 days and 1 day before.');
});
$('#btn-print').addEventListener('click', () => window.print());

/* ---------- phone script ---------- */
$('#btn-script').addEventListener('click', async () => {
  const box = $('#script'); const btn = $('#btn-script'); const { text, facts, r } = current;
  box.hidden = false; box.textContent = ''; btn.disabled = true;
  try {
    if ($('#ai-toggle').checked && aiSupported() && (aiReady() || await warmAI())) {
      box.classList.add('caret');
      for await (const tok of callScript(text, facts, $('#lang').value)) box.textContent += tok;
    } else {
      box.textContent = `Say: Hi, my name is [your name]. I got a letter from you${facts.ref ? ` (${facts.ref})` : ''} and I want to make sure I do what's needed${facts.deadline ? ` before ${facts.deadline}` : ''}.\n\nAsk:\n• What exactly do you need from me, and how can I send it?\n• Can you confirm the deadline${facts.money ? ` and the amount of ${facts.money}` : ''}?\n• If I need more time or help paying, what are my options?\n\nHave ready: the letter, a pen, ${r.refs[0] ? `your ${r.refs[0].label.toLowerCase()}, ` : ''}and your ID.`;
    }
  } catch (e) { box.textContent = `Could not write a script: ${e.message}`; }
  finally { box.classList.remove('caret'); btn.disabled = false; }
});

/* ---------- misc ---------- */
$('#btn-theme').addEventListener('click', () => {
  const d = document.documentElement; const cur = d.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  d.dataset.theme = cur === 'dark' ? 'light' : 'dark'; try { localStorage.setItem('plainly:theme', d.dataset.theme); } catch {}
});
function toast(m) { const t = $('#toast'); t.textContent = m; t.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 4200); }
