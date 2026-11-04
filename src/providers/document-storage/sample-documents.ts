/**
 * Fictional sample documents for the demo seed (dev and staging). Keys under
 * `bw/5eed…` are reserved for them; the bytes are a small generated PDF that
 * says it is a fictional sample — never a real invoice.
 */
export const SAMPLE_KEY_PREFIX = "bw/5eed";

export function sampleKey(n: number): string {
  return `${SAMPLE_KEY_PREFIX}${n.toString(16).padStart(28, "0")}`;
}

export const isSampleKey = (key: string) => key.startsWith(SAMPLE_KEY_PREFIX);

/** A minimal one-page PDF with a line of text. */
export function samplePdf(key: string): Uint8Array {
  const text = `FICTIONAL SAMPLE DOCUMENT - CreatorCo demo (${key.slice(-6)}). Not a real invoice.`;
  const stream = `BT /F1 12 Tf 48 760 Td (${text.replace(/[()\\]/g, "")}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let body = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((o, i) => {
    offsets.push(body.length);
    body += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) body += `${String(off).padStart(10, "0")} 00000 n \n`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(body);
}
