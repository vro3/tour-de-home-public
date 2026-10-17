import { describe, expect, it } from 'vitest';
import FitParser from 'fit-file-parser';
import { XMLValidator } from 'fast-xml-parser';
import { FtmsTrainer, makePausePayload, makeSimulationPayload, makeTargetPowerPayload, parseIndoorBikeData } from '../src/ble/ftmsTrainer';
import { VirtualSpeedEngine } from '../src/physics/virtualSpeed';
import { parseGpxString } from '../src/route/gpxParser';
import { getInterpolatedProgress } from '../src/route/routeTracker';
import { exportSessionToFit } from '../src/export/fitExporter';
import { exportSessionToTcx } from '../src/export/tcxExporter';
import { SavedRideSession } from '../src/storage/rideJournal';
import { makeTrainerTelemetrySafe } from '../src/ride/rideSafety';
import { isUsableRoute } from '../src/storage/appPreferences';

const SAMPLE_GPX = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1">
  <trk>
    <name>Morning &amp; Hills</name>
    <trkseg>
      <trkpt lat="45.0000" lon="6.0000"><ele>100</ele></trkpt>
      <trkpt lat="45.0005" lon="6.0000"><ele>104</ele></trkpt>
      <trkpt lat="45.0010" lon="6.0000"><ele>109</ele></trkpt>
      <trkpt lat="45.0015" lon="6.0000"><ele>113</ele></trkpt>
    </trkseg>
  </trk>
