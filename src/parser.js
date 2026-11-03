// Turns a coach's swim-set text into a plan: a flat list of steps and one-level repeats.
// Garmin workouts cannot reliably nest repeats, so nested sets are expanded here.

const ZONES = {
  1: 'Recovery / aerobic base, RPE 2/10',
  2: 'Steady aerobic, RPE 3/10',
  3: 'Aerobic threshold, RPE 6/10',
  4: 'Lactate threshold (CSS), RPE 7/10',
  5: 'VO2 max / race effort, RPE 9/10',
};

const GLOSSARY = [
  [/\bMAX\b/, 'Maximal effort, RPE 10/10'],
  [/\bbuild\b/i, 'Start easy, finish fast'],
  [/\bDec\b/, 'Each rep faster than the last'],
  [/\bnegative split\b/i, 'Second half faster'],
  [/\bBESP\b/, 'Back-end speed: goal pace for second half of race'],
  [/\bFESP\b/, 'Front-end speed: goal pace for first half of race'],
  [/\bRP\b/, 'Race pace'],
  [/\bDPS\b/, 'Distance per stroke: long, efficient strokes'],
  [/\bhypox\b/i, 'Limit your breaths'],
  [/\bSC\b/, 'Count strokes per length'],
  [/\b10\/10\b/, 'Alternate 10 strokes easy, 10 strokes MAX'],
  [/\bKDS\b/, 'Mix kick, drill and swim laps'],
  [/\bKOB\b/, 'Kick on back'],
  [/\bKOS\b/, 'Kick on side'],
  [/\bV ?Kick\b/i, 'Vertical kick'],
  [/\bIMO\b/, 'Each rep in medley order'],
  [/\balt stroke\b/i, 'Any stroke except freestyle'],
];

const IMO_ORDER = [['butterfly', 'fly'], ['backstroke', 'back'], ['breaststroke', 'breast'], ['freestyle', 'free']];

const HEADING = /^(warm[\s-]*up|warm[\s-]*down|cool[\s-]*down|main(?:\s+set)?|pre[\s-]*set|(?:kick|pull|drill|speed|sprint|technique)\s+set)\b[\s:–-]*(.*)$/i;
const TOTAL = /^-?\s*(\d+(?:\.\d+)?)\s*(km|m)\s*$/i;
const OUTER_REPEAT = /^(\d+)\s*x$/i;
const ROUND_NOTE = /^-?\s*set\s*(\d+)\s*[:.–-]\s*(.*)$/i;
const ODD_EVEN = /^-?\s*(odds?|evens?)\s*[:–-]\s*(.*)$/i;
const ALLOCATION = /^-?\s*(\d+)\s*x\s+(.+)$/i;
const SET_HEAD = /^(?:(\d+)\s*x\s*)?(\d+)\s*(m|mins?|s|secs?)?(?=\s|\(|\[|$)\s*(.*)$/i;
const SEGMENT = /^(\d+)\s*(m)?(?:\s+(.*))?$/i;

function clock(value, unit) {
  if (value.includes(':')) {
    const [m, s] = value.split(':').map(Number);
    return m * 60 + s;
  }
  return Number(value) * (/^m/i.test(unit || '') ? 60 : 1);
}

function formatSecs(secs) {
  if (secs < 60) return `${secs}s`;
  return secs % 60 ? `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}` : `${secs / 60}min`;
}

// Pulls the rest (R20, R1-2min) or send-off (on 3:00) out of a line, returning what is left.
function takeRest(tail) {
  const r = tail.match(/(?:^|\s)R\s*(\d+(?::\d+)?)(?:\s*-\s*(\d+(?::\d+)?))?\s*(s|secs?|m|mins?)?(?=\s|$)/);
  if (r) {
    const remaining = (tail.slice(0, r.index) + ' ' + tail.slice(r.index + r[0].length)).trim();
    if (r[2]) {
      const low = clock(r[1], r[3]);
      const high = clock(r[2], r[3]);
      return { rest: { kind: 'lap', label: `Rest ${r[1]}-${r[2]}${r[3] || 's'}`, low, high }, remaining };
    }
    return { rest: { kind: 'time', secs: clock(r[1], r[3]) }, remaining };
  }
  const on = tail.match(/(?:^|\s)(?:on|@)\s*(\d+:\d\d)(?=\s|$)/);
  if (on) {
    const remaining = (tail.slice(0, on.index) + ' ' + tail.slice(on.index + on[0].length)).trim();
    return { rest: { kind: 'lap', label: `Go on ${on[1]}`, sendOff: clock(on[1]) }, remaining };
  }
  return { rest: null, remaining: tail };
}

// "(50 MAX + 150 easy)", "[25 drill / 75 swim]" or "25 FAST / 25 easy" -> segments.
function parseContent(text) {
  const trimmed = text.trim();
  const bracket = trimmed.match(/[([]([^)\]]*)[)\]]/);
  const inner = bracket ? bracket[1] : trimmed;
  const parts = inner.split(/\s*[+/]\s*/);
  const segs = parts.map((p) => p.trim().match(SEGMENT));
  if (parts.length >= 2 && segs.every(Boolean)) {
    return {
      segments: segs.map((m) => ({ distance: Number(m[1]), text: (m[3] || '').trim() })),
      text: bracket ? (trimmed.slice(0, bracket.index) + ' ' + trimmed.slice(bracket.index + bracket[0].length)).trim() : '',
    };
  }
  return { segments: null, text: trimmed };
}

