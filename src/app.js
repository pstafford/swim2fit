import * as pdfjs from '../vendor/pdf.min.mjs';
import { extractSession } from './extract.js';
import { buildPlan, poolWarnings } from './parser.js';
import { encodeWorkout } from './fit.js';

pdfjs.GlobalWorkerOptions.workerSrc = new URL('../vendor/pdf.worker.min.mjs', import.meta.url).href;

const MAX_STEPS = 50;
const $ = (id) => document.getElementById(id);
const sessions = [];
let current = null;
let plan = null;

const settings = { pool: 25, pauses: true };

function defaultName(date) {
  if (!date) return 'Swim';
  const [, month, day] = date.split('-').map(Number);
  return `Swim ${day} ${'JanFebMarAprMayJunJulAugSepOctNovDec'.slice((month - 1) * 3, month * 3)}`;
}

async function readPdf(file) {
  const doc = await pdfjs.getDocument({ data: await file.arrayBuffer(), verbosity: 0 }).promise;
  const pages = [];
  for (let i = 1; i <= doc.numPages; i++) {
    pages.push((await (await doc.getPage(i)).getTextContent()).items);
  }
  const { text, date } = extractSession(pages);
  return { name: defaultName(date), date, text, doc };
}

async function addFiles(files) {
  const failed = [];
  for (const file of files) {
    try {
      sessions.push(await readPdf(file));
    } catch (error) {
      console.error(error);
      failed.push(file.name);
    }
  }
  sessions.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  if (sessions.length) select(sessions[0]);
  if (failed.length) alert(`Could not read: ${failed.join(', ')}`);
}

function select(session) {
  current = session;
  $('session').hidden = false;
  $('name').value = session.name;
  $('text').value = session.text;
  $('originalBox').hidden = !session.doc;
  $('originalBox').open = false;
  renderTabs();
  update();
}

function renderTabs() {
  const tabs = $('tabs');
  tabs.hidden = sessions.length < 2;
  tabs.replaceChildren(...sessions.map((s) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = s.name;
    b.setAttribute('aria-current', String(s === current));
    b.addEventListener('click', () => select(s));
    return b;
  }));
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

const EQUIPMENT_LABEL = { fins: 'fins', paddles: 'paddles', pullBuoy: 'pull buoy', kickboard: 'board', snorkel: 'snorkel' };
const SECTION_LABEL = { warmup: 'Warm up', main: 'Main set', cooldown: 'Warm down' };

function stepItem(step) {
  const li = el('li', step.type === 'rest' ? 'rest' : '');
  li.append(step.type === 'rest' && !step.secs ? `${step.name}: press lap to go` : step.name);
  if (step.type === 'swim') {
    if (step.equipment) li.append(el('span', 'tag', EQUIPMENT_LABEL[step.equipment]));
    if (step.stroke === 'drill') li.append(el('span', 'tag', 'lap button'));
    if (step.notes.length) li.append(el('small', '', step.notes.join('. ')));
  }
  return li;
}

function sectionOf(node) {
  if (node.type === 'repeat') return sectionOf(node.children[0]);
  return node.section;
}

function renderSteps() {
  const items = [];
  let section = null;
  for (const node of plan.nodes) {
    const nodeSection = node.type === 'rest' ? section : sectionOf(node);
    if (nodeSection !== section) {
      section = nodeSection;
      items.push(el('li', 'section', SECTION_LABEL[section]));
    }
    if (node.type === 'repeat') {
      const li = el('li', 'repeat');
      li.append(el('span', 'count', `Repeat ${node.count} times`));
      const inner = el('ol');
      inner.append(...node.children.map(stepItem));
      li.append(inner);
      items.push(li);
    } else {
      items.push(stepItem(node));
    }
  }
  $('steps').replaceChildren(...items);
}

function update() {
  if (!current) return;
  current.name = $('name').value;
  current.text = $('text').value;
  plan = buildPlan(current.text, { pauses: settings.pauses });

  const warnings = [...plan.warnings, ...poolWarnings(plan, settings.pool)];
  if (plan.stepCount > MAX_STEPS) {
    warnings.push({ level: 'warn', text: `This workout has ${plan.stepCount} watch steps. Some older watches limit a workout to ${MAX_STEPS}.` });
  }
  warnings.sort((a, b) => (a.level === b.level ? 0 : a.level === 'warn' ? -1 : 1));
  $('warnings').replaceChildren(...warnings.map((w) => el('div', w.level, w.text)));

  $('summary').textContent = `${(plan.totalDistance / 1000).toFixed(1)} km in ${plan.stepCount} watch steps`;
  $('download').disabled = plan.nodes.length === 0;
  renderSteps();
  renderTabs();
}

async function renderOriginal() {
  if (!current?.doc) return;
  const page = await current.doc.getPage(1);
  const viewport = page.getViewport({ scale: 1.5 });
  const canvas = $('original');
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  await page.render({ canvas, canvasContext: canvas.getContext('2d'), viewport }).promise;
}

function download() {
  const name = current.name.trim() || 'Swim';
  const bytes = encodeWorkout(plan, { name, poolLength: settings.pool });
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'swim';
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([bytes], { type: 'application/octet-stream' }));
  link.download = `${current.date ? `${current.date}-` : ''}${slug}.fit`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

$('files').addEventListener('change', async (e) => {
  await addFiles([...e.target.files]);
  e.target.value = '';
});

const drop = $('drop');
['dragenter', 'dragover'].forEach((type) => drop.addEventListener(type, (e) => {
  e.preventDefault();
  drop.classList.add('over');
}));
['dragleave', 'drop'].forEach((type) => drop.addEventListener(type, (e) => {
  e.preventDefault();
  drop.classList.remove('over');
}));
drop.addEventListener('drop', (e) => addFiles([...e.dataTransfer.files].filter((f) => f.name.toLowerCase().endsWith('.pdf'))));

$('paste').addEventListener('click', () => {
  const session = { name: 'Swim', date: null, text: '', doc: null };
  sessions.push(session);
  select(session);
  $('text').focus();
});

$('name').addEventListener('input', update);
$('text').addEventListener('input', update);
$('pool').addEventListener('change', (e) => {
  settings.pool = Number(e.target.value);
  update();
});
$('pauses').addEventListener('change', (e) => {
  settings.pauses = e.target.checked;
  update();
});
$('originalBox').addEventListener('toggle', (e) => {
  if (e.target.open) renderOriginal();
});
$('download').addEventListener('click', download);
