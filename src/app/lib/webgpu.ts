/** Whether this browser exposes WebGPU at all. Decides whether the landing
 *  page's GPU effects (lib/hero-gpu.ts) are even downloaded: without it the
 *  page shows without them, and TypeGPU never loads. Call it only after
 *  hydration; the prerender has no `navigator`. */
export function hasWebGpu(): boolean {
  return "gpu" in navigator && window.isSecureContext;
}
