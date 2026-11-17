// Call it only after hydration; the prerender has no `navigator`.
export function hasWebGpu(): boolean {
  return "gpu" in navigator && window.isSecureContext;
}
