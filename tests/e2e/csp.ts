import type { Page } from "@playwright/test";

export interface CspViolation {
  directive: string;
  blockedUri: string;
  documentUri: string;
}

declare global {
  interface Window {
    __cspViolations?: CspViolation[];
  }
}

// Console scraping is unreliable across browsers and log levels. The
// securitypolicyviolation event is the specified signal and fires with no network.
export async function collectCspViolations(page: Page): Promise<void> {
  await page.addInitScript(() => {
    window.__cspViolations = [];
    document.addEventListener("securitypolicyviolation", (event) => {
      window.__cspViolations?.push({
        directive: event.effectiveDirective || event.violatedDirective,
        blockedUri: event.blockedURI,
        documentUri: event.documentURI,
      });
    });
  });
}

export async function cspViolations(page: Page): Promise<CspViolation[]> {
  return page.evaluate(() => window.__cspViolations ?? []);
}

// Asked of the browser, not inferred from the header. CSP is enforced before the fetch,
// so the request need not succeed and this holds offline.
export async function scriptIsBlocked(page: Page, src: string): Promise<boolean> {
  return page.evaluate(async (url) => {
    return await new Promise<boolean>((resolve) => {
      let blocked = false;
      const onViolation = (event: SecurityPolicyViolationEvent) => {
        if (
          (event.effectiveDirective || event.violatedDirective).startsWith("script-src") &&
          url.startsWith(event.blockedURI)
        ) {
          blocked = true;
        }
      };
      document.addEventListener("securitypolicyviolation", onViolation);

      const script = document.createElement("script");
      script.src = url;
      const finish = () => {
        document.removeEventListener("securitypolicyviolation", onViolation);
        script.remove();
        resolve(blocked);
      };
      // Either outcome settles it: a CSP block fires the violation event
      // synchronously and then `error`, and an allowed-but-unreachable URL
      // fires `error` with no violation recorded.
      script.addEventListener("load", finish);
      script.addEventListener("error", finish);
      document.head.appendChild(script);
      setTimeout(finish, 5000);
    });
  }, src);
}
