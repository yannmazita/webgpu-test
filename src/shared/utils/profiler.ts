// src/shared/utils/profiler.ts

export interface ProfileTiming {
  name: string;
  duration: number;
  count: number;
}

const DEFAULT_PROFILER_ENABLED =
  (globalThis as { ENABLE_PROFILER?: boolean }).ENABLE_PROFILER === true
    ? true
    : false;

/**
 * Simple performance profiler to identify bottlenecks
 */
export class Profiler {
  private static timings = new Map<string, ProfileTiming>();
  private static startTimes = new Map<string, number>();
  private static enabled = DEFAULT_PROFILER_ENABLED;

  // eslint-disable-next-line @typescript-eslint/no-empty-function
  private constructor() {}

  /**
   * Enables or disables the profiler.
   * @param enabled Whether to enable the profiler.
   */
  static setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }
  /**
   * Checks if the profiler is enabled.
   * @returns True if the profiler is enabled, false otherwise.
   */
  static isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Starts a new timing measurement.
   * @param name The name of the measurement.
   */
  static begin(name: string): void {
    if (!this.enabled) return;
    this.startTimes.set(name, performance.now());
  }

  /**
   * Ends a timing measurement.
   * @param name The name of the measurement.
   */
  static end(name: string): void {
    if (!this.enabled) return;
    const startTime = this.startTimes.get(name);
    if (startTime === undefined) return;

    const duration = performance.now() - startTime;
    const existing = this.timings.get(name);

    if (existing) {
      existing.duration += duration;
      existing.count++;
    } else {
      this.timings.set(name, { name, duration, count: 1 });
    }

    this.startTimes.delete(name);
  }

  /**
   * Gets a formatted string with the performance report.
   * @returns The performance report.
   */
  static getReport(): string {
    const timings = Array.from(this.timings.values()).sort(
      (a, b) => b.duration - a.duration,
    );

    let report = "=== Performance Report ===\n";
    for (const timing of timings) {
      const avg = timing.duration / timing.count;
      report += `${timing.name}: ${timing.duration.toFixed(2)}ms total, ${avg.toFixed(2)}ms avg (${timing.count} calls)\n`;
    }

    return report;
  }

  /**
   * Resets the profiler's timings.
   */
  static reset(): void {
    this.timings.clear();
    this.startTimes.clear();
  }

  /**
   * Logs the performance report to the console and resets the profiler.
   */
  static logReport(): void {
    if (!this.enabled) return;
    console.log(this.getReport());
    this.reset();
  }
}
