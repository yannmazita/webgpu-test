// scripts/download-basis.ts

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// structure for the files we need to download
interface FileToDownload {
  url: string;
  fileName: string;
}

// Configuration
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEST_DIR = path.resolve(__dirname, "../public");

const FILES_TO_DOWNLOAD: FileToDownload[] = [
  {
    url: "https://raw.githubusercontent.com/BinomialLLC/basis_universal/master/webgl/transcoder/build/basis_transcoder.js",
    fileName: "basis_transcoder.js",
  },
  {
    url: "https://raw.githubusercontent.com/BinomialLLC/basis_universal/master/webgl/transcoder/build/basis_transcoder.wasm",
    fileName: "basis_transcoder.wasm",
  },
];
// --------------------

/**
 * Downloads a file from a URL to a specified destination path.
 * Skips the download if the file already exists.
 * @param url The URL to download from.
 * @param destPath The local file name for the destination.
 */
async function downloadFile(url: string, destPath: string): Promise<void> {
  const finalDest = path.join(DEST_DIR, destPath);

  if (fs.existsSync(finalDest)) {
    console.log(`[BASIS-DOWNLOAD] File already exists: ${destPath}. Skipping.`);
    return;
  }

  console.log(`[BASIS-DOWNLOAD] Downloading ${url} to ${finalDest}...`);
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to download ${url}: ${response.statusText}`);
    }
    if (!response.body) {
      throw new Error(`Response body is null for ${url}`);
    }

    const fileStream = fs.createWriteStream(finalDest);
    // Use the DOM stream Readable and pipeTo to connect to the Node.js Writable stream
    await response.body.pipeTo(
      new WritableStream({
        write(chunk) {
          fileStream.write(chunk);
        },
        close() {
          fileStream.end();
        },
        abort(err) {
          fileStream.destroy(err);
        },
      }),
    );

    console.log(`[BASIS-DOWNLOAD] Successfully downloaded ${destPath}.`);
  } catch (error) {
    console.error(`[BASIS-DOWNLOAD] Error downloading ${url}:`, error);
    // Clean up partially downloaded file on error
    if (fs.existsSync(finalDest)) {
      fs.unlinkSync(finalDest);
    }
    throw error; // Propagate error to stop the install process
  }
}

/**
 * Main function to orchestrate the download process.
 */
async function main(): Promise<void> {
  // Ensure the destination directory exists
  if (!fs.existsSync(DEST_DIR)) {
    console.log(`[BASIS-DOWNLOAD] Creating destination directory: ${DEST_DIR}`);
    fs.mkdirSync(DEST_DIR, { recursive: true });
  }

  try {
    await Promise.all(
      FILES_TO_DOWNLOAD.map((file) => downloadFile(file.url, file.fileName)),
    );
    console.log("[BASIS-DOWNLOAD] All Basis Universal files are ready.");
  } catch (error) {
    console.error(
      "\n[BASIS-DOWNLOAD] Failed to download Basis Universal files. Please check your network connection and try 'npm install' again.",
    );
    process.exit(1); // Exit with an error code
  }
}

// Execute the main function
main();