function ownStroke(text) {
  if (/\b(kick|KOB|KOS|drill|KDS|K\d+)\b/i.test(text)) return 'drill';
  if (/\bIM\b/.test(text)) return 'im';
  if (/\b(alt stroke|choice|mixed)\b/i.test(text)) return 'any';
  if (/\b(fly|butterfly)\b/i.test(text)) return 'butterfly';
  if (/\b(back|backstroke)\b/i.test(text)) return 'backstroke';
  if (/\b(breast|breaststroke)\b/i.test(text)) return 'breaststroke';
  if (/\b(swim|free|freestyle)\b/i.test(text)) return 'freestyle';
  return null;
}

function equipmentOf(text) {
  if (/\bfins?\b/i.test(text)) return 'fins';
  if (/\bpaddles?\b/i.test(text)) return 'paddles';
  if (/\bpull\b|\bbuoy\b/i.test(text)) return 'pullBuoy';
  if (/\b(kick)?board\b/i.test(text)) return 'kickboard';
  if (/\bsnorkel\b/i.test(text)) return 'snorkel';
  return null;
}

function explain(text) {
  const notes = [];
  const zone = text.match(/@?\bZ([1-5])\b/);
  if (zone) notes.push(`Z${zone[1]}: ${ZONES[zone[1]]}`);
  for (const [pattern, meaning] of GLOSSARY) if (pattern.test(text)) notes.push(meaning);
  return notes;
}

function join(...parts) {
  return parts.map((p) => (p || '').trim()).filter(Boolean).join(' ');
}

function parseSetLine(line) {
  const m = line.match(SET_HEAD);
  if (!m) return null;
  const unit = m[3] ? m[3].toLowerCase() : 'm';
  const isTime = unit !== 'm';
  const amount = Number(m[2]);
  if (!isTime && amount < 10) return null;
  const { rest, remaining } = takeRest(m[4] || '');
  const asAt = remaining.match(/(?:^|\s)as(?:\s+|$)/);
  const base = asAt ? remaining.slice(0, asAt.index).trim() : remaining;
  const content = asAt ? remaining.slice(asAt.index + asAt[0].length).trim() : '';
  const set = {
    source: line,
    reps: m[1] ? Number(m[1]) : 1,
    distance: isTime ? null : amount,
    secs: isTime ? (/^m/.test(unit) ? amount * 60 : amount) : null,
    rest,
    base,
    content: content ? parseContent(content) : null,
    allocations: [],
    odds: null,
    evens: null,
    notes: [],
    roundNote: null,
  };
  const inline = parseContent(base);
  if (inline.segments) {
    set.content = inline;
    set.base = inline.text;
  }
  return set;
}

