import { useEffect, useMemo, useState } from 'react';
import {
  ArrowUp,
  CheckCircle2,
  Clock3,
  ExternalLink,
  Globe2,
  LibraryBig,
  LoaderCircle,
  MapPin,
  Search,
} from 'lucide-react';
import type { RouteModel } from '../types/cycling';
import { parseGpxString, repeatRouteLaps } from '../route/gpxParser';

type CourseFilter = string;

interface LibraryCourse {
  id: string;
  name: string;
  raceName: string;
  format: string;
  country: string;
  countryCode: string;
  city: string;
  region: string;
  year: number | null;
  distanceKm: number | null;
  elevationGainM: number | null;
  estimatedHours: number | null;
  underFiveHours: boolean;
  pointCount: number | null;
  courseLaps: number | null;
  file: string;
  sourcePageUrl: string | null;
  officialStatus: string;
  tags: string[];
}

interface CourseManifest {
  source: string;
  disclaimer: string;
  stats: {
    total: number;
    underFiveHours: number;
    countries: number;
    formats: Record<string, number>;
  };
  countries: string[];
  courses: LibraryCourse[];
}

interface CourseLibraryProps {
  selectedRoute: RouteModel | null;
  onSelectRoute: (route: RouteModel) => void;
}

function assetUrl(path: string) {
  return `${import.meta.env.BASE_URL}course-library/${path}`;
}

function countryFlag(countryCode: string) {
  const code = countryCode.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(code)) return '🌍';
  return String.fromCodePoint(...[...code].map((letter) => 127397 + letter.charCodeAt(0)));
}

function durationLabel(hours: number | null) {
  if (hours === null) return 'Time n/a';
  const totalMinutes = Math.round(hours * 60);
  return `~${Math.floor(totalMinutes / 60)}h ${String(totalMinutes % 60).padStart(2, '0')}m`;
}

function courseTitle(course: LibraryCourse) {
  return course.name.replace(/\s+—\s+Bike Course\s*/i, ' ');
}

