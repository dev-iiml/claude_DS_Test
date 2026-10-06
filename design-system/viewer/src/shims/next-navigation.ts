export function usePathname(): string {
  return (globalThis as unknown as { __ccPathname?: string }).__ccPathname ?? "/dashboard";
}
export function useRouter() {
  return { push() {}, replace() {}, refresh() {}, back() {} };
}
export function useSearchParams() {
  return new URLSearchParams();
}
