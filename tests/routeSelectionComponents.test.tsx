// @vitest-environment jsdom
// @vitest-environment-options { "url": "http://localhost/" }

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CourseLibrary } from '../src/components/CourseLibrary';
import { RoutePicker } from '../src/components/RoutePicker';
import type { RouteModel } from '../src/types/cycling';

const GPX = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Tour de Home tests">
  <trk>
    <trkseg>
      <trkpt lat="41.8781" lon="-87.6298"><ele>180</ele></trkpt>
      <trkpt lat="41.8791" lon="-87.6288"><ele>184</ele></trkpt>
      <trkpt lat="41.8801" lon="-87.6278"><ele>182</ele></trkpt>
    </trkseg>
  </trk>
</gpx>`;

const emptyManifest = {
  source: 'test fixture',
  disclaimer: 'Test courses only.',
  stats: {
    total: 0,
    underFiveHours: 0,
    countries: 0,
    formats: { '70.3': 0, IRONMAN: 0, '5150': 0 },
  },
  countries: [],
  courses: [],
};

const libraryCourse = {
  id: 'lakefront-loop',
  name: 'Lakefront Loop — Bike Course',
  raceName: 'Lakefront Test Race',
  format: '70.3' as const,
  country: 'United States',
  countryCode: 'US',
  city: 'Chicago',
  region: 'Illinois',
  year: 2026,
  distanceKm: 0.3,
  elevationGainM: 4,
  estimatedHours: 0.02,
  underFiveHours: true,
  pointCount: 3,
  courseLaps: 1,
  file: 'gpx/lakefront-loop.gpx',
  sourcePageUrl: 'https://example.com/lakefront-loop',
  officialStatus: 'test',
  tags: ['test'],
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('route selection components', () => {
  it('parses a dropped GPX file and selects the resulting route', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => emptyManifest,
    }));
    const onSelectRoute = vi.fn();
    const { container } = render(
      <RoutePicker selectedRoute={null} onSelectRoute={onSelectRoute} />,
    );
    const fileInput = container.querySelector<HTMLInputElement>('input[type="file"][accept=".gpx"]');
    expect(fileInput).not.toBeNull();

    const file = new File([GPX], 'weekend-loop.gpx', { type: 'application/gpx+xml' });
    fireEvent.drop(fileInput!.parentElement!, {
      dataTransfer: { files: [file] },
    });

    await waitFor(() => expect(onSelectRoute).toHaveBeenCalledTimes(1));
    const selectedRoute = onSelectRoute.mock.calls[0][0] as RouteModel;
    expect(selectedRoute).toMatchObject({
      name: 'weekend-loop',
      points: [
        expect.objectContaining({ lat: 41.8781, lng: -87.6298 }),
        expect.objectContaining({ lat: 41.8791, lng: -87.6288 }),
        expect.objectContaining({ lat: 41.8801, lng: -87.6278 }),
      ],
    });
    expect(selectedRoute.totalDistanceMeters).toBeGreaterThan(1);
  });

  it('loads a manifest course when the user chooses Ride this', async () => {
    const manifest = {
      ...emptyManifest,
      stats: {
        total: 1,
        underFiveHours: 1,
        countries: 1,
        formats: { '70.3': 1, IRONMAN: 0, '5150': 0 },
      },
      countries: ['United States'],
      courses: [libraryCourse],
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('course-library/courses.json')) {
        return { ok: true, json: async () => manifest } as Response;
      }
      if (url.endsWith(`course-library/${libraryCourse.file}`)) {
        return { ok: true, text: async () => GPX } as Response;
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    const onSelectRoute = vi.fn();
    render(<CourseLibrary selectedRoute={null} onSelectRoute={onSelectRoute} />);

    const loadButton = await screen.findByRole('button', {
      name: `Load ${libraryCourse.name}`,
    });
    expect(loadButton.textContent).toContain('Ride this');
    fireEvent.click(loadButton);

    await waitFor(() => expect(onSelectRoute).toHaveBeenCalledTimes(1));
    expect(onSelectRoute).toHaveBeenCalledWith(expect.objectContaining({
      id: `library_${libraryCourse.id}`,
      name: libraryCourse.name,
      points: expect.arrayContaining([
        expect.objectContaining({ lat: 41.8781, lng: -87.6298 }),
      ]),
    }));
    expect(fetchMock.mock.calls.map(([input]) => String(input))).toEqual([
      '/course-library/courses.json',
      `/course-library/${libraryCourse.file}`,
    ]);
  });
});

describe('public course library boundaries', () => {
  it('offers GPX import when the library is empty', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => emptyManifest }));
    render(<RoutePicker selectedRoute={null} onSelectRoute={vi.fn()} />);
    expect(await screen.findByText(/No bundled courses/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Import a GPX route' })).toBeTruthy();
  });

  it('recovers from a failed library request with Retry', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 503 })
      .mockResolvedValueOnce({ ok: true, json: async () => emptyManifest }));
    render(<CourseLibrary selectedRoute={null} onSelectRoute={vi.fn()} />);
    expect(await screen.findByRole('alert')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Retry library' }));
    expect(await screen.findByText(/No bundled courses/)).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('reports malformed library data instead of crashing the picker', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ courses: null }) }));
    render(<RoutePicker selectedRoute={null} onSelectRoute={vi.fn()} />);
    expect((await screen.findByRole('alert')).textContent).toContain('unsupported format');
    expect(screen.getByRole('button', { name: 'Import a GPX route' })).toBeTruthy();
  });

  it('rejects library paths that escape the bundled course directory', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ...emptyManifest, courses: [{ ...libraryCourse, file: '../private.gpx' }] }) }));
    render(<CourseLibrary selectedRoute={null} onSelectRoute={vi.fn()} />);
    expect((await screen.findByRole('alert')).textContent).toContain('unsupported format');
  });

  it('keeps long course names and missing measurements readable', async () => {
    const course = { ...libraryCourse, name: 'A Very Long Original Route Name Through Rolling Hills and Distant Valleys', elevationGainM: null, estimatedHours: null, distanceKm: null };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ...emptyManifest, courses: [course] }) }));
    render(<CourseLibrary selectedRoute={null} onSelectRoute={vi.fn()} />);
    expect(await screen.findByRole('heading', { name: course.name })).toBeTruthy();
    expect(screen.getByText('— m')).toBeTruthy();
    expect(screen.getByText('Time n/a')).toBeTruthy();
  });

  it('rejects oversized GPX files before reading their contents', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => emptyManifest }));
    const { container } = render(<RoutePicker selectedRoute={null} onSelectRoute={vi.fn()} />);
    const text = vi.fn();
    fireEvent.change(container.querySelector('input[type=file]')!, { target: { files: [{ name: 'huge.gpx', size: 20_000_001, text }] } });
    expect((await screen.findByRole('alert')).textContent).toContain('too large');
    expect(text).not.toHaveBeenCalled();
  });
});
