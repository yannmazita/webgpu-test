// src/loaders/hdrLoader.ts

export interface HDRData {
  width: number;
  height: number;
  data: Float32Array; // RGB float data
}

/**
 * Parses RGBE-encoded Radiance (.hdr) file data.
 * The core logic is adapted from the hdrpng.js library by Enki.
 * @param buffer The ArrayBuffer containing the .hdr file data.
 * @returns An object with the decoded float data, width, and height.
 */
function parseHDR(buffer: ArrayBuffer): HDRData {
  const bytes = new Uint8Array(buffer);
  let bytePos = 0;

  function readLine(): string {
    let line = "";
    while (bytePos < bytes.length) {
      const char = String.fromCharCode(bytes[bytePos++]);
      if (char === "\n") break;
      line += char;
    }
    return line;
  }

  // --- HEADER PARSING ---
  const signature = readLine();
  if (signature !== "#?RADIANCE") {
    throw new Error("Invalid HDR file signature");
  }

  let line = readLine();
  while (line.length > 0) {
    // Skip comments and empty lines
    if (line.charAt(0) === "#" || line.trim().length === 0) {
      line = readLine();
      continue;
    }
    // Check for format, only RGBE is supported
    if (line.startsWith("FORMAT=")) {
      const format = line.substring(7);
      if (format !== "32-bit_rle_rgbe") {
        throw new Error(`Unsupported HDR format: ${format}`);
      }
    }
    // Other header lines like EXPOSURE, etc., are ignored for now
    line = readLine();
  }

  // --- RESOLUTION STRING ---
  const resolution = readLine();
  const parts = resolution.split(" ");
  if (parts.length !== 4 || parts[0] !== "-Y" || parts[2] !== "+X") {
    throw new Error("Invalid HDR resolution string");
  }
  const height = parseInt(parts[1], 10);
  const width = parseInt(parts[3], 10);

  // --- DECODE RLE DATA ---
  const rgbe = new Uint8Array(width * height * 4);
  let rgbePos = 0;

  for (let j = 0; j < height; j++) {
    const scanlineHeader = bytes.slice(bytePos, (bytePos += 4));

    if (
      scanlineHeader[0] !== 2 ||
      scanlineHeader[1] !== 2 ||
      (scanlineHeader[2] & 0x80) !== 0
    ) {
      // Not RLE, should be raw scanline data (not implemented)
      // For simplicity, we assume RLE, which is overwhelmingly common.
      // Rewind and parse as uncompressed if needed.
      bytePos -= 4;
      for (let i = 0; i < width * 4; i++) {
        rgbe[rgbePos++] = bytes[bytePos++];
      }
      continue;
    }

    if (((scanlineHeader[2] << 8) | scanlineHeader[3]) !== width) {
      throw new Error("Scanline width mismatch in HDR file");
    }

    const channels: Uint8Array[] = [
      new Uint8Array(width),
      new Uint8Array(width),
      new Uint8Array(width),
      new Uint8Array(width),
    ];

    for (let c = 0; c < 4; c++) {
      let pixel = 0;
      while (pixel < width) {
        const count = bytes[bytePos++];
        if (count > 128) {
          // Run
          const runLength = count - 128;
          const value = bytes[bytePos++];
          for (let i = 0; i < runLength; i++) {
            channels[c][pixel++] = value;
          }
        } else {
          // Non-run
          const readLength = count;
          for (let i = 0; i < readLength; i++) {
            channels[c][pixel++] = bytes[bytePos++];
          }
        }
      }
    }

    // Interleave channels
    for (let i = 0; i < width; i++) {
      rgbe[rgbePos++] = channels[0][i]; // R
      rgbe[rgbePos++] = channels[1][i]; // G
      rgbe[rgbePos++] = channels[2][i]; // B
      rgbe[rgbePos++] = channels[3][i]; // E
    }
  }

  // --- CONVERT RGBE TO FLOAT32 ---
  const data = new Float32Array(width * height * 3);
  for (let i = 0; i < width * height; i++) {
    const e = rgbe[i * 4 + 3];
    const scale = Math.pow(2.0, e - 128.0) / 255.0;
    data[i * 3] = rgbe[i * 4] * scale;
    data[i * 3 + 1] = rgbe[i * 4 + 1] * scale;
    data[i * 3 + 2] = rgbe[i * 4 + 2] * scale;
  }

  return { width, height, data };
}

/**
 * Fetches and parses a Radiance (.hdr) file.
 * @param url The URL of the .hdr file.
 * @returns A promise that resolves to an object containing the image data.
 */
export async function loadHDR(url: string): Promise<HDRData> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to load HDR file: ${response.statusText}`);
  }
  const buffer = await response.arrayBuffer();
  return parseHDR(buffer);
}
