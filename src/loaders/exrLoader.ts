import parseExr from "./exr-parser.js";

const HALF_FLOAT_TYPE = 1016; // Corresponds to HalfFloatType in the parser

export interface EXRData {
  header: object;
  width: number;
  height: number;
  data: Uint16Array; // We will always request half-float data
  format: number; // e.g., RGBAFormat = 1023
  colorSpace: string;
}

/**
 * Loads and parses an EXR file into a half-float data texture.
 *
 * @param url The URL of the .exr file.
 * @returns A promise that resolves to the parsed EXR data.
 */
export const loadEXR = async (url: string): Promise<EXRData> => {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch EXR file: ${url}`);
  }
  const buffer = await response.arrayBuffer();
  const exrData = parseExr(buffer, HALF_FLOAT_TYPE);
  console.log(exrData);

  // The parser returns a generic object, so we cast it to our interface.
  // The 'data' property will be a Uint16Array because we passed HALF_FLOAT_TYPE.
  return exrData as EXRData;
};
