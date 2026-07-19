import { Link } from "react-router";
import { Footer, SUPPORT_EMAIL, GITHUB_URL } from "../ui/footer";

export function TermsPage() {
  return (
    <div className="mx-auto max-w-3xl px-6 py-12">
      <header className="mb-8">
        <Link to="/" className="text-lg font-bold tracking-widest">
          rdyrct
        </Link>
      </header>

      <div className="flex flex-col gap-8 text-sm">
        <div>
          <h1 className="mb-2 text-xl font-bold">Terms of Service</h1>
          <p className="text-muted">
            These terms govern your use of rdyrct. By creating an account or
            using the service, you agree to them. Last updated 19 July 2026.
          </p>
        </div>

        <section>
          <h2 className="mb-2 font-bold">Acceptance of terms</h2>
          <p className="text-muted">
            By accessing or using rdyrct, you agree to be bound by these terms.
            If you do not agree, do not use the service.
          </p>
        </section>

        <section>
          <h2 className="mb-2 font-bold">Acceptable use</h2>
          <p className="text-muted">
            You may not use rdyrct to create links that are illegal, malicious,
            or used for phishing, malware distribution, spam, or other abusive
            purposes. We reserve the right to disable any link or account that
            violates this policy.
          </p>
        </section>

        <section>
          <h2 className="mb-2 font-bold">Accounts & organizations</h2>
          <p className="text-muted">
            You are responsible for maintaining the security of your account and
            for activity that happens under organizations you own or administer.
            Organization owners are responsible for the actions of their
            members.
          </p>
        </section>

        <section>
          <h2 className="mb-2 font-bold">Plans & billing</h2>
          <p className="text-muted">
            Paid plans are billed through Polar, our merchant of record.
            Subscriptions renew automatically until cancelled, and you can manage
            or cancel your plan at any time from Billing. rdyrct is also open
            source under the MIT license; you may self-host it from the{" "}
            <a
              href={GITHUB_URL}
              target="_blank"
              rel="noreferrer"
              className="text-accent hover:underline"
            >
              public repository
            </a>
            , in which case these hosted-service terms do not apply and support
            is provided on a best-effort basis through GitHub issues only.
          </p>
        </section>

        <section>
          <h2 className="mb-2 font-bold">Service provided "as is"</h2>
          <p className="text-muted">
            rdyrct is provided "as is" and "as available," without warranties of
            any kind. To the maximum extent permitted by law, we are not liable
            for indirect, incidental, or consequential damages arising from your
            use of the service.
          </p>
        </section>

        <section>
          <h2 className="mb-2 font-bold">Termination</h2>
          <p className="text-muted">
            You may stop using rdyrct and delete your account at any time. We
            may suspend or terminate access to accounts that violate these terms.
          </p>
        </section>

        <section>
          <h2 className="mb-2 font-bold">Governing law</h2>
          <p className="text-muted">
            These terms are governed by the laws of Italy, without regard to
            conflict-of-law rules. Nothing here limits any mandatory consumer
            rights you may have under the law of your country of residence.
          </p>
        </section>

        <section>
          <h2 className="mb-2 font-bold">Changes to these terms</h2>
          <p className="text-muted">
            We may update these terms from time to time. Continued use of rdyrct
            after changes take effect constitutes acceptance of the revised
            terms.
          </p>
        </section>

        <section>
          <h2 className="mb-2 font-bold">Contact</h2>
          <p className="text-muted">
            Questions about these terms can be sent to{" "}
            <a
              href={`mailto:${SUPPORT_EMAIL}`}
              className="text-accent hover:underline"
            >
              {SUPPORT_EMAIL}
            </a>
            .
          </p>
        </section>
      </div>

      <Footer />
    </div>
  );
}
