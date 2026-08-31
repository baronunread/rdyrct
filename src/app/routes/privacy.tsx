// fallow-ignore-file code-duplication -- legal sections share structural patterns
import { SUPPORT_EMAIL } from "../ui/footer";
import { LegalPageLayout } from "../components/legal-page-layout";
import { WebMcpMarketingTools } from "../components/webmcp-marketing-tools";
import { useSeo } from "../lib/seo";
import { useMarketingScroll } from "../lib/marketing-scroll";
import { useAudience } from "../lib/audience";

// main.tsx names this export as a string, for lazyRouteComponent, which
// static analysis can't follow.
// fallow-ignore-next-line unused-export
export function PrivacyPage() {
  const { authed } = useAudience();
  useSeo("/privacy");
  useMarketingScroll();
  return (
    <LegalPageLayout authed={authed}>
      <WebMcpMarketingTools />
      <div>
        <h1 className="mb-2 text-xl font-bold">Privacy Policy</h1>
        <p className="text-muted">
          This policy explains what data rdyrct collects, why, the legal basis for it, and how you
          can exercise your rights. Last updated 25 August 2026.
        </p>
      </div>

      <section>
        <h2 className="mb-2 font-bold">Data controller</h2>
        <p className="text-muted">
          The data controller for rdyrct is <span className="text-text">Andrea Bruno</span>. For any
          privacy request or question, contact{" "}
          <a href={`mailto:${SUPPORT_EMAIL}`} className="text-accent hover:underline">
            {SUPPORT_EMAIL}
          </a>
          .
        </p>
      </section>

      <section>
        <h2 className="mb-2 font-bold">Data we collect</h2>
        <p className="text-muted">
          We collect your account email address and name, and the organizations, links, domains, and
          settings you create. For click analytics on your links we store only an approximate
          country, the referrer host, device type, and a timestamp for each click: we explicitly do{" "}
          <span className="text-text">not</span> store the IP address of the people who click your
          links, their precise location, or any data that would allow cross-site tracking.
          Separately, if you accept analytics in the cookie banner, we use PostHog to understand how
          the product itself is used: which features you use and app events such as signing in or
          creating a link, tied to your account email and name. We turn off autocapture and session
          recording, so PostHog never records what you type or a replay of your screen. Nothing is
          sent to PostHog, and no PostHog cookie is set, unless you accept. We also use Sentry to
          receive technical error reports from the app. These reports include technical diagnostic
          data such as the error, browser, and page path. We remove page query strings before
          sending them.
        </p>
      </section>

      <section>
        <h2 className="mb-2 font-bold">Why we process it (legal basis)</h2>
        <p className="text-muted">
          Under the GDPR, we process account and organization data to provide the service you sign
          up for (performance of a contract), send transactional email such as verification codes
          and team invites (contract), and produce click analytics for your own links (our
          legitimate interest in offering a useful product). The session cookie is strictly
          necessary and requires no consent. Product usage analytics through PostHog runs only on
          your consent, given or withdrawn at any time through the cookie banner. We process
          technical error reports through Sentry for our legitimate interest in keeping the service
          secure and reliable. Sentry does not set a cookie in rdyrct.
        </p>
      </section>

      {/* Addressable on its own. People (and the scanners that check for a
          site's cookie policy) look for a page about cookies, not a heading
          two thirds of the way down a privacy policy. This is that page's
          address; splitting it into a real second page would mean two
          documents saying the same thing and drifting apart. */}
      <section id="cookies" className="scroll-mt-16">
        <h2 className="mb-2 font-bold">Cookies</h2>
        <p className="text-muted">
          rdyrct sets a strictly-necessary session cookie to keep you signed in. If you accept
          analytics in the cookie banner, PostHog also sets a cookie to recognize you across visits;
          if you reject or ignore the banner, that cookie is never set. We do not use advertising
          cookies of any kind.
        </p>
      </section>

      <section>
        <h2 className="mb-2 font-bold">Sub-processors</h2>
        <p className="text-muted">
          We rely on a small number of sub-processors to run the service: Cloudflare (hosting, the
          D1 database, and KV storage), Resend (transactional email), Polar (billing, acting as
          merchant of record), PostHog, EU region (product usage analytics), and Sentry (technical
          error monitoring). Some may process data outside the EU/EEA; where they do, transfers are
          covered by the appropriate safeguards, such as the EU Standard Contractual Clauses.
        </p>
      </section>

      <section>
        <h2 className="mb-2 font-bold">Data retention</h2>
        <p className="text-muted">
          We retain account and organization data for as long as your account is active. Click
          analytics are kept only as long as needed to provide reporting, after which they are
          deleted or aggregated. Deleting your account (Settings → Delete account) removes your
          personal data within a reasonable period; billing records may be retained where required
          by law.
        </p>
      </section>

      <section>
        <h2 className="mb-2 font-bold">Your rights</h2>
        <p className="text-muted">
          You have the right to access, correct, export, or erase your data, to object to or
          restrict processing, and to withdraw consent where it applies. You can delete your account
          and its data yourself at any time from Settings, or contact us at{" "}
          <a href={`mailto:${SUPPORT_EMAIL}`} className="text-accent hover:underline">
            {SUPPORT_EMAIL}
          </a>
          . If you are in the EU you also have the right to lodge a complaint with a supervisory
          authority, in Italy, the Garante per la protezione dei dati personali.
        </p>
      </section>
    </LegalPageLayout>
  );
}
