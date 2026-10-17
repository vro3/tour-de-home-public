import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import { telemetryBeacon } from '../vite.config';

function request(headers: Record<string, string> = {}) {
  let handler: any;
  const plugin = telemetryBeacon();
  (plugin.configureServer as any)({ middlewares: { use: (_path: string, fn: any) => { handler = fn; } } });
  const req = Object.assign(new EventEmitter(), { method: 'POST', headers: { host: 'localhost:5173', 'content-type': 'application/json', ...headers } });
  const res = { statusCode: 200, writableEnded: false, end() { this.writableEnded = true; } };
  handler(req, res);
  return { req, res };
}
afterEach(() => vi.restoreAllMocks());
describe('dev telemetry boundary', () => {
  it('rejects hostile origins before reading their bodies', () => {
    const { req, res } = request({ origin: 'https://evil.example' });
    expect(res.statusCode).toBe(403);
    expect(req.listenerCount('data')).toBe(0);
  });
  it('rejects streamed oversized bodies without appending them', () => {
    const append = vi.spyOn(fs, 'appendFile').mockImplementation(() => undefined);
    const { req, res } = request();
    req.emit('data', Buffer.alloc(4097));
    req.emit('data', Buffer.alloc(10));
    req.emit('end');
    expect(res.statusCode).toBe(413);
    expect(append).not.toHaveBeenCalled();
  });
  it('writes valid telemetry as a single JSON log line', () => {
    const append = vi.spyOn(fs, 'appendFile').mockImplementation(() => undefined);
    const { req, res } = request();
    req.emit('data', Buffer.from('{\n"watts": 120\n}')); req.emit('end');
    expect(res.statusCode).toBe(200);
    expect(append.mock.calls[0][1]).toBe('{"watts":120}\n');
  });
});
