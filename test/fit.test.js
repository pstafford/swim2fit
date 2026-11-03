import test from 'node:test';
import assert from 'node:assert/strict';
import { Decoder, Stream } from '@garmin/fitsdk';
import { buildPlan } from '../src/parser.js';
import { encodeWorkout } from '../src/fit.js';

function decode(bytes) {
  const decoder = new Decoder(Stream.fromByteArray(Array.from(bytes)));
  assert.ok(decoder.isFIT());
  assert.ok(decoder.checkIntegrity(), 'CRC check failed');
  const { messages, errors } = decoder.read();
  assert.deepEqual(errors, []);
  return messages;
}

test('official Garmin decoder reads a swim workout with the intended meaning', () => {
  const plan = buildPlan('Warm up\n\n200 easy\n\nMain set\n\n4x50 R20 fins kick\n\nWarm down\n\n100 @Z2 pull');
  const m = decode(encodeWorkout(plan, { name: 'Test swim', poolLength: 25, now: new Date('2026-10-31T00:00:00Z') }));

  assert.equal(m.fileIdMesgs[0].type, 'workout');
  const w = m.workoutMesgs[0];
  assert.equal(w.sport, 'swimming');
  assert.equal(w.subSport, 'lapSwimming');
  assert.equal(w.wktName, 'Test swim');
  assert.equal(w.poolLength, 25);
  assert.equal(w.poolLengthUnit, 'metric');
  assert.equal(w.numValidSteps, m.workoutStepMesgs.length);

  const s = m.workoutStepMesgs;
  assert.equal(s[0].durationType, 'distance');
  assert.equal(s[0].durationDistance, 200);
  assert.equal(s[0].targetType, 'swimStroke');
  assert.equal(s[0].targetStrokeType, 'freestyle');
  assert.equal(s[0].intensity, 'warmup');
  assert.equal(s[0].wktStepName, '200 easy');

  assert.equal(s[1].intensity, 'rest');
  assert.equal(s[1].durationType, 'open');

  assert.equal(s[2].durationDistance, 50);
  assert.equal(s[2].targetStrokeType, 'drill');
  assert.equal(s[2].equipment, 'swimFins');
  assert.equal(s[3].durationType, 'time');
  assert.equal(s[3].durationTime, 20);

  assert.equal(s[4].durationType, 'repeatUntilStepsCmplt');
  assert.equal(s[4].durationStep, 2);
  assert.equal(s[4].repeatSteps, 4);

  const last = s[s.length - 1];
  assert.equal(last.intensity, 'cooldown');
  assert.equal(last.equipment, 'swimPullBuoy');
  assert.match(last.notes, /RPE 3\/10/);
});

test('long names and notes are truncated on a character boundary', () => {
  const plan = buildPlan(`100 ${'é'.repeat(200)}`);
  const m = decode(encodeWorkout(plan, { name: 'é'.repeat(40) }));
  assert.ok(!m.workoutStepMesgs[0].wktStepName.includes('�'));
  assert.ok(!m.workoutMesgs[0].wktName.includes('�'));
});
