import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPlan, poolWarnings } from '../src/parser.js';

const only = (plan) => plan.nodes[0];
const warned = (plan, pattern) => plan.warnings.some((w) => pattern.test(w.text));

test('reps, distance, rest and zone', () => {
  const plan = buildPlan('5x200 R20 @Z3');
  const r = only(plan);
  assert.equal(r.type, 'repeat');
  assert.equal(r.count, 5);
  assert.equal(r.children[0].distance, 200);
  assert.equal(r.children[1].secs, 20);
  assert.match(r.children[0].notes[0], /RPE 6\/10/);
  assert.equal(plan.totalDistance, 1000);
});

test('a single swim with no rest gets a lap-button pause only between sets', () => {
  const plan = buildPlan('200 easy\n100 fins');
  assert.deepEqual(plan.nodes.map((n) => n.type), ['swim', 'rest', 'swim']);
  assert.equal(plan.nodes[1].secs, null);
  const noPause = buildPlan('200 easy\n100 fins', { pauses: false });
  assert.deepEqual(noPause.nodes.map((n) => n.type), ['swim', 'swim']);
});

test('sections set the step intensity', () => {
  const plan = buildPlan('Warm up\n\n100 easy\n\nMain set: focus\n\n100\n\nWarm down\n\n100 easy');
  const swims = plan.nodes.filter((n) => n.type === 'swim');
  assert.deepEqual(swims.map((s) => s.section), ['warmup', 'main', 'cooldown']);
});

test('rest forms', () => {
  assert.equal(only(buildPlan('2x100 R1:30')).children[1].secs, 90);
  assert.equal(only(buildPlan('2x100 R2min')).children[1].secs, 120);
  const range = only(buildPlan('2x100 R1-2min')).children[1];
  assert.equal(range.secs, null);
  assert.equal(range.name, 'Rest 1-2min');
  assert.equal(only(buildPlan('4x200 on 3:00')).children[1].name, 'Go on 3:00');
});

test('breakdown of reps under "as", fitting parts that overshoot the rep', () => {
  const plan = buildPlan('6x100 R20 as\n- 2x @Z3\n- 2x (50 MAX + 50 easy)\n- 2x (75 MAX + 75 easy)');
  assert.equal(plan.totalDistance, 600);
  assert.ok(warned(plan, /adds up to 150m/));
  const last = plan.nodes[2].children;
  assert.deepEqual(last.filter((s) => s.type === 'swim').map((s) => s.distance), [75, 25]);
});

test('breakdown that does not cover every rep is flagged', () => {
  assert.ok(warned(buildPlan('4x100 R20 as\n- 1x pull\n- 1x fins'), /covers 2/));
});

test('inline parts in brackets and with slashes inherit set-level words', () => {
  const plan = buildPlan('2x100 R20 fins as [25 K6 drill / 75 swim]');
  const [drill, swim] = only(plan).children;
  assert.equal(drill.stroke, 'drill');
  assert.equal(swim.stroke, 'freestyle');
  assert.equal(drill.equipment, 'fins');
  assert.equal(swim.equipment, 'fins');
  assert.equal(swim.distance, 75);
});

test('odds and evens compress to a repeating pair', () => {
  const r = only(buildPlan('6x50 R30 Kick as\nOdds: Build\nEvens: 25 FAST / 25 easy'));
  assert.equal(r.count, 3);
  assert.deepEqual(r.children.map((s) => s.distance ?? 'rest'), [50, 'rest', 25, 25, 'rest']);
  assert.ok(r.children.filter((s) => s.type === 'swim').every((s) => s.stroke === 'drill'));
});

test('outer repeat is scoped by the blank line and never nests', () => {
  const plan = buildPlan('2x\n2x50 R10\n100 R20\n\n400 R60');
  assert.equal(plan.totalDistance, 2 * (100 + 100) + 400);
  assert.ok(plan.nodes.every((n) => n.type !== 'repeat' || n.children.every((c) => c.type !== 'repeat')));
});

test('per-round notes attach to the drill line and expand the rounds', () => {
  const plan = buildPlan('2x\n4x50 R15 fins drill/swim\n100 R30 @Z2\n-Set 1: Catch up\n-Set 2: Penguin kick');
  const repeats = plan.nodes.filter((n) => n.type === 'repeat');
  assert.match(repeats[0].children[0].name, /25 drill Catch up fins/);
  assert.match(repeats[1].children[0].name, /Penguin kick/);
  assert.equal(repeats[0].children[1].name, '25 swim fins');
  assert.equal(plan.totalDistance, 2 * (200 + 100));
});

test('per-round content replaces the rep', () => {
  const plan = buildPlan('2x\n2x100\n- Set 1: @Z3\n- Set 2: (25 MAX kick + 75 @Z2 swim)');
  assert.equal(plan.nodes[1].children[0].stroke, 'drill');
  assert.match(plan.nodes[0].children[0].name, /100 @Z3/);
});

test('free-form dash lines become notes, including wrapped ones', () => {
  const s = only(buildPlan('2x100 R20\n- Focus on the catch and\nkeep elbows high'));
  assert.ok(s.children[0].notes.includes('Focus on the catch and keep elbows high'));
});

test('"as" followed by words describes the rep', () => {
  const plan = buildPlan('1x400 R30 as focus on a quick sip of air');
  assert.equal(plan.nodes[0].name, '400 focus on a quick sip of air');
});

test('strokes, medley order and equipment', () => {
  const imo = buildPlan('4x50 R20 IMO').nodes;
  assert.equal(imo.length, 7); // the rest after the final rep of a workout is dropped
  assert.deepEqual(imo.filter((s) => s.type === 'swim').map((s) => s.stroke), ['butterfly', 'backstroke', 'breaststroke', 'freestyle']);
  assert.equal(buildPlan('200 IM').nodes[0].stroke, 'im');
  assert.equal(buildPlan('400 pull').nodes[0].equipment, 'pullBuoy');
  assert.equal(buildPlan('400 pull').nodes[0].stroke, 'freestyle');
  assert.equal(buildPlan('100 alt stroke').nodes[0].stroke, 'any');
  assert.equal(buildPlan('100 KOB').nodes[0].stroke, 'drill');
});

test('timed swims do not count towards distance', () => {
  const plan = buildPlan('4x30s R30 V Kick');
  assert.equal(plan.nodes[0].children[0].secs, 30);
  assert.equal(plan.totalDistance, 0);
});

test('stated total is compared with the sets', () => {
  assert.ok(warned(buildPlan('200\n\n- 3.3km'), /adds? up to 0\.2km.*3\.3km/));
  assert.equal(buildPlan('200\n\n-0.2km').warnings.length, 0);
  assert.equal(buildPlan('2950\n\n-2.9km').warnings.length, 0);
});

test('unreadable lines are reported, never silently dropped', () => {
  assert.ok(warned(buildPlan('Do something unusual'), /Could not read/));
});

test('pool length check', () => {
  assert.equal(poolWarnings(buildPlan('100'), 25).length, 0);
  assert.equal(poolWarnings(buildPlan('75'), 50).length, 1);
});
