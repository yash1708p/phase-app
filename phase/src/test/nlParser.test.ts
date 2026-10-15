import { describe, expect, it } from 'vitest';
import { parseNaturalLog } from '../lib/nlParser';
import { generateInsight, findPattern } from '../lib/insightEngine';
import { getCycleStatus, predict } from '../lib/predictionEngine';
import { addDays } from '../lib/dates';
import type { DailyLog, Demographics } from '../types';

describe('parseNaturalLog', () => {
  it('handles the spec example', () => {
    const r = parseNaturalLog('I have super bad cramps and feel anxious today');
    expect(r.symptoms.cramps).toBe('severe');
    expect(r.symptoms.moods).toEqual(['anxious']);
    expect(r.understood).toEqual(['Cramps: Severe', 'Mood: Anxious']);
  });

  it('scopes intensity to its own clause', () => {
    const r = parseNaturalLog('mild cramps but really irritable');
    expect(r.symptoms.cramps).toBe('mild');
    expect(r.symptoms.moods).toContain('irritable');
  });

  it('detects negation', () => {
    expect(parseNaturalLog('no cramps today').symptoms.cramps).toBe('none');
    expect(parseNaturalLog("I'm not anxious anymore").symptoms.moods).toBeUndefined();
    expect(parseNaturalLog('my headache is gone').symptoms.headache).toBe('none');
  });

  it('distinguishes dull headaches from migraines', () => {
    expect(parseNaturalLog('slight headache').symptoms.headache).toBe('dull');
    expect(parseNaturalLog('awful migraine since lunch').symptoms.headache).toBe('migraine');
    expect(parseNaturalLog('terrible pounding headache').symptoms.headache).toBe('migraine');
  });

  it('reads flow and period status', () => {
    const r = parseNaturalLog('Period started this morning, heavy flow');
    expect(r.isPeriodDay).toBe(true);
    expect(r.flow).toBe('heavy');
    expect(parseNaturalLog('just some spotting').flow).toBe('spotting');
    expect(parseNaturalLog('just some spotting').isPeriodDay).toBeUndefined();
  });

  it('extracts lifestyle numbers', () => {
    const r = parseNaturalLog('slept 6 hours, drank eight glasses of water, very stressed, went for a run');
    expect(r.lifestyle.sleepHours).toBe(6);
    expect(r.lifestyle.waterGlasses).toBe(8);
    expect(r.lifestyle.stress).toBe('high');
    expect(r.lifestyle.workout).toBe('moderate');
  });

  it('reads BBT in either unit and medications', () => {
    expect(parseNaturalLog('bbt 36.55').symptoms.bbt).toBe(36.55);
    expect(parseNaturalLog('temp was 97.9 F').symptoms.bbt).toBeCloseTo(36.61, 1);
    expect(parseNaturalLog('took ibuprofen for the pain').lifestyle.medications).toEqual(['ibuprofen']);
  });

  it('picks up fatigue, acne and discharge', () => {
    const r = parseNaturalLog('exhausted, breaking out on my chin, egg white discharge');
    expect(r.symptoms.fatigue).toBe('moderate');
    expect(r.symptoms.acne).toBe('mild');
    expect(r.symptoms.discharge).toBe('egg_white');
  });

  it('does not invent data from unrelated text', () => {
    const r = parseNaturalLog('I need to lie down for a bit');
    expect(r.understood).toEqual([]);
  });
});

describe('insight engine', () => {
  const profile: Demographics = { age: 30, primaryGoal: 'understand_symptoms', typicalCycleLength: 28, typicalPeriodLength: 5 };
  const log = (date: string, patch: Partial<DailyLog['symptoms']>): DailyLog => ({
    date,
    cycle: { isPeriodDay: false },
    symptoms: { moods: [], ...patch },
    lifestyle: { medications: [] },
    updatedAt: 0,
  });

  it('connects a luteal headache logged yesterday to falling hormones', () => {
    const periodDays = Array.from({ length: 5 }, (_, i) => addDays('2026-09-17', i));
    const today = '2026-10-12'; // cycle day 26, period expected ~Oct 15
    const prediction = predict({ profile, periodDays, today });
    const status = getCycleStatus(prediction, periodDays, today);
    const logs = { '2026-10-11': log('2026-10-11', { headache: 'dull', fatigue: 'moderate' }) };
    const insight = generateInsight({ status, prediction, logs, periodDays, today });
    expect(status.phase).toBe('luteal');
    expect(insight.body).toMatch(/luteal phase/);
    expect(insight.body).toMatch(/headache/);
    expect(insight.body).toMatch(/yesterday/);
  });

  it('spots a recurring symptom pattern on the same cycle day', () => {
    const starts = ['2026-07-01', '2026-07-29', '2026-08-26', '2026-09-23'];
    const periodDays = starts.flatMap((s) => Array.from({ length: 4 }, (_, i) => addDays(s, i)));
    const logs: Record<string, DailyLog> = {};
    for (const s of starts.slice(0, 3)) logs[s] = log(s, { cramps: 'severe' });
    const pattern = findPattern(logs, periodDays, '2026-09-23');
    expect(pattern).toMatch(/3 of your last 3 cycles, you logged cramps around cycle day 1, which is today/);
  });
});