// Works out what one rep of a set is: its segments, before stroke/equipment classification.
function repSegments(set, rep, warn) {
  let content = set.content;
  let cursor = 0;
  for (const a of set.allocations) {
    if (rep >= cursor && rep < cursor + a.count) content = a.content;
    cursor += a.count;
  }
  if (rep % 2 === 0 && set.odds) content = set.odds;
  if (rep % 2 === 1 && set.evens) content = set.evens;
  let round = set.roundNote;
  if (round?.segments) {
    content = round;
    round = null;
  }

  let segs;
  if (content?.segments) {
    segs = content.segments.map((s) => ({ ...s, outer: content.text || '' }));
    const total = segs.reduce((sum, s) => sum + s.distance, 0);
    if (set.distance && total !== set.distance) {
      const last = segs[segs.length - 1];
      const fitted = set.distance - (total - last.distance);
      if (fitted > 0) {
        warn(`"${segs.map((s) => join(String(s.distance), s.text)).join(' + ')}" adds up to ${total}m but the rep is ${set.distance}m. Used ${fitted}m for the last part.`, 'warn');
        last.distance = fitted;
      } else {
        warn(`"${set.source}": the parts add up to ${total}m but the rep is ${set.distance}m. Check this set.`, 'warn');
      }
    }
  } else {
    const split = /\b(drill|kick)\s*\/\s*swim\b|\bswim\s*\/\s*(drill|kick)\b/i.exec(set.base);
    if (split && set.distance && set.distance % 2 === 0 && !content?.text) {
      const hard = (split[1] || split[2]).toLowerCase();
      const half = set.distance / 2;
      segs = [
        { distance: half, text: hard, base: set.base.replace(split[0], '').trim(), split: true },
        { distance: half, text: 'swim', base: set.base.replace(split[0], '').trim(), split: true },
      ];
    } else {
      segs = [{ distance: set.distance, secs: set.secs, text: content?.text || '' }];
    }
  }
  if (round?.text) {
    const target = segs.find((s) => ownStroke(s.text) === 'drill') || segs[0];
    target.text = join(target.text, round.text);
  }
  return segs;
}

function buildStep(seg, set, rep, kind) {
  const base = seg.base ?? set.base;
  const own = join(seg.text, seg.outer);
  let text = join(own, base);
  let stroke = ownStroke(own) || ownStroke(base) || 'freestyle';
  if (/\bIMO\b/.test(text)) {
    const [imoStroke, label] = IMO_ORDER[rep % 4];
    stroke = imoStroke;
    text = join(text.replace(/\bIMO\b/, '').trim(), label);
  }
  const amount = seg.distance ? String(seg.distance) : formatSecs(seg.secs);
  const name = join(amount, text);
  const notes = [...explain(join(own, base)), ...set.notes];
  return {
    type: 'swim',
    distance: seg.distance || null,
    secs: seg.secs || null,
    name,
    notes,
    stroke,
    equipment: equipmentOf(text),
    section: kind,
  };
}

function restStep(rest, pauses) {
  if (rest?.kind === 'time') return { type: 'rest', secs: rest.secs, name: `Rest ${formatSecs(rest.secs)}` };
  if (rest?.kind === 'lap') return { type: 'rest', secs: null, name: rest.label };
  return pauses ? { type: 'rest', secs: null, name: 'Rest' } : null;
}

// Collapses a list of reps into the fewest steps: "ABAB" -> 2x(AB), "AABB" -> 2xA, 2xB.
function compress(reps) {
  const keys = reps.map((r) => JSON.stringify(r));
  const n = reps.length;
  for (let p = 1; p < n; p++) {
    if (n % p) continue;
    if (keys.every((k, i) => k === keys[i % p])) {
      return [{ type: 'repeat', count: n / p, children: reps.slice(0, p).flat() }];
    }
  }
  const out = [];
  for (let i = 0; i < n;) {
    let j = i;
    while (j < n && keys[j] === keys[i]) j++;
    if (j - i > 1) out.push({ type: 'repeat', count: j - i, children: reps[i] });
    else out.push(...reps[i]);
    i = j;
  }
  return out;
}

