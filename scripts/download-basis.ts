// scripts/download-basis.ts
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

interface FileToDownload {
  url: string;
  fileName: string;
  destinationDir: string;
}

// --- Configuration ---
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.resolve(__dirname, "../public");
const VENDOR_DIR = path.resolve(__dirname, "../src/vendor");

const FILES_TO_DOWNLOAD: FileToDownload[] = [
  {
    url: "https://raw.githubusercontent.com/BinomialLLC/basis_universal/master/webgl/transcoder/build/basis_transcoder.js",
    fileName: "basis_transcoder.js",
    destinationDir: VENDOR_DIR,
  },
  {
    url: "https://raw.githubusercontent.com/BinomialLLC/basis_universal/master/webgl/transcoder/build/basis_transcoder.wasm",
    fileName: "basis_transcoder.wasm",
    destinationDir: PUBLIC_DIR,
  },
];
// --------------------

/**
 * Downloads a file from a URL to a local destination.
 *
 * @remarks
 * This function is idempotent: it checks if the destination file already
 * exists before initiating a download. If the file is present, the
 * operation completes successfully without re-downloading. The destination
 * directory will be created recursively if it does not exist.
 *
 * @param url - The source URL of the file to download.
 * @param destDir - The absolute path to the local directory where the file
 *     will be saved.
 * @param fileName - The name to give the saved file.
 * @returns A promise that resolves when the file is successfully downloaded
 *     and saved, or if it already existed.
 * @throws If the download fails due to a network error, or if there
 *     is an error writing the file to the filesystem.
 */
async function downloadFile(
  url: string,
  destDir: string,
  fileName: string,
): Promise<void> {
  const finalDest = path.join(destDir, fileName);

  if (fs.existsSync(finalDest)) {
    console.log(`[BASIS-DOWNLOAD] File already exists: ${fileName}. Skipping.`);
    return;
  }

  console.log(`[BASIS-DOWNLOAD] Downloading ${url} to ${finalDest}...`);
  try {
    // Ensure the destination directory exists
    if (!fs.existsSync(destDir)) {
      console.log(
        `[BASIS-DOWNLOAD] Creating destination directory: ${destDir}`,
      );
      fs.mkdirSync(destDir, { recursive: true });
    }

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to download ${url}: ${response.statusText}`);
    }
    if (!response.body) {
      throw new Error(`Response body is null for ${url}`);
    }

    const fileStream = fs.createWriteStream(finalDest);
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

    console.log(`[BASIS-DOWNLOAD] Successfully downloaded ${fileName}.`);
  } catch (error) {
    console.error(`[BASIS-DOWNLOAD] Error downloading ${url}:`, error);
    if (fs.existsSync(finalDest)) {
      fs.unlinkSync(finalDest);
    }
    throw error;
  }
}

async function main(): Promise<void> {
  try {
    await Promise.all(
      FILES_TO_DOWNLOAD.map((file) =>
        downloadFile(file.url, file.destinationDir, file.fileName),
      ),
    );
    console.log("[BASIS-DOWNLOAD] All Basis Universal files are ready.");
  } catch (error) {
    console.error(
      "\n[BASIS-DOWNLOAD] Failed to download Basis Universal files. Please check your network connection and try 'npm install' again.",
    );
    process.exit(1);
  }
}

main();
