import { getDocument as pdfGetDocument, PasswordResponses } from "pdfjs-dist";
import { WorkerMessageHandler } from "pdfjs-dist/build/pdf.worker.mjs";

// Gadget frames cannot load worker scripts: they have an opaque origin, no network access, and
// execute saved client code from a data URL. Supplying PDF.js's worker handler here activates its
// supported in-process fallback without granting a new fetch or worker capability.
(globalThis as unknown as { pdfjsWorker?: unknown }).pdfjsWorker = { WorkerMessageHandler };

const MAX_LOCAL_PDF_BYTES = 32 * 1024 * 1024;

/** Narrow PDF surface for browser-local decryption and text layout; URL/network loading is denied. */
(globalThis as unknown as Record<string, unknown>).GadgetPDF = Object.freeze({
  getDocument(options: { data: Uint8Array; password?: string; disableFontFace?: boolean }) {
    if (!options || !(options.data instanceof Uint8Array) ||
        options.data.byteLength < 1 || options.data.byteLength > MAX_LOCAL_PDF_BYTES) {
      throw new TypeError("GadgetPDF requires bounded in-memory PDF bytes.");
    }
    if (options.password !== undefined && typeof options.password !== "string") {
      throw new TypeError("Invalid PDF password.");
    }
    return pdfGetDocument({
      data: options.data,
      password: options.password,
      disableFontFace: options.disableFontFace === true,
    });
  },
  PasswordResponses,
});
