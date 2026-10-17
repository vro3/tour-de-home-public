export class WakeLockManager {
  private wakeLock: WakeLockSentinel | null = null;
  private wakeLockRequest: Promise<boolean> | null = null;
  private generation = 0;

  public async requestWakeLock(): Promise<boolean> {
    if (this.wakeLock && !this.wakeLock.released) return true;
    if (this.wakeLockRequest) return this.wakeLockRequest;
    if (!('wakeLock' in navigator)) return false;

    const requestGeneration = this.generation;
    const request = (async () => {
      try {
        const sentinel = await navigator.wakeLock.request('screen');
        if (requestGeneration !== this.generation) {
          await sentinel.release();
          return false;
        }
        this.wakeLock = sentinel;
        console.log('[WakeLock] Screen wake lock acquired.');
        sentinel.addEventListener('release', () => {
          if (this.wakeLock === sentinel) this.wakeLock = null;
          console.log('[WakeLock] Screen wake lock was released.');
        });
        return true;
      } catch (err) {
        const errorName = err instanceof DOMException ? err.name : '';
        const log = errorName === 'NotAllowedError' || errorName === 'NotSupportedError'
          ? console.info
          : console.warn;
        log('[WakeLock] Could not acquire screen wake lock:', err);
        return false;
      }
    })();
    this.wakeLockRequest = request;
    try {
      return await request;
    } finally {
      if (this.wakeLockRequest === request) this.wakeLockRequest = null;
    }
  }

  public releaseWakeLock(): void {
    this.generation += 1;
    const sentinel = this.wakeLock;
    this.wakeLock = null;
    if (!sentinel || sentinel.released) return;
    void sentinel.release().catch((error) => {
      console.warn('[WakeLock] Could not release screen wake lock:', error);
    });
  }
}

export const wakeLockManager = new WakeLockManager();