function expandSet(set, kind, pauses, warn) {
  const reps = [];
  for (let rep = 0; rep < set.reps; rep++) {
    const steps = repSegments(set, rep, warn).map((seg) => buildStep(seg, set, rep, kind));
    const rest = restStep(set.rest, pauses);
    if (rest) steps.push(rest);
    reps.push(steps);
  }
  return compress(reps);
}

function expandGroup(group, kind, pauses, warn) {
  const hasRoundNotes = group.roundNotes.length > 0;
  if (hasRoundNotes) {
    const target = group.body.find((s) => /\bdrill\b/i.test(s.base))
      || group.body.find((s) => /\bkick\b/i.test(s.base))
      || group.body[group.body.length - 1];
    if (group.body.length > 1) {
      warn(`"Set 1, Set 2…" notes under the ${group.count}x block were applied to "${target.source}". Check this is what your coach meant.`, 'info');
    }
    if (group.roundNotes.length !== group.count) {
      warn(`The ${group.count}x block has ${group.roundNotes.length} "Set" notes. Rounds without a note are swum as the base set.`, 'warn');
    }
    const rounds = [];
    for (let round = 0; round < group.count; round++) {
      const note = group.roundNotes.find((r) => r.round === round + 1);
      target.roundNote = note ? note.content : null;
      rounds.push(group.body.flatMap((set) => expandSet(set, kind, pauses, warn)));
    }
    target.roundNote = null;
    return rounds.flat();
  }
  const body = group.body.flatMap((set) => expandSet(set, kind, pauses, warn));
  if (body.some((n) => n.type === 'repeat')) {
    const out = [];
    for (let round = 1; round <= group.count; round++) out.push(...structuredClone(body));
    return out;
  }
  return [{ type: 'repeat', count: group.count, children: body }];
}

