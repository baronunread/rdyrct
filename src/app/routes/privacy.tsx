// fallow-ignore-file code-duplication -- legal sections share structural patterns
import { SUPPORT_EMAIL } from "../ui/footer";
import { LegalPageLayout } from "../ui/misc";

export function PrivacyPage() {
  return (
    <LegalPageLayout>
      <div>
        <h1 className="mb-2 text-xl font-bold">Privacy Policy</h1>
        <p className="text-muted">
          This policy explains what data rdyrct collects, why, the legal basis for it, and how you
          can exercise your rights. Last updated 19 July 2026.
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
          settings you create. For click analytics we store only an approximate country, the
          referrer host, device type, and a timestamp for each click. We explicitly do{" "}
          <span className="text-text">not</span> store your IP address, precise location, or any
          data that would allow cross-site tracking.
        </p>
      </section>

      <section>
        <h2 className="mb-2 font-bold">Why we process it (legal basis)</h2>
        <p className="text-muted">
          Under the GDPR, we process account and organization data to provide the service you sign
          up for (performance of a contract), send transactional email such as verification codes
          and team invites (contract), and produce privacy-preserving click analytics for your own
          links (our legitimate interest in offering a useful product). The session cookie is
          strictly necessary and requires no consent.
        </p>
      </section>

      <section>
        <h2 className="mb-2 font-bold">Cookies</h2>
        <p className="text-muted">
          rdyrct uses a single strictly-necessary session cookie to keep you signed in. We do not
          use advertising or tracking cookies of any kind.
        </p>
      </section>

      <section>
        <h2 className="mb-2 font-bold">Sub-processors</h2>
        <p className="text-muted">
          We rely on a small number of sub-processors to run the service: Cloudflare (hosting, the
          D1 database, and KV storage), Resend (transactional email), and Polar (billing, acting as
          merchant of record). Some may process data outside the EU/EEA; where they do, transfers
          are covered by the appropriate safeguards, such as the EU Standard Contractual Clauses.
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
