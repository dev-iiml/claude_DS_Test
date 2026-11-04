import type { ProviderHealth } from "../types";
import type { FileScanProvider } from "./types";

/** EICAR test signature: the one input the mock rejects, so the rejection path can be tested. */
const EICAR = "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*";

export class MockFileScanProvider implements FileScanProvider {
  readonly descriptor = { key: "mock", kind: "file_scan", mode: "mock" } as const;

  async health(): Promise<ProviderHealth> {
    return { status: "ok", checkedAt: new Date(0) };
  }

  async scan(input: { bytes: Uint8Array; contentType: string }) {
    const text = new TextDecoder("latin1").decode(input.bytes.slice(0, 4096));
    return { verdict: text.includes(EICAR) ? ("rejected" as const) : ("clean" as const) };
  }
}
