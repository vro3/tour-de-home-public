import { useRef, useState } from 'react';
import type { SavedRideSession } from '../storage/rideJournal';
import { saveImportedRide } from '../storage/rideHistory';

export function FitImport({ onImported, importedRides, onSelect }: {
  onImported: (ride: SavedRideSession) => void;
  importedRides: SavedRideSession[];
  onSelect: (ride: SavedRideSession) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const inFlight = useRef(false);
  return <section aria-label="Import a Strava activity" className="rounded-2xl border border-cyan-500/30 bg-slate-950/80 p-4 text-sm">
    <h2 className="font-bold text-white">Import a Strava ride or run</h2>
    <p className="my-2 text-slate-400">In Strava, choose Export Original, then select the .fit file here. Your file stays in this browser. Recorded timer pauses are excluded from your ghost.</p>
    <label className="block font-semibold text-cyan-200">Original FIT file
      <input aria-label="Original FIT file" type="file" accept=".fit" disabled={busy} className="mt-2 block w-full min-w-0 rounded-lg border border-slate-600 p-2 text-sm"
        onChange={async e => {
          const file = e.currentTarget.files?.[0];
          e.currentTarget.value = '';
          if (!file || inFlight.current) return;
          inFlight.current = true; setBusy(true); setError(''); setMessage('Reading your activity…');
          try {
            if (!/\.fit$/i.test(file.name) || file.size > 20_000_000) throw new Error('Choose an uncompressed .fit file smaller than 20 MB.');
            const { importFit } = await import('../import/fitImport');
            const ride = await importFit(await file.arrayBuffer(), file.name);
            await saveImportedRide(ride);
            onImported(ride);
            setMessage(`Ready to race: ${ride.routeName}. ${ride.route?.synthetic ? 'No GPS: using a virtual flat course with the recorded distance.' : 'The recorded course and ghost are selected.'}`);
          } catch (err) { setMessage(''); setError(err instanceof Error ? err.message : 'Could not import or save this activity. Check browser storage and try again.'); }
          finally { inFlight.current = false; setBusy(false); }
        }} />
    </label>
    {message && <p role="status" className="mt-2 break-words text-cyan-200">{message}</p>}
    {error && <p role="alert" className="mt-2 text-amber-200">{error}</p>}
    {importedRides.length > 0 && <label className="mt-3 block text-slate-300">Saved imported activities
      <select aria-label="Saved imported activities" value="" onChange={e => { const ride = importedRides.find(r => r.id === e.target.value); if (ride) onSelect(ride); }} className="mt-1 block min-h-11 w-full min-w-0 rounded-xl border border-slate-600 bg-slate-900 p-2">
        <option value="">Choose a course and ghost…</option>
        {importedRides.map(ride => <option key={ride.id} value={ride.id}>{ride.routeName} · {ride.sport === 'running' ? 'Run' : 'Ride'} · {new Date(ride.startTime).toLocaleDateString()}</option>)}
      </select>
    </label>}
  </section>;
}
