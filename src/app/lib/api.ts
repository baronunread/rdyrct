export class ApiError extends Error {
  status: number;
  /** machine-readable code from the error body, e.g. "slug_taken" */
  code?: string;
  constructor(status: number, message: string, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export async function api<T>(
  path: string,
  init?: Omit<RequestInit, "body"> & { body?: unknown },
): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: {
      ...(init?.body !== undefined ? { "content-type": "application/json" } : {}),
      ...init?.headers,
    },
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  if (!res.ok) {
    let message = res.statusText;
    let code: string | undefined;
    try {
      const data = (await res.json()) as { message?: string; code?: string };
      if (data.message) message = data.message;
      code = data.code;
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(res.status, message, code);
  }
  return res.json() as Promise<T>;
}

export const shortUrl = (slug: string, domain?: string | null) =>
  domain ? `https://${domain}/${slug}` : `${window.location.origin}/${slug}`;
