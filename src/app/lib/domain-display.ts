export function displayUrl(url: string): string {
  return url.replace(/^https?:\/\//i, "").replace(/\/$/, "");
}

export function parentDomain(hostname: string): string {
  const labels = hostname.split(".");
  return labels.length > 2 ? labels.slice(1).join(".") : hostname;
}
