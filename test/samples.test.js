// Runs the real exported PDFs if they are present in test/private (git-ignored).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Decoder, Stream } from '@garmin/fitsdk';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { extractSession } from '../src/extract.js';
import { buildPlan } from '../src/parser.js';
import { encodeWorkout } from '../src/fit.js';

const dir = new URL('./private/', import.meta.url).pathname;
const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.pdf')).sort() : [];

async function read(file) {
  const doc = await getDocument({ data: new Uint8Array(fs.readFileSync(path.join(dir, file))), verbosity: 0 }).promise;
  const pages = [];
  for (let i = 1; i <= doc.numPages; i++) pages.push((await (await doc.getPage(i)).getTextContent()).items);
  return extractSession(pages);
}

const EXPECTED = {
  'PDF_6ae3b9725c56ead1ecd11167.pdf': { date: '2026-10-29', distance: 2400, warn: [] },
  'PDF_6ae3ca1ec9b4353e7b966363.pdf': { date: '2026-10-31', distance: 2900, warn: [/150 MAX|150 \+|adds up to 250m/] },
  'PDF_6ae3ca1fc9b4353e7b966441.pdf': { date: '2026-11-02', distance: 3600, warn: [/3\.3km/] },
  'PDF_6ae3ca1fc9b4353e7b96646a.pdf': { date: '2026-11-04', distance: 2900, warn: [] },
};

for (const file of files) {
  test(`sample ${file}`, async (t) => {
    const expected = EXPECTED[file];
    if (!expected) return t.skip('no expectation recorded');
    const { text, date } = await read(file);
    assert.equal(date, expected.date);
    const plan = buildPlan(text);
    assert.equal(plan.totalDistance, expected.distance);
    const real = plan.warnings.filter((w) => w.level === 'warn');
    assert.equal(real.length, expected.warn.length, JSON.stringify(plan.warnings));
    expected.warn.forEach((p, i) => assert.match(real[i].text, p));
    const decoder = new Decoder(Stream.fromByteArray(Array.from(encodeWorkout(plan, { name: 'x' }))));
    assert.ok(decoder.checkIntegrity());
    assert.deepEqual(decoder.read().errors, []);
  });
}