</gpx>`;

function makeSession(): SavedRideSession {
  const startTime = Date.UTC(2026, 7, 19, 12, 0, 0);
  return {
    id: 'test-ride',
    startTime,
    endTime: startTime + 3_000,
    routeName: 'Morning & Hills',
    totalDistanceMeters: 24,
    totalElevationGainMeters: 3,
    activeTimerSeconds: 3,
    controlMode: 'route',
    ergTargetWatts: 200,
    samples: [0, 1, 2].map((index) => ({
      timestamp: startTime + index * 1_000,
      powerWatts: 200 + index * 10,
      cadenceRpm: 88 + index,
      flywheelSpeedKph: 31,
      virtualSpeedKph: 28 + index,
      distanceMeters: index * 12,
      gradePercent: 4.5,
      elevationMeters: 100 + index * 1.5,
      lat: 45 + index * 0.0001,
      lng: 6 + index * 0.0001,
    })),
  };
}

describe('FTMS command encoding', () => {
  it('packs target power as signed little-endian watts', () => {
    expect(Array.from(makeTargetPowerPayload(250))).toEqual([0x05, 0xfa, 0x00]);
  });

  it('uses the FTMS pause procedure instead of a nonzero ERG target to neutralize', () => {
    expect(Array.from(makePausePayload())).toEqual([0x08, 0x02]);
  });

  it('packs indoor simulation fields at Bluetooth FTMS resolutions', () => {
    expect(Array.from(makeSimulationPayload(1.5, 8.2, 0.004, 0.3))).toEqual([
      0x11,
      0xdc, 0x05,
      0x34, 0x03,
      0x28,
      0x1e,
    ]);
  });

  it('decodes speed, cadence, distance, power, and heart rate with FTMS field offsets', () => {
    const bytes = new Uint8Array([
      0xD4, 0x03, // cadence, distance, power, average power, energy, and HR present
      0xF0, 0x0A, // 28.00 km/h
      0xB4, 0x00, // 90 RPM at 0.5 RPM resolution
      0x39, 0x30, 0x00, // 12,345 m
      0xFA, 0x00, // 250 W
      0xF0, 0x00, // 240 W average
      0x64, 0x00, 0x20, 0x03, 0x08, // energy fields
      0xA5, // 165 bpm
    ]);

    expect(parseIndoorBikeData(new DataView(bytes.buffer))).toEqual({
      instantaneousSpeedKph: 28,
      instantaneousCadenceRpm: 90,
      instantaneousPowerWatts: 250,
      cumulativeDistanceMeters: 12_345,
      heartRateBpm: 165,
    });
  });

  it('rejects resistance commands instead of silently succeeding in telemetry-only mode', async () => {
    const trainer = new FtmsTrainer();
    trainer.isConnected = true;
    trainer.capabilities.control = false;

    await expect(trainer.setGrade(5)).rejects.toThrow(/resistance control is unavailable/i);
    await expect(trainer.setTargetPower(220)).rejects.toThrow(/resistance control is unavailable/i);
  });
});

describe('virtual ride physics', () => {
  it('advances on power and slows appropriately on a climb', () => {
    const flat = new VirtualSpeedEngine();
    const climb = new VirtualSpeedEngine();
    let flatDistance = 0;
    let climbDistance = 0;

    for (let i = 0; i < 600; i++) {
      flatDistance += flat.step(250, 0, 0.1).distanceDeltaMeters;
      climbDistance += climb.step(250, 8, 0.1).distanceDeltaMeters;
    }

    expect(flatDistance).toBeGreaterThan(450);
    expect(climbDistance).toBeGreaterThan(100);
    expect(climbDistance).toBeLessThan(flatDistance * 0.65);
  });

  it('integrates delayed browser ticks without discarding elapsed time', () => {
    const delayed = new VirtualSpeedEngine();
    const baseline = new VirtualSpeedEngine();
    const delayedResult = delayed.advance(250, 0, 5);
    let baselineDistance = 0;

    for (let index = 0; index < 20; index += 1) {
      baselineDistance += baseline.step(250, 0, 0.25).distanceDeltaMeters;
    }

    expect(delayedResult.distanceDeltaMeters).toBeCloseTo(baselineDistance, 8);
    expect(delayedResult.speedKph).toBeCloseTo(baseline.getCurrentSpeedKph(), 8);
  });
});

describe('trainer dropout safety', () => {
  it('zeros propulsive telemetry when disconnected or stale', () => {
    const now = 10_000;
    const sample = { ...makeSession().samples[0], timestamp: now - 100, powerWatts: 275, cadenceRpm: 92 };

    expect(makeTrainerTelemetrySafe(sample, 'connected', now).powerWatts).toBe(275);
    expect(makeTrainerTelemetrySafe(sample, 'reconnecting', now)).toMatchObject({
      powerWatts: 0,
      cadenceRpm: 0,
      flywheelSpeedKph: 0,
    });
    expect(makeTrainerTelemetrySafe({ ...sample, timestamp: now - 3_000 }, 'connected', now).powerWatts).toBe(0);
  });
});

describe('route handling', () => {
  it('parses, smooths, and indexes a GPX course', () => {
    const route = parseGpxString(SAMPLE_GPX);
    expect(route.name).toBe('Morning & Hills');
    expect(route.points).toHaveLength(4);
    expect(route.totalDistanceMeters).toBeGreaterThan(160);
    expect(route.totalElevationGainMeters).toBeGreaterThan(0);
    expect(route.points.every((point) => Math.abs(point.grade) <= 25)).toBe(true);

    const finish = getInterpolatedProgress(route, route.totalDistanceMeters + 100);
    expect(finish.isFinished).toBe(true);
    expect(finish.percentComplete).toBe(100);
    expect(finish.currentPoint.cumulativeDistance).toBeCloseTo(route.totalDistanceMeters);
  });

  it('derives a stable scenery ID from route geometry', () => {
    const first = parseGpxString(SAMPLE_GPX);
    const second = parseGpxString(SAMPLE_GPX);
    const changed = parseGpxString(SAMPLE_GPX.replace('<ele>113</ele>', '<ele>114</ele>'));

    expect(second.id).toBe(first.id);
    expect(changed.id).not.toBe(first.id);
  });

  it('rejects malformed and stationary routes', () => {
    expect(() => parseGpxString('<gpx><trk><trkseg><trkpt lat="x" lon="6"/><trkpt lat="45" lon="6"/></trkseg></trk></gpx>')).toThrow(/invalid coordinate/i);
    expect(() => parseGpxString('<gpx><trk><trkseg><trkpt lat="45" lon="6"/><trkpt lat="45" lon="6"/></trkseg></trk></gpx>')).toThrow(/no measurable distance/i);
  });

  it('recognizes complete routes before restoring them from browser storage', () => {
    const route = parseGpxString(SAMPLE_GPX);
    expect(isUsableRoute(route)).toBe(true);
    expect(isUsableRoute({ ...route, points: [] })).toBe(false);
    expect(isUsableRoute({ ...route, totalDistanceMeters: -1 })).toBe(false);
    expect(isUsableRoute({
      ...route,
      points: route.points.map((point, index) => index === 1
        ? { ...point, cumulativeDistance: -1 }
        : point),
    })).toBe(false);
    expect(isUsableRoute({
      ...route,
      points: route.points.map((point, index) => index === 0
        ? { ...point, lat: 120 }
        : point),
    })).toBe(false);
  });
});

describe('activity exports', () => {
  it('preserves active time separately from elapsed time and accepts zero coordinates', async () => {
    const session = makeSession();
    session.endTime = session.startTime + 30_000;
    session.samples[0].lat = 0;
    session.samples[0].lng = 0;
    const bytes = exportSessionToFit(session);
    const result = await new FitParser({ force: false, strict: true, mode: 'list' }).parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    expect(result.sessions?.[0]).toMatchObject({ total_elapsed_time: 30, total_timer_time: 3 });
    expect(result.records?.[0]).toMatchObject({ position_lat: 0, position_long: 0 });
  });
  it('exports FIT records and summaries decoded independently with strict CRC validation', async () => {
    const session = makeSession();
    session.samples.forEach((sample, index) => { sample.heartRateBpm = 140 + index; });
    const bytes = exportSessionToFit(session);
    const parser = new FitParser({ force: false, strict: true, mode: 'list', speedUnit: 'm/s', lengthUnit: 'm' });
    const decoded = await parser.parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    expect(decoded.records).toHaveLength(3);
    expect(decoded.laps).toHaveLength(1);
    expect(decoded.sessions).toHaveLength(1);
    expect(decoded.records?.[0]).toMatchObject({ power: 200, cadence: 88, heart_rate: 140, distance: 0 });
    expect(decoded.records?.[2].position_lat).toBeCloseTo(45.0002, 5);
    expect(decoded.records?.[2].position_long).toBeCloseTo(6.0002, 5);
    expect(decoded.records?.[2].enhanced_altitude).toBeCloseTo(103, 1);
    expect(decoded.records?.[2].enhanced_speed).toBeCloseTo(30 / 3.6, 2);
    expect(decoded.records?.[0].timestamp).toEqual(new Date(session.startTime));
    expect(decoded.sessions?.[0]).toMatchObject({ total_distance: 24, total_timer_time: 3, total_elapsed_time: 3, avg_power: 210, max_power: 220, sport: 'cycling', sub_sport: 'indoor_cycling' });
    const corrupted = bytes.slice();
    corrupted[corrupted.length - 1] ^= 0xff;
    await expect(parser.parseAsync(corrupted.buffer)).rejects.toThrow();
  });

  it('creates TCX with GPS, real maximum speed, and power extensions', () => {
    const tcx = exportSessionToTcx(makeSession());
    expect(tcx).toContain('<LatitudeDegrees>45.000000</LatitudeDegrees>');
    expect(tcx).toContain('<ns3:Watts>220</ns3:Watts>');
    expect(tcx).toContain('<MaximumSpeed>8.33</MaximumSpeed>');
    expect(tcx).not.toContain('<MaximumSpeed>15.00</MaximumSpeed>');
    expect(tcx).not.toContain('xsi:nil');
    expect(tcx).not.toContain('<AverageHeartRateBpm>');
    expect(XMLValidator.validate(tcx)).toBe(true);
  });

  it('includes schema-valid optional heart-rate values in TCX', () => {
    const session = makeSession();
    session.samples = session.samples.map((sample, index) => ({
      ...sample,
      heartRateBpm: 140 + index * 5,
    }));

    const tcx = exportSessionToTcx(session);
    expect(tcx).toContain('<AverageHeartRateBpm><Value>145</Value></AverageHeartRateBpm>');
    expect(tcx).toContain('<MaximumHeartRateBpm><Value>150</Value></MaximumHeartRateBpm>');
    expect(tcx).toContain('<HeartRateBpm><Value>140</Value></HeartRateBpm>');
  });
});
