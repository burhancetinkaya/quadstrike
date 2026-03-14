export class ClockSynchronizer {
  private offsetMs = 0;

  private initialized = false;

  reset(): void {
    this.offsetMs = 0;
    this.initialized = false;
  }

  observeSnapshot(remoteHostTime: number, receivedAt: number): void {
    const estimatedOffset = receivedAt - remoteHostTime;
    if (!this.initialized) {
      this.offsetMs = estimatedOffset;
      this.initialized = true;
      return;
    }
    this.offsetMs = this.offsetMs * 0.9 + estimatedOffset * 0.1;
  }

  observeRoundTrip(remoteTime: number, sentAt: number, receivedAt: number): void {
    const roundTrip = receivedAt - sentAt;
    const estimatedOffset = remoteTime + roundTrip * 0.5 - receivedAt;
    if (!this.initialized) {
      this.offsetMs = estimatedOffset;
      this.initialized = true;
      return;
    }
    this.offsetMs = this.offsetMs * 0.85 + estimatedOffset * 0.15;
  }

  getSynchronizedNow(localNow = performance.now()): number {
    return localNow - this.offsetMs;
  }

  getOffsetMs(): number {
    return this.offsetMs;
  }
}
