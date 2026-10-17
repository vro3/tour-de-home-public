import { describe, expect, it } from 'vitest';
import FitParser from 'fit-file-parser';
import { makeFitActivity } from './fixtures/fitActivity.mjs';
import { importFit, convertFitActivity } from '../src/import/fitImport';
import { buildGhost, ghostGapAt, ghostDistanceAt } from '../src/ride/ghostRace';
import { exportSessionToFit } from '../src/export/fitExporter';
import { exportSessionToTcx } from '../src/export/tcxExporter';

const decoded = () => new FitParser({ force: false, strict: true, mode: 'list' }).parseAsync(makeFitActivity());
describe('original FIT activity import', () => {
  it('removes a 20-second recorded pause without changing performance or course distance', async () => {
    const ride = await importFit(makeFitActivity(), 'My Ride.fit');
    expect(ride.activeTimerSeconds).toBe(20);
    expect(ride.endTime! - ride.startTime).toBe(40_000);
    expect(ride.totalDistanceMeters).toBe(60);
    const ghost = buildGhost(ride, ride.route!)!;
    expect(ghost.duration).toBe(20);
    expect(ghostDistanceAt(ghost, 15)).toBe(45);
    expect(ghostGapAt(ghost, 45, 15)).toBe(0);
    expect(ride.samples.find(s => s.timestamp === ride.startTime + 30_000)?.activeTimeSeconds).toBe(10);
    expect(ride.route?.synthetic).toBe(false);
  });
  it('has stable content IDs and does not depend on the uploaded filename', async () => {
    const a = await importFit(makeFitActivity(), 'a.fit'), b = await importFit(makeFitActivity(), 'b.fit');
    expect(a.id).toBe(b.id);
  });
  it('creates a measured-distance virtual course for treadmill files without inventing exported GPS', async () => {
    const ride = await importFit(makeFitActivity({ sport: 'running', gps: false }), 'Indoor.fit');
    expect(ride.sport).toBe('running');
    expect(ride.route?.synthetic).toBe(true);
    const parsed = await new FitParser({ force: false, strict: true }).parseAsync(exportSessionToFit(ride).slice().buffer as ArrayBuffer);
    expect(parsed.sessions?.[0]).toMatchObject({ sport: 'running', sub_sport: 'treadmill', total_timer_time: 20 });
    expect(parsed.records?.every(r => r.position_lat === undefined)).toBe(true);
    expect(exportSessionToTcx(ride)).toContain('Sport="Running"');
    expect(exportSessionToTcx(ride)).not.toContain('<Position>');
  });
  it('round trips timer pauses through our FIT export and strict import', async () => {
    const ride = await importFit(makeFitActivity(), 'Original.fit');
    const bytes = exportSessionToFit(ride);
    const back = await importFit(bytes.slice().buffer as ArrayBuffer, 'Roundtrip.fit');
    expect(back.activeTimerSeconds).toBe(20);
    expect(buildGhost(back, back.route!)?.points).toEqual(buildGhost(ride, ride.route!)?.points);
  });
  it('accepts no-event files only when totals establish continuous timer time', async () => {
    expect((await importFit(makeFitActivity({ events: false, paused: false }), 'Continuous.fit')).activeTimerSeconds).toBe(20);
    await expect(importFit(makeFitActivity({ events: false }), 'Missing events.fit')).rejects.toThrow(/no timer events/);
  });
  it('does not accumulate fake pauses from sub-second sample rounding', async () => {
    const ride = await importFit(makeFitActivity({ events: false, paused: false }), 'Continuous.fit');
    const first = ride.samples[0];
    ride.startTime += 350;
    ride.endTime = ride.startTime + 20_000;
    ride.samples = Array.from({ length: 40 }, (_, i) => {
      const active = (i + 1) / 2;
      return { ...first, timestamp: ride.startTime + active * 1000 + (i % 2 ? 10 : -10), activeTimeSeconds: active, distanceMeters: active * 3 };
    });
    const bytes = exportSessionToFit(ride).slice();
    const parsed = await new FitParser({ force: false, strict: true, mode: 'list' }).parseAsync(bytes.buffer as ArrayBuffer);
    expect(parsed.events?.filter(e => e.event === 'timer')).toHaveLength(2);
    expect(parsed.sessions?.[0].total_timer_time).toBe(20);
  });
  it('rejects corrupt CRC, truncation, wrong files and oversized files', async () => {
    const bytes = new Uint8Array(makeFitActivity()); bytes[40] ^= 1;
    await expect(importFit(bytes.buffer, 'Broken.fit')).rejects.toThrow(/damaged/);
    await expect(importFit(makeFitActivity().slice(0, 80), 'Short.fit')).rejects.toThrow(/damaged/);
    await expect(importFit(new ArrayBuffer(10), 'Not.fit')).rejects.toThrow(/original FIT/);
    await expect(importFit(new ArrayBuffer(20_000_001), 'Big.fit')).rejects.toThrow(/20 MB/);
  });
  it('rejects inconsistent totals, overlapping events and missing final timer stops', async () => {
    const data = await decoded();
    data.sessions![0].total_timer_time = 30;
    expect(() => convertFitActivity(data, 'x', 'x')).toThrow(/disagree/);
    data.sessions![0].total_timer_time = 20;
    const stop = data.events!.pop();
    expect(() => convertFitActivity(data, 'x', 'x')).toThrow(/never stops/);
    data.events!.push(stop!);
    data.events!.splice(1, 0, data.events![0]);
    expect(() => convertFitActivity(data, 'x', 'x')).toThrow(/overlapping/);
  });
  it('rejects conflicting distance and multisport, but supports sparse active-time interpolation', async () => {
    const data = await decoded();
    const original = structuredClone(data);
    data.records![5].distance = 0;
    expect(() => convertFitActivity(data, 'x', 'x')).toThrow(/backwards/);
    const noDistance = structuredClone(original); noDistance.records!.forEach(r => delete r.distance);
    expect(() => convertFitActivity(noDistance, 'x', 'x')).toThrow(/distance stream/);
    const multi = structuredClone(original); multi.sessions!.push(multi.sessions![0]);
    expect(() => convertFitActivity(multi, 'x', 'x')).toThrow(/Multisport/);
    const jump = structuredClone(original); jump.records![11].distance! += 1;
    expect(() => convertFitActivity(jump, 'x', 'x')).toThrow(/paused timer boundary/);
    const sparse = structuredClone(original); sparse.records = sparse.records!.filter((_, i) => i < 9 || i > 12);
    const sparseRide = convertFitActivity(sparse, 'x', 'x');
    expect(sparseRide.activeTimerSeconds).toBe(20);
    expect(ghostDistanceAt(buildGhost(sparseRide, sparseRide.route!)!, 15)).toBe(45);
  });
});
