import { afterEach, describe, expect, it, vi } from 'vitest';
import { WakeLockManager } from '../src/utils/wakeLock';

const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');

afterEach(() => {
  if (originalNavigator) Object.defineProperty(globalThis, 'navigator', originalNavigator);
  else Reflect.deleteProperty(globalThis, 'navigator');
  vi.restoreAllMocks();
});

function installWakeLock(request: () => Promise<WakeLockSentinel>): void {
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { wakeLock: { request } },
  });
}

function makeSentinel(release: () => Promise<void>): WakeLockSentinel {
  const target = new EventTarget() as WakeLockSentinel;
  Object.defineProperties(target, {
    released: { configurable: true, get: () => false },
    type: { configurable: true, value: 'screen' },
    release: { configurable: true, value: release },
  });
  return target;
}

describe('WakeLockManager', () => {
  it('does not let an old release callback erase a newly acquired lock', async () => {
    let finishFirstRelease!: () => void;
    const firstRelease = vi.fn(() => new Promise<void>((resolve) => {
      finishFirstRelease = resolve;
    }));
    const secondRelease = vi.fn(async () => undefined);
    const sentinels = [makeSentinel(firstRelease), makeSentinel(secondRelease)];
    const request = vi.fn(async () => sentinels.shift()!);
    installWakeLock(request);
    const manager = new WakeLockManager();

    expect(await manager.requestWakeLock()).toBe(true);
    manager.releaseWakeLock();
    expect(await manager.requestWakeLock()).toBe(true);
    finishFirstRelease();
    await Promise.resolve();

    expect(await manager.requestWakeLock()).toBe(true);
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('releases an acquisition that completes after the ride was paused', async () => {
    let finishRequest!: (sentinel: WakeLockSentinel) => void;
    const lateRelease = vi.fn(async () => undefined);
    const request = vi.fn(() => new Promise<WakeLockSentinel>((resolve) => {
      finishRequest = resolve;
    }));
    installWakeLock(request);
    const manager = new WakeLockManager();

    const acquisition = manager.requestWakeLock();
    manager.releaseWakeLock();
    finishRequest(makeSentinel(lateRelease));

    expect(await acquisition).toBe(false);
    expect(lateRelease).toHaveBeenCalledTimes(1);
  });
});
