// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { FitImport } from '../src/components/FitImport';
import { importFit } from '../src/import/fitImport';
import { saveImportedRide } from '../src/storage/rideHistory';
vi.mock('../src/import/fitImport', () => ({ importFit: vi.fn() }));
vi.mock('../src/storage/rideHistory', () => ({ saveImportedRide: vi.fn() }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });
const ride = { id: 'fit_123', importedFromFit: true, routeName: 'Test ride', route: { synthetic: false }, startTime: 1000 } as any;
const upload = () => fireEvent.change(screen.getByLabelText('Original FIT file'), { target: { files: [{ name: 'ride.fit', size: 100, arrayBuffer: async () => new ArrayBuffer(100) }] } });
it('selects the imported ghost only after durable storage succeeds', async () => {
  const onImported = vi.fn();
  vi.mocked(importFit).mockResolvedValue(ride);
  render(<FitImport onImported={onImported} onSelect={vi.fn()} importedRides={[]} />);
  upload();
  await screen.findByText(/Ready to race/);
  expect(saveImportedRide).toHaveBeenCalledWith(ride);
  expect(onImported).toHaveBeenCalledWith(ride);
});
it('keeps the existing course when parsing or saving fails and allows retry', async () => {
  const onImported = vi.fn();
  vi.mocked(importFit).mockRejectedValueOnce(new Error('Pauses cannot be located')).mockResolvedValue(ride);
  vi.mocked(saveImportedRide).mockRejectedValue(new Error('Storage is full'));
  render(<FitImport onImported={onImported} onSelect={vi.fn()} importedRides={[]} />);
  upload();
  expect((await screen.findByRole('alert')).textContent).toContain('Pauses cannot be located');
  upload();
  await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Storage is full'));
  expect(onImported).not.toHaveBeenCalled();
});
it('restores a saved imported course and opponent through the picker', () => {
  const select = vi.fn();
  render(<FitImport onImported={vi.fn()} onSelect={select} importedRides={[ride]} />);
  fireEvent.change(screen.getByLabelText('Saved imported activities'), { target: { value: ride.id } });
  expect(select).toHaveBeenCalledWith(ride);
});
