// src/shared/utils/bitConversion.ts

/**
 * Converts a Float32 to Int32 bits for SAB storage.
 */
export function floatToInt32Bits(f: number): number {
  const buffer = new ArrayBuffer(4);
  const floatView = new Float32Array(buffer);
  const intView = new Int32Array(buffer);
  floatView[0] = f;
  return intView[0];
}

/**
 * Converts Int32 bits back to Float32.
 */
export function int32BitsToFloat(i: number): number {
  const buffer = new ArrayBuffer(4);
  const intView = new Int32Array(buffer);
  const floatView = new Float32Array(buffer);
  intView[0] = i;
  return floatView[0];
}

export function toIndex(byteOffset: number): number {
  return byteOffset >> 2;
}
