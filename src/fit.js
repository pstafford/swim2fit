// Minimal FIT encoder for swim workout files. Field numbers come from Garmin's FIT profile;
// test/fit.test.js checks the output against Garmin's official decoder.

const BASE = { enum: 0x00, string: 0x07, uint16: 0x84, uint32: 0x86, uint32z: 0x8c };
const SIZE = { enum: 1, uint16: 2, uint32: 4, uint32z: 4 };
const FIT_EPOCH = Date.UTC(1989, 11, 31) / 1000;

const STROKE = { freestyle: 0, backstroke: 1, breaststroke: 2, butterfly: 3, drill: 4, mixed: 5, im: 6 };
const EQUIPMENT = { fins: 1, kickboard: 2, paddles: 3, pullBuoy: 4, snorkel: 5 };
const INTENSITY = { active: 0, rest: 1, warmup: 2, cooldown: 3 };
const DURATION = { time: 0, distance: 1, open: 5, repeat: 6 };
const TARGET = { open: 2, swimStroke: 11 };

const encoder = new TextEncoder();

// Cuts on a UTF-8 character boundary and adds the terminating NUL.
function fitString(text, maxBytes) {
  let bytes = encoder.encode(text);
  if (bytes.length > maxBytes) {
    let end = maxBytes;
    while (end > 0 && (bytes[end] & 0xc0) === 0x80) end--;
    bytes = bytes.slice(0, end);
  }
  const out = new Uint8Array(bytes.length + 1);
  out.set(bytes);
  return out;
}

function crc16(bytes, start = 0, end = bytes.length) {
  const table = [0x0000, 0xcc01, 0xd801, 0x1400, 0xf001, 0x3c00, 0x2800, 0xe401,
    0xa001, 0x6c00, 0x7800, 0xb401, 0x5000, 0x9c01, 0x8801, 0x4400];
  let crc = 0;
  for (let i = start; i < end; i++) {
    let tmp = table[crc & 0xf];
    crc = (crc >> 4) & 0x0fff;
    crc = crc ^ tmp ^ table[bytes[i] & 0xf];
    tmp = table[crc & 0xf];
    crc = (crc >> 4) & 0x0fff;
    crc = crc ^ tmp ^ table[(bytes[i] >> 4) & 0xf];
  }
  return crc;
}

class Writer {
  constructor() {
    this.bytes = [];
  }

  // Writes a definition then a data record. Fields: [number, type, value], value undefined = omitted.
  message(globalNum, fields) {
    const present = fields.filter(([, , value]) => value !== undefined && value !== null);
    const encoded = present.map(([num, type, value]) => [num, type, type === 'string' ? value : this.scalar(type, value)]);
    this.bytes.push(0x40, 0, 0, globalNum & 0xff, globalNum >> 8, encoded.length);
    for (const [num, type, value] of encoded) {
      this.bytes.push(num, type === 'string' ? value.length : SIZE[type], BASE[type]);
    }
    this.bytes.push(0);
    for (const [, , value] of encoded) this.bytes.push(...value);
  }

  scalar(type, value) {
    const out = [];
    for (let i = 0; i < SIZE[type]; i++) out.push(Math.floor(value / 256 ** i) & 0xff);
    return out;
  }

  finish() {
    const header = new Uint8Array(14);
    const view = new DataView(header.buffer);
    header[0] = 14;
    header[1] = 0x10;
    view.setUint16(2, 2140, true);
    view.setUint32(4, this.bytes.length, true);
    header.set(encoder.encode('.FIT'), 8);
    view.setUint16(12, crc16(header, 0, 12), true);
    const file = new Uint8Array(14 + this.bytes.length + 2);
    file.set(header);
    file.set(this.bytes, 14);
    new DataView(file.buffer).setUint16(file.length - 2, crc16(file, 0, file.length - 2), true);
    return file;
  }
}

function flatten(nodes) {
  const steps = [];
  for (const node of nodes) {
    if (node.type === 'repeat') {
      const first = steps.length;
      steps.push(...node.children);
      steps.push({ type: 'repeat', count: node.count, first });
    } else {
      steps.push(node);
    }
  }
  return steps;
}

function stepFields(step, index) {
  const fields = [[254, 'uint16', index]];
  if (step.type === 'repeat') {
    return [...fields,
      [1, 'enum', DURATION.repeat],
      [2, 'uint32', step.first],
      [3, 'enum', TARGET.open],
      [4, 'uint32', step.count]];
  }
  const name = step.name ? fitString(step.name, 47) : undefined;
  if (step.type === 'rest') {
    return [...fields,
      [0, 'string', name],
      [1, 'enum', step.secs ? DURATION.time : DURATION.open],
      [2, 'uint32', step.secs ? step.secs * 1000 : 0],
      [3, 'enum', TARGET.open],
      [4, 'uint32', 0],
      [7, 'enum', INTENSITY.rest]];
  }
  const intensity = step.section === 'warmup' ? INTENSITY.warmup
    : step.section === 'cooldown' ? INTENSITY.cooldown : INTENSITY.active;
  const notes = [step.name, ...(step.notes || [])].join('. ');
  const anyStroke = step.stroke === 'any';
  return [...fields,
    [0, 'string', name],
    [1, 'enum', step.distance ? DURATION.distance : DURATION.time],
    [2, 'uint32', step.distance ? step.distance * 100 : step.secs * 1000],
    [3, 'enum', anyStroke ? TARGET.open : TARGET.swimStroke],
    [4, 'uint32', anyStroke ? 0 : STROKE[step.stroke]],
    [7, 'enum', intensity],
    [8, 'string', fitString(notes, 199)],
    [9, 'enum', step.equipment ? EQUIPMENT[step.equipment] : undefined]];
}

export function encodeWorkout(plan, { name, poolLength = 25, now = new Date() }) {
  const steps = flatten(plan.nodes);
  const created = Math.floor(now.getTime() / 1000) - FIT_EPOCH;
  const writer = new Writer();
  writer.message(0, [
    [0, 'enum', 5], // file type: workout
    [1, 'uint16', 255], // manufacturer: development
    [2, 'uint16', 0],
    [3, 'uint32z', created],
    [4, 'uint32', created],
  ]);
  writer.message(26, [
    [4, 'enum', 5], // sport: swimming
    [6, 'uint16', steps.length],
    [8, 'string', fitString(name, 31)],
    [11, 'enum', 17], // sub sport: lap swimming
    [14, 'uint16', Math.round(poolLength * 100)],
    [15, 'enum', 0], // metric
  ]);
  steps.forEach((step, i) => writer.message(27, stepFields(step, i)));
  return writer.finish();
}
