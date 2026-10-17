// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConnectModal } from '../src/components/ConnectModal';
import { parseGpxString } from '../src/route/gpxParser';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('first-run and import safety', () => {
  it('explains unsupported Bluetooth and focuses the working demo option', () => {
    vi.stubGlobal('navigator', { bluetooth: undefined });
    const demo = vi.fn();
    render(<ConnectModal isOpen isConnecting={false} error={null} onConnectReal={vi.fn()} onConnectMock={demo} onClose={vi.fn()} />);
    expect(screen.getByRole('status').textContent).toContain('Web Bluetooth');
    expect((screen.getByRole('button', { name: /Connect FTMS Trainer/ }) as HTMLButtonElement).disabled).toBe(true);
    const button = screen.getByRole('button', { name: /Launch Mock Simulator/ });
    expect(document.activeElement).toBe(button);
    fireEvent.click(button);
    expect(demo).toHaveBeenCalledOnce();
  });
  it('announces a denied pairing request while keeping the demo available', () => {
    render(<ConnectModal isOpen isConnecting={false} error="Bluetooth access was denied." onConnectReal={vi.fn()} onConnectMock={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByRole('alert').textContent).toContain('denied');
    expect((screen.getByRole('button', { name: /Launch Mock Simulator/ }) as HTMLButtonElement).disabled).toBe(false);
  });
  it('rejects malformed XML and custom document entities before parsing', () => {
    expect(() => parseGpxString('<gpx><trk></gpx>')).toThrow('malformed');
    expect(() => parseGpxString('<!DOCTYPE gpx [<!ENTITY x "payload">]><gpx/>')).toThrow('custom entities');
  });
});
