// src/loaders/exrLoader.ts

// @ts-expect-error - This is a plain JS file with no typings.
import parseExr from "./exr-parser.js";

// Constants from the parser, to be used for type hints.
const FLOAT_TYPE = 1015;
const HALF_FLOAT_TYPE = 1016;
const RGBA_FORMAT = 1023;
const RED_FORMAT = 1028;

/**
 * Interface for the data structure returned by the EXR parser.
 */
export interface EXRData {
  header: object;
  width: number;
  height: number;
  data: Float32Array | Uint16Array;
  format: typeof RGBA_FORMAT | typeof RED_FORMAT;
  colorSpace: string;
}

/**
 * Interface for the data we will return from our loader,
 * normalized for engine consumption.
 */
export interface LoadedEXRData {
  width: number;
  height: number;
  data: Float32Array; // Always return as Float32Array for consistency
}

/**
 * Loads and parses an EXR file from a URL.
 * The parser is configured to always output full 32-bit float data.
 *
 * @param url The URL of the .exr file.
 * @returns A promise that resolves to the parsed EXR data.
 */
export const loadEXR = async (url: string): Promise<LoadedEXRData> => {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch EXR file: ${response.statusText}`);
  }
  const buffer = await response.arrayBuffer();

  // The parseExr function is synchronous after the buffer is loaded.
  // We force FloatType to ensure the output data is a Float32Array.
  const exrData: EXRData = parseExr(buffer, FLOAT_TYPE);

  if (exrData.format !== RGBA_FORMAT) {
    // only supporting RGBA environment maps, (todo: more?)
    // The parser can output single-channel (RedFormat) data.
    throw new Error(
      "EXR loader currently only supports RGBA images for environment maps.",
    );
  }

  return {
    width: exrData.width,
    height: exrData.height,
    data: exrData.data as Float32Array, // We requested FloatType, so this cast is safe.
  };
};
