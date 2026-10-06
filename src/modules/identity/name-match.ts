/** Case/space-insensitive name comparison (pure; safe for client components). */
export function namesMatch(a: string, b: string): boolean {
  const n = (s: string) => s.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
  return n(a) === n(b);
}
