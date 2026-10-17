import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseGpxString, repeatRouteLaps } from '../src/route/gpxParser';

interface CourseRecord {
  id: string;
  name: string;
  format: string;
  country: string;
  underFiveHours: boolean;
  distanceKm: number | null;
  courseLaps: number | null;
  file: string;
}

interface CourseManifest {
  stats: {
    total: number;
    underFiveHours: number;
    countries: number;
    formats: Record<string, number>;
  };
  courses: CourseRecord[];
}

const publicRoot = path.resolve(process.cwd(), 'public', 'course-library');
const manifest = JSON.parse(
  readFileSync(path.join(publicRoot, 'courses.json'), 'utf8')
) as CourseManifest;

describe('bundled course library', () => {
  it('ships only the original redistributable sample courses', () => {
    expect(manifest.stats.total).toBe(3);
    expect(manifest.courses).toHaveLength(3);
    expect(new Set(manifest.courses.map(course => course.id)).size).toBe(3);
    for (const course of manifest.courses) {
      expect(course.format).toBe('sample');
      expect(course.file).toMatch(/^samples\/[a-z-]+\.gpx$/);
    }
  });

  it('ships and parses every GPX through the real ride engine', () => {
    for (const course of manifest.courses) {
      const gpx = readFileSync(path.join(publicRoot, course.file), 'utf8');
      const route = repeatRouteLaps(parseGpxString(gpx, course.name), course.courseLaps ?? 1);
      expect(route.points.length, course.name).toBeGreaterThan(1);
      expect(route.totalDistanceMeters, course.name).toBeGreaterThan(100);
      if (course.distanceKm !== null) {
        const distanceDifference = Math.abs(route.totalDistanceMeters / 1000 - course.distanceKm);
        expect(distanceDifference, course.name).toBeLessThan(0.01);
      }
      expect(route.points.every((point) => Number.isFinite(point.grade)), course.name).toBe(true);
    }
  });
});