export function CourseLibrary({ selectedRoute, onSelectRoute }: CourseLibraryProps) {
  const [manifest, setManifest] = useState<CourseManifest | null>(null);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<CourseFilter>('workout');
  const [country, setCountry] = useState('all');
  const [visibleCount, setVisibleCount] = useState(9);
  const [loadingCourseId, setLoadingCourseId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const filters = [
    { id: 'workout', label: 'Under 5 hours' },
    ...Object.keys(manifest?.stats.formats ?? {}).map(id => ({ id, label: id === 'sample' ? 'Samples' : id === 'IRONMAN' ? 'Full' : id })),
    { id: 'all', label: 'All courses' },
  ];

  useEffect(() => {
    const controller = new AbortController();
    setError(null);
    fetch(assetUrl('courses.json'), { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error(`Course library returned ${response.status}.`);
        return response.json() as Promise<CourseManifest>;
      })
      .then((value: CourseManifest) => {
        if (!value || typeof value.source !== 'string' || typeof value.disclaimer !== 'string'
          || !value.stats || !Number.isFinite(value.stats.total) || !Number.isFinite(value.stats.underFiveHours)
          || !Number.isFinite(value.stats.countries) || !value.stats.formats || typeof value.stats.formats !== 'object'
          || !Array.isArray(value.countries) || !value.countries.every(item => typeof item === 'string')
          || !Array.isArray(value.courses) || !value.courses.every(course => (
            course && ['id', 'name', 'raceName', 'format', 'country', 'countryCode', 'city', 'region', 'file'].every(key => typeof course[key as keyof LibraryCourse] === 'string')
            && ['distanceKm', 'elevationGainM', 'estimatedHours'].every(key => course[key as keyof LibraryCourse] === null || Number.isFinite(course[key as keyof LibraryCourse]))
            && /^((samples|gpx)\/)[a-zA-Z0-9._-]+\.gpx$/.test(course.file)
            && (course.courseLaps === null || (Number.isInteger(course.courseLaps) && course.courseLaps >= 1 && course.courseLaps <= 100))
            && (course.sourcePageUrl === null || /^https?:\/\//.test(course.sourcePageUrl))
          ))) throw new Error('The course library has an unsupported format. You can still import a GPX below.');
        if (!controller.signal.aborted) setManifest(value);
      })
      .catch((loadError) => {
        if (loadError instanceof DOMException && loadError.name === 'AbortError') return;
        setError(loadError instanceof Error ? loadError.message : 'Could not open the course library.');
      });
    return () => controller.abort();
  }, [reloadKey]);

  useEffect(() => {
    setVisibleCount(9);
  }, [query, filter, country]);

  const filteredCourses = useMemo(() => {
    if (!manifest) return [];
    const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
    return manifest.courses.filter((course) => {
      const matchesFilter =
        filter === 'all' ||
        (filter === 'workout' ? course.underFiveHours : course.format === filter);
      const matchesCountry = country === 'all' || course.country === country;
      const searchable = `${course.name} ${course.raceName} ${course.city} ${course.region} ${course.country}`.toLocaleLowerCase();
      const matchesSearch = terms.every((term) => searchable.includes(term));
      return matchesFilter && matchesCountry && matchesSearch;
    });
  }, [country, filter, manifest, query]);

  const loadCourse = async (course: LibraryCourse) => {
    setError(null);
    setLoadingCourseId(course.id);
    try {
      const response = await fetch(assetUrl(course.file));
      if (!response.ok) throw new Error(`Could not download this GPX route (${response.status}).`);
      const parsedRoute = parseGpxString(await response.text(), course.name);
      const route = repeatRouteLaps(parsedRoute, course.courseLaps ?? 1);
      onSelectRoute({
        ...route,
        id: `library_${course.id}`,
        name: course.name,
      });
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'This course could not be loaded.');
    } finally {
      setLoadingCourseId(null);
    }
  };

  return (
    <section className="relative overflow-hidden rounded-3xl border border-cyan-500/20 bg-slate-950/65 shadow-2xl shadow-cyan-950/20">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-36 bg-gradient-to-br from-cyan-500/10 via-blue-500/5 to-transparent" />
      <div className="relative p-3 sm:p-5 md:p-6">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <div className="mb-2 flex items-center gap-2 text-xs font-black uppercase tracking-[0.2em] text-cyan-300">
              <LibraryBig className="h-4 w-4" />
              Course Library
            </div>
            <h3 className="text-2xl font-black tracking-tight text-white md:text-3xl">
              Find your next ride.
            </h3>
            <p className="mt-1 max-w-2xl text-sm text-slate-400">
              {manifest?.source ?? 'Choose a sample course or import your own GPX.'}
            </p>
          </div>

          {manifest ? (
            <div className={`grid ${manifest.stats.countries > 0 ? 'grid-cols-3' : 'grid-cols-2'} divide-x divide-slate-700 overflow-hidden rounded-2xl border border-slate-700/80 bg-slate-900/80 text-center`}>
              <div className="px-3 py-2.5">
                <div className="font-mono text-lg font-black text-white">{manifest.stats.total}</div>
                <div className="text-[10px] uppercase tracking-wider text-slate-500">Courses</div>
              </div>
              <div className="px-3 py-2.5">
                <div className="font-mono text-lg font-black text-emerald-300">{manifest.stats.underFiveHours}</div>
                <div className="text-[10px] uppercase tracking-wider text-slate-500">Workout size</div>
              </div>
              {manifest.stats.countries > 0 && <div className="px-3 py-2.5">
                <div className="font-mono text-lg font-black text-cyan-300">{manifest.stats.countries}</div>
                <div className="text-[10px] uppercase tracking-wider text-slate-500">Countries</div>
              </div>}
            </div>
          ) : !error ? (
            <div className="h-16 w-full max-w-72 animate-pulse rounded-2xl bg-slate-800/70" />
          ) : null}
        </div>

        <div className="mt-5 grid grid-cols-1 gap-3 lg:grid-cols-[minmax(260px,1fr)_auto]">
          <label className="flex min-w-0 h-11 items-center gap-2 rounded-xl border border-slate-700 bg-slate-900/90 px-3 text-slate-400 focus-within:border-cyan-400/70 focus-within:ring-2 focus-within:ring-cyan-500/10">
            <Search className="h-4 w-4 shrink-0" />
            <input
              type="search"
              value={query}
              onChange={(event) => {
                const nextQuery = event.target.value;
                setQuery(nextQuery);
                // Text search is global by default; the user can then narrow the result set explicitly.
                if (nextQuery.trim() && filter === 'workout') setFilter('all');
              }}
              placeholder="Search courses…"
              aria-label="Search course library"
              className="min-w-0 flex-1 bg-transparent text-sm text-white outline-none placeholder:text-slate-600"
            />
          </label>
          <div className="flex min-w-0 gap-2 overflow-x-auto pb-1 lg:pb-0">
            {filters.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setFilter(item.id)}
                aria-pressed={filter === item.id}
                className={`h-11 shrink-0 rounded-xl border px-3 text-xs font-bold transition-all ${
                  filter === item.id
                    ? 'border-cyan-400/70 bg-cyan-400 text-slate-950 shadow-lg shadow-cyan-500/15'
                    : 'border-slate-700 bg-slate-900/80 text-slate-300 hover:border-slate-500 hover:text-white'
                }`}
              >
                {item.label}
                {manifest && item.id !== 'all' && (
                  <span className="ml-1.5 opacity-60">
                    {item.id === 'workout' ? manifest.stats.underFiveHours : manifest.stats.formats[item.id]}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          {Boolean(manifest?.stats.countries) && <label className="flex items-center gap-2 text-xs font-semibold text-slate-400">
            <Globe2 className="h-4 w-4 text-cyan-400" />
            <select
              value={country}
              onChange={(event) => setCountry(event.target.value)}
              aria-label="Filter courses by country"
              className="rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs text-slate-200 outline-none focus:border-cyan-400"
            >
              <option value="all">Every country</option>
              {manifest?.countries.map((item) => (
                <option key={item} value={item}>{item}</option>
              ))}
            </select>
          </label>}
          <div className="text-xs text-slate-500">
            {manifest ? `${filteredCourses.length} route${filteredCourses.length === 1 ? '' : 's'} found` : error ? 'Library unavailable' : 'Opening the library…'}
          </div>
        </div>

        {error && (
          <div role="alert" className="mt-4 rounded-xl border border-red-500/30 bg-red-950/40 px-4 py-3 text-sm text-red-200">
            {error}
            {!manifest && <button type="button" onClick={() => setReloadKey(key => key + 1)} className="ml-2 min-h-11 underline">Retry library</button>}
          </div>
        )}

        {!manifest && !error && (
          <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {[0, 1, 2].map((item) => <div key={item} className="h-44 animate-pulse rounded-2xl bg-slate-800/60" />)}
          </div>
        )}

        {manifest && filteredCourses.length === 0 && (
          <div className="mt-4 rounded-2xl border border-dashed border-slate-700 py-10 text-center text-sm text-slate-400">
            {manifest.courses.length === 0 ? 'No bundled courses. Import a GPX or choose an original route below.' : 'No route matches those filters. Try another country or search term.'}
          </div>
        )}

        {manifest && filteredCourses.length > 0 && (
          <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {filteredCourses.slice(0, visibleCount).map((course) => {
              const isSelected = selectedRoute?.id === `library_${course.id}`;
              const isLoading = loadingCourseId === course.id;
              return (
                <article
                  key={course.id}
                  className={`group relative flex min-h-44 flex-col overflow-hidden rounded-2xl border p-4 transition-all ${
                    isSelected
                      ? 'border-emerald-400/70 bg-emerald-950/30 shadow-lg shadow-emerald-500/10'
                      : 'border-slate-700/80 bg-slate-900/75 hover:-translate-y-0.5 hover:border-cyan-500/50 hover:bg-slate-900'
                  }`}
                >
                  <div className="mb-3 flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="text-xl" aria-hidden="true">{countryFlag(course.countryCode)}</span>
                      <div className="min-w-0">
                        <div className="truncate text-[11px] font-bold uppercase tracking-wider text-cyan-300">
                          {course.format === 'sample' ? 'Simulated course' : course.format === 'IRONMAN' ? 'Full IRONMAN' : course.format}
                        </div>
                        <div className="truncate text-xs text-slate-500">{course.country}</div>
                      </div>
                    </div>
                    {course.underFiveHours && (
                      <span className="hidden shrink-0 rounded-full border border-emerald-500/30 sm:inline-block bg-emerald-500/10 px-2 py-1 text-[9px] font-black uppercase tracking-wider text-emerald-300">
                        Workout ready
                      </span>
                    )}
                  </div>

                  <h4 className="min-h-10 break-words text-sm font-black leading-snug text-white">
                    {courseTitle(course)}
                  </h4>

                  <div className="mt-3 grid grid-cols-[repeat(auto-fit,minmax(min(100%,5rem),1fr))] gap-1.5 font-mono text-xs">
                    <div className="rounded-lg bg-slate-950/75 px-2 py-2 text-slate-300">
                      <span className="block text-[9px] font-sans uppercase text-slate-600">Distance</span>
                      {course.distanceKm?.toFixed(1) ?? '—'} km
                    </div>
                    <div className="rounded-lg bg-slate-950/75 px-2 py-2 text-slate-300">
                      <span className="block text-[9px] font-sans uppercase text-slate-600">Climbing</span>
                      <span className="text-amber-300">{course.elevationGainM === null ? '—' : `+${Math.round(course.elevationGainM)}`} m</span>
                    </div>
                    <div className="rounded-lg bg-slate-950/75 px-2 py-2 text-slate-300">
                      <span className="block text-[9px] font-sans uppercase text-slate-600">Estimate</span>
                      {durationLabel(course.estimatedHours)}
                    </div>
                  </div>

                  <div className="mt-auto flex items-end justify-between gap-2 pt-4">
                    <div className="min-w-0 text-[10px] text-slate-500">
                      <div className="flex items-center gap-1 truncate">
                        <MapPin className="h-3 w-3 shrink-0" /> {course.city || course.region}
                      </div>
                      {course.sourcePageUrl && <a
                        href={course.sourcePageUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-1 inline-flex items-center gap-1 hover:text-cyan-300"
                      >
                        Course source <ExternalLink className="h-2.5 w-2.5" />
                      </a>}
                    </div>
                    <button
                      type="button"
                      onClick={() => void loadCourse(course)}
                      disabled={loadingCourseId !== null}
                      aria-label={`Load ${course.name}`}
                      className={`flex min-h-11 shrink-0 items-center gap-1.5 rounded-xl px-3 text-xs font-black transition-all disabled:cursor-wait disabled:opacity-60 ${
                        isSelected
                          ? 'bg-emerald-400 text-slate-950'
                          : 'bg-cyan-400 text-slate-950 hover:bg-cyan-300 active:scale-95'
                      }`}
                    >
                      {isLoading ? (
                        <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                      ) : isSelected ? (
                        <CheckCircle2 className="h-3.5 w-3.5" />
                      ) : (
                        <Clock3 className="h-3.5 w-3.5" />
                      )}
                      {isLoading ? 'Loading' : isSelected ? 'Loaded' : 'Ride this'}
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        )}

        {visibleCount < filteredCourses.length && (
          <button
            type="button"
            onClick={() => setVisibleCount((count) => count + 12)}
            className="mx-auto mt-5 flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-900 px-5 py-2.5 text-xs font-bold text-slate-300 transition-colors hover:border-cyan-500/50 hover:text-white"
          >
            Show more routes
            <ArrowUp className="h-3.5 w-3.5 rotate-180" />
          </button>
        )}

        {manifest && (
          <div className="mt-4 text-center text-[10px] text-slate-600">
            {manifest.disclaimer} Route time is an estimate; your power and terrain determine the ride.
          </div>
        )}
      </div>
    </section>
  );
}