export function parseSets(text) {
  const warnings = [];
  const warn = (message, level = 'warn') => {
    if (!warnings.some((w) => w.text === message)) warnings.push({ level, text: message });
  };
  const sections = [{ kind: 'main', heading: '', items: [] }];
  let statedTotal = null;
  let group = null;
  let lastSet = null;
  let inNote = false;

  const section = () => sections[sections.length - 1];

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\s+/g, ' ').trim();
    if (!line) {
      if (!group || group.body.length) group = null;
      lastSet = null;
      inNote = false;
      continue;
    }

    const total = line.match(TOTAL);
    if (total) {
      statedTotal = Number(total[1]) * (total[2].toLowerCase() === 'km' ? 1000 : 1);
      continue;
    }

    const outer = line.match(OUTER_REPEAT);
    if (outer) {
      group = { type: 'group', count: Number(outer[1]), body: [], roundNotes: [] };
      section().items.push(group);
      lastSet = null;
      inNote = false;
      continue;
    }

    const round = line.match(ROUND_NOTE);
    if (round && group) {
      group.roundNotes.push({ round: Number(round[1]), content: parseContent(round[2]) });
      inNote = false;
      continue;
    }

    const oddEven = line.match(ODD_EVEN);
    if (oddEven && lastSet) {
      lastSet[oddEven[1][0].toLowerCase() === 'o' ? 'odds' : 'evens'] = parseContent(oddEven[2]);
      inNote = false;
      continue;
    }

    const allocation = line.match(ALLOCATION);
    if (allocation && lastSet && !/^\d+\s*x\s*\d/i.test(line.replace(/^-\s*/, ''))) {
      lastSet.allocations.push({ count: Number(allocation[1]), content: parseContent(allocation[2]) });
      inNote = false;
      continue;
    }

    const heading = line.match(HEADING);
    if (heading) {
      const name = heading[1].toLowerCase();
      const kind = name.startsWith('warm') && name.endsWith('up') ? 'warmup'
        : /down/.test(name) ? 'cooldown' : 'main';
      const trailing = parseSetLine(heading[2] || '');
      sections.push({ kind, heading: line.slice(0, trailing ? heading[1].length : undefined), items: [] });
      group = null;
      lastSet = null;
      inNote = false;
      if (trailing) {
        section().items.push(trailing);
        lastSet = trailing;
      }
      continue;
    }

    if (line.startsWith('-')) {
      if (lastSet) {
        lastSet.notes.push(line.replace(/^-\s*/, ''));
        inNote = true;
        continue;
      }
    } else {
      const set = parseSetLine(line);
      if (set) {
        if (group) group.body.push(set);
        else section().items.push(set);
        lastSet = set;
        inNote = false;
        continue;
      }
      if (inNote && lastSet) {
        lastSet.notes[lastSet.notes.length - 1] += ` ${line}`;
        continue;
      }
    }
    warn(`Could not read "${line}", so it was left out.`);
  }

  for (const s of sections) {
    for (const item of s.items) {
      const sets = item.type === 'group' ? item.body : [item];
      for (const set of sets) {
        const allocated = set.allocations.reduce((sum, a) => sum + a.count, 0);
        if (set.allocations.length && allocated !== set.reps) {
          warn(`"${set.source}" has ${set.reps} reps but the breakdown below it covers ${allocated}.`);
        }
        if (/\b(drill|kick)\s*\/\s*swim\b/i.test(set.base)) {
          warn(`"${set.source}": assumed each rep is half ${/kick/i.test(set.base) ? 'kick' : 'drill'}, half swim.`, 'info');
        }
        if (set.rest?.kind === 'lap' && set.rest.sendOff) {
          warn(`"${set.source}": the watch will not time the send-off. Press lap to push off on ${formatSecs(set.rest.sendOff)}.`, 'info');
        }
        if (set.rest?.kind === 'lap' && set.rest.low) {
          warn(`"${set.source}": a rest range cannot be timed, so the watch waits for you to press lap.`, 'info');
        }
      }
    }
  }

  return { sections, statedTotal, warnings, warn };
}

export function buildPlan(text, { pauses = true } = {}) {
  const { sections, statedTotal, warnings, warn } = parseSets(text);
  const nodes = [];
  for (const s of sections) {
    for (const item of s.items) {
      if (item.type === 'group') nodes.push(...expandGroup(item, s.kind, pauses, warn));
      else nodes.push(...expandSet(item, s.kind, pauses, warn));
    }
  }
  while (nodes.length && nodes[nodes.length - 1].type === 'rest') nodes.pop();

  const totalDistance = sumDistance(nodes);
  if (statedTotal !== null && Math.abs(totalDistance - statedTotal) > 50) {
    warn(`The sets add up to ${(totalDistance / 1000).toFixed(1)}km, but the session says ${(statedTotal / 1000).toFixed(1)}km. The file follows the sets as written.`);
  }
  return { nodes, totalDistance, statedTotal, warnings, stepCount: countSteps(nodes) };
}

function sumDistance(nodes) {
  return nodes.reduce((sum, n) => {
    if (n.type === 'repeat') return sum + n.count * sumDistance(n.children);
    return sum + (n.type === 'swim' && n.distance ? n.distance : 0);
  }, 0);
}

function countSteps(nodes) {
  return nodes.reduce((sum, n) => sum + (n.type === 'repeat' ? 1 + n.children.length : 1), 0);
}

export function poolWarnings(plan, poolLength) {
  const off = new Set();
  const visit = (nodes) => nodes.forEach((n) => {
    if (n.type === 'repeat') visit(n.children);
    else if (n.type === 'swim' && n.distance && n.distance % poolLength) off.add(n.distance);
  });
  visit(plan.nodes);
  if (!off.size) return [];
  return [{
    level: 'warn',
    text: `${[...off].join('m, ')}m ${off.size > 1 ? 'are' : 'is'} not a whole number of lengths in a ${poolLength}m pool, so the watch will overrun those steps.`,
  }];
}
