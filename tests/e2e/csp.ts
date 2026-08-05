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

/**
 * Records every Content-Security-Policy violation the browser reports on this
 * page, from before the first byte of application code runs.
 *
 * Console scraping is not good enough here: a blocked subresource is reported
 * differently across browsers and log levels, and a test that greps stderr
 * quietly stops catching anything the day the wording changes. The
 * `securitypolicyviolation` event is the specified signal and fires whether
 * or not the request would have reached the network, so these assertions hold
 * in CI with no outbound access.
 */
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
  return (await page.evaluate(() => window.__cspViolations ?? [])) as CspViolation[];
}

/**
 * Whether the page's policy would block loading `src` as a script, asked of
 * the browser rather than inferred by parsing the header ourselves.
 *
 * The element is appended and the answer read from the violation event, so
 * the request never has to succeed: CSP is enforced before the fetch, which
 * keeps this deterministic offline.
 */
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
