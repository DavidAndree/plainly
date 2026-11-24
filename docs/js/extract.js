// Plainly rule engine: finds what a letter is, what it asks, by when, and the numbers that matter.
// Works with no AI at all, and is also used to fact-check the on-device AI.
// chrono-node is injected so this file runs in the browser and in Node tests.

export const CATEGORIES = [
  { id: 'health', label: 'Health coverage notice', icon: '🩺', re: /\b(medicaid|medi-cal|chip|health coverage|health insurance|benefits renewal|renew your coverage|marketplace)\b/i },
  { id: 'food', label: 'Food assistance notice', icon: '🥫', re: /\b(snap|food stamps?|calfresh|wic|food assistance|ebt)\b/i },
  { id: 'housing', label: 'Housing / rent notice', icon: '🏠', re: /\b(landlord|tenant|lease|rent increase|notice to (quit|vacate|pay)|eviction|premises|unit #|apartment)\b/i },
  { id: 'utility', label: 'Utility bill or shut-off notice', icon: '💡', re: /\b(disconnect(ion)?|shut[- ]?off|service will be (terminated|interrupted)|utility|electric|water service|gas service|past due balance)\b/i },
  { id: 'tax', label: 'Tax letter', icon: '🧾', re: /\b(irs|internal revenue|tax return|tax year|department of revenue|franchise tax)\b/i },
  { id: 'court', label: 'Court paper', icon: '⚖️', re: /\b(court|summons|hearing|docket|plaintiff|defendant|judge|subpoena)\b/i },
  { id: 'debt', label: 'Debt collection letter', icon: '📮', re: /\b(debt collector|collection agency|validation notice|original creditor|attempt to collect a debt)\b/i },
  { id: 'immigration', label: 'Immigration notice', icon: '🛂', re: /\b(uscis|immigration|biometrics|form i-\d+|receipt notice)\b/i },
  { id: 'school', label: 'School letter', icon: '🎒', re: /\b(school district|student|enrollment|attendance|guardian)\b/i },
];

const ACTION = /\b(you must|you need to|please|return|submit|send|sign|call|contact|pay|attend|appear|provide|complete|bring|respond|reply|upload|log in|visit|mail|fax|schedule|update)\b/i;
const CONSEQUENCE = /\b(if you do not|if you don['’]t|if we do not receive|failure to|will (be )?(end|terminated|stop|closed|suspended|shut off|disconnected|denied|evict)|may (end|lose|be evicted|be charged)|lose your|late fee|penalt(y|ies)|eviction|default judgment)\b/i;
const DEADLINE_CUE = /\b(by|before|no later than|due|deadline|must|until|on or before|expires?|hearing|appointment|appear|respond within|effective)\b/i;
const SEVERE = /\b(terminat|shut ?off|disconnect|evict|court|summons|default judgment|lose (your )?(coverage|benefits)|final notice|garnish)\w*/i;

export function sentences(text) {
  return text.replace(/\r/g, '').replace(/[ \t]+/g, ' ')
    .split(/(?<=[.!?])\s+(?=[A-Z0-9“"(])|\n{2,}|\n(?=[-•*\d]+[.)]?\s)/)
    .map((s) => s.replace(/\s*\n\s*/g, ' ').replace(/^[-•*\s]+/, '').trim())
    .filter((s) => s.length > 3);
}

export function createExtractor(chrono) {
  function extract(text, { today = new Date() } = {}) {
    const clean = text.replace(/\r/g, '');
    const sents = sentences(clean);
    const category = CATEGORIES.find((c) => c.re.test(clean)) || { id: 'other', label: 'Official letter', icon: '✉️' };

    // Dates, scored by how deadline-like their sentence is.
    const dates = [];
    for (const s of sents) {
      for (const r of chrono.parse(s, today, { forwardDate: true })) {
        if (!r.start.isCertain('day')) continue;
        const d = r.start.date();
        const cue = DEADLINE_CUE.test(s); const act = ACTION.test(s); const cons = CONSEQUENCE.test(s);
        const past = d < new Date(today.getFullYear(), today.getMonth(), today.getDate());
        const score = (cue ? 3 : 0) + (act ? 2 : 0) + (cons ? 2 : 0) - (past ? 4 : 0) - (/\b(dated?|date of (this )?notice|letter date|sent on)\b/i.test(s) ? 5 : 0);
        dates.push({ date: d, iso: iso(d), text: r.text, sentence: s, score });
      }
    }
    dates.sort((a, b) => b.score - a.score || a.date - b.date);
    const deadline = dates.find((d) => d.score > 0) || null;

    const money = unique([...clean.matchAll(/\$\s?\d{1,3}(?:,\d{3})*(?:\.\d{2})?/g)].map((m) => m[0].replace(/\s/g, '')));
    const phones = unique([...clean.matchAll(/(?:\+?1[-.\s]?)?\(?\b\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}\b/g)].map((m) => m[0].trim()));
    const sites = unique([...clean.matchAll(/\b(?:https?:\/\/)?(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:gov|org|com|us|net)(?:\/[^\s,)]*)?/gi)].map((m) => m[0].replace(/[.,]$/, '')))
      .filter((s) => !/@/.test(s));
    const refs = [];
    for (const m of clean.matchAll(/\b(case (?:number|no\.?|#)|account (?:number|no\.?|#)|notice (?:id|number|no\.?)|reference (?:number|no\.?|#)?|docket (?:number|no\.?|#)|client id|member id|unit)\s*[:#]?\s*([A-Z0-9][A-Z0-9-]{2,})/gi)) {
      refs.push({ label: cap(m[1].replace(/\s+/g, ' ')), value: m[2] });
    }

    const isStep = (s) => ACTION.test(s) && !CONSEQUENCE.test(s) && s.length < 260
      && s !== s.toUpperCase()                                   // not a heading
      && !/^(please\s+)?be advised|^it is time|^dear\b|^sincerely/i.test(s);
    const steps = unique(sents.filter(isStep)
      .sort((a, b) => (deadline && b.includes(deadline.text) ? 1 : 0) - (deadline && a.includes(deadline.text) ? 1 : 0))
      .map((s) => s.replace(/^(please\s+)/i, '').replace(/^\w/, (c) => c.toUpperCase()))).slice(0, 6);
    const consequences = unique(sents.filter((s) => CONSEQUENCE.test(s) && s.length < 280)).slice(0, 3);

    const daysLeft = deadline ? Math.round((startOfDay(deadline.date) - startOfDay(today)) / 864e5) : null;
    const severe = SEVERE.test(clean);
    const urgency = daysLeft != null && daysLeft <= 7 ? 'urgent' : (daysLeft != null && daysLeft <= 21) || severe ? 'soon' : 'fyi';

    return { category, deadline, daysLeft, urgency, severe, dates, money, phones, sites, refs, steps, consequences, sentences: sents };
  }
  return { extract };
}

// Plain-language explanations for words that make official letters hard to read.
export const GLOSSARY = {
  'recertification': 'Proving again that you still qualify, usually every year.',
  'redetermination': 'The agency checking again whether you still qualify.',
  'renewal': 'Re-applying so your benefits or coverage keep going.',
  'eligibility': 'Whether you qualify.',
  'verification': 'Proof, like pay stubs, ID or a lease.',
  'terminate': 'End or stop.',
  'terminated': 'Ended or stopped.',
  'termination': 'The end of something, like your coverage or service.',
  'adverse action': 'A decision that cuts or stops your benefits.',
  'fair hearing': 'Your right to have a judge review the agency’s decision. Asking is free.',
  'appeal': 'Asking for a decision to be reviewed and changed.',
  'household': 'The people you live and share food or money with.',
  'income': 'Money you get, like wages, tips or benefits.',
  'arrears': 'Money that is overdue.',
  'past due': 'Late: it should already have been paid.',
  'balance': 'The amount you still owe.',
  'disconnection': 'Your service (power, gas, water) being turned off.',
  'payment arrangement': 'A plan to pay what you owe in smaller parts over time.',
  'notice to quit': 'A landlord’s written notice that you must move out. It is not an eviction by itself.',
  'notice to vacate': 'A written notice asking you to move out by a date.',
  'eviction': 'A court process to make a tenant leave. Only a court can order it.',
  'premises': 'The home or property.',
  'lease': 'Your rental contract.',
  'tenancy': 'Your right to live in the rental.',
  'security deposit': 'Money you paid at move-in that should come back if there’s no damage.',
  'summons': 'An official paper saying you’re part of a court case and must respond.',
  'plaintiff': 'The person or company that started the court case.',
  'defendant': 'The person the court case is against.',
  'default judgment': 'If you don’t respond, the court can decide against you automatically.',
  'docket': 'The court’s case number and schedule.',
  'garnishment': 'Taking money straight from your paycheck or bank to pay a debt.',
  'lien': 'A legal claim on your property until a debt is paid.',
  'creditor': 'Who you owe money to.',
  'validation notice': 'A debt collector’s letter you can use to ask them to prove the debt.',
  'dispute': 'Telling them you disagree, usually in writing.',
  'pursuant to': 'Because of, or according to.',
  'hereby': 'By this letter.',
  'effective': 'Starting on.',
  'remit': 'Send (usually money).',
  'deemed': 'Treated as.',
  'in lieu of': 'Instead of.',
  'notwithstanding': 'Even though.',
  'biometrics': 'Fingerprints and a photo taken at an appointment.',
  'beneficiary': 'The person who gets the benefit.',
  'premium': 'The monthly cost of insurance.',
  'copay': 'A fixed amount you pay for a visit or medicine.',
};

export function findTerms(text) {
  const low = text.toLowerCase();
  return Object.keys(GLOSSARY).filter((t) => new RegExp(`\\b${t.replace(/ /g, '\\s+')}\\b`, 'i').test(low))
    .sort((a, b) => b.length - a.length)
    .filter((t, i, all) => !all.slice(0, i).some((longer) => longer.includes(t)));
}

export function iso(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
function startOfDay(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
function unique(a) { return [...new Set(a)]; }
function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
