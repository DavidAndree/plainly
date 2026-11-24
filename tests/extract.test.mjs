import assert from 'node:assert/strict';
import * as chrono from 'chrono-node';
import { createExtractor, findTerms, iso } from '../docs/js/extract.js';
import { samples } from '../docs/js/samples.js';
const { extract } = createExtractor(chrono);
const plus = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return iso(d); };
const S = Object.fromEntries(samples().map((s) => [s.id, s.text]));

for (const [id, text] of Object.entries(S)) {
  const r = extract(text);
  console.log(`\n## ${id}: ${r.category.icon} ${r.category.label} · urgency=${r.urgency} · deadline=${r.deadline?.iso} (${r.daysLeft} days)`);
  console.log('  money', r.money.join(', '), '| phones', r.phones.join(', '), '| sites', r.sites.join(', '));
  console.log('  refs', r.refs.map((x) => `${x.label}=${x.value}`).join(', '));
  r.steps.forEach((s) => console.log('  STEP', s.slice(0, 110)));
  r.consequences.forEach((s) => console.log('  IF NOT', s.slice(0, 110)));
  console.log('  terms', findTerms(text).join(', '));
}
const h = extract(S.health); assert.equal(h.category.id, 'health'); assert.equal(h.deadline.iso, plus(12), 'health deadline is the return date, not the notice date or termination date');
assert.ok(h.refs.some((r) => r.value === 'HC-2048-7731')); assert.ok(h.phones.includes('555-201-4400'));
const r2 = extract(S.housing); assert.equal(r2.category.id, 'housing'); assert.equal(r2.deadline.iso, plus(6)); assert.ok(r2.money.includes('$310.00')); assert.equal(r2.urgency, 'urgent');
const u = extract(S.utility); assert.equal(u.category.id, 'utility'); assert.equal(u.deadline.iso, plus(4)); assert.equal(u.urgency, 'urgent');
assert.ok(findTerms(S.health).includes('fair hearing') && findTerms(S.health).includes('adverse action'));
console.log('\n✔ extractor tests passed');
