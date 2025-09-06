// src/core/utils/prng.ts
/**
 * A simple, seeded pseudo-random number generator (LCG).
 * This allows for deterministic "random" sequences, which is useful for
 * procedural generation and consistent scene layouts.
 */
export class PRNG {
  private seed: number;

  constructor(seed = 1) {
    this.seed = seed;
  }

  /**
   * Generates the next pseudo-random number in the sequence.
   * @returns A floating-point number between 0 (inclusive) and 1 (exclusive).
   */
  public next(): number {
    // LCG parameters from POSIX
    this.seed = (this.seed * 1103515245 + 12345) % 2147483648;
    return this.seed / 2147483648;
  }

  /**
   * Generates a pseudo-random number within a specified range.
   * @param min The minimum value (inclusive).
   * @param max The maximum value (exclusive).
   * @returns A floating-point number within the specified range.
   */
  public range(min: number, max: number): number {
    return this.next() * (max - min) + min;
  }
}
