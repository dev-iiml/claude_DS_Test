import type { Provider } from "../types";

/** Malware / content scanning for uploaded documents (bought, not built). */
export interface FileScanProvider extends Provider {
  scan(input: { bytes: Uint8Array; contentType: string }): Promise<{ verdict: "clean" | "rejected" }>;
}
