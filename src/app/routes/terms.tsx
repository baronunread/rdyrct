// fallow-ignore-file code-duplication -- legal sections share structural patterns
import { SUPPORT_EMAIL, GITHUB_URL } from "../ui/footer";
import { LegalPageLayout } from "../components/legal-page-layout";
import { WebMcpMarketingTools } from "../components/webmcp-marketing-tools";
import { useSeo } from "../lib/seo";
import { useMarketingScroll } from "../lib/marketing-scroll";
import { useAudience } from "../lib/audience";
import { PLAN_LIMITS } from "@/shared/types";
import { exactCount } from "@/shared/click-usage";

// main.tsx names this export as a string, for lazyRouteComponent, which
// static analysis can't follow.
// fallow-ignore-next-line unused-export
export function TermsPage() {
  const { authed } = useAudience();
  useSeo("/terms");
  useMarketingScroll();
  return (
    <LegalPageLayout
      authed={authed}
      title="Terms of service"
      intro="These terms govern your use of rdyrct. By creating an account or using the service, you agree to them. Last updated 25 October 2026."
    >
      <WebMcpMarketingTools />

      <section>
        <h2 className="mb-2 font-bold">Acceptance of terms</h2>
        <p className="text-muted">
          By accessing or using rdyrct, you agree to be bound by these terms. If you do not agree,
          do not use the service.
        </p>
      </section>

      <section>
        <h2 className="mb-2 font-bold">Acceptable use</h2>
        <p className="text-muted">
          You may not use rdyrct to create links that are illegal, malicious, or used for phishing,
          malware distribution, spam, or other abusive purposes, or links that imitate another brand
          to collect payments or credentials. We reserve the right to disable any link or account
          that violates this policy.
        </p>
        <p className="mt-2 text-muted">
          We may pause links we have reason to think break this rule. A pause is not a verdict: we
          tell the owner why, and restore the links if we were wrong. We may also block a
          destination host from being linked, and when we ban an account we suspend the
          organizations it owns.
        </p>
      </section>

      <section>
        <h2 className="mb-2 font-bold">Reporting abuse and appeals</h2>
        <p className="text-muted">
          To report a link, use the{" "}
          <a href="/report" className="text-accent hover:underline">
            report form
          </a>
          . We review reports and act on the ones that break these terms. A report alone never
          suspends a link. On the free plan it shows visitors a warning first, and the link keeps
          working. When we pause or suspend your links we email you the reason. To appeal, write to{" "}
          <a href={`mailto:${SUPPORT_EMAIL}`} className="text-accent hover:underline">
            {SUPPORT_EMAIL}
          </a>{" "}
          with the name of your organization and what the link is for, and we will look at it as
          soon as we can.
        </p>
      </section>

      <section>
        <h2 className="mb-2 font-bold">Accounts & organizations</h2>
        <p className="text-muted">
          You are responsible for maintaining the security of your account and for activity that
          happens under organizations you own or administer. Organization owners are responsible for
          the actions of their members.
        </p>
      </section>

      <section>
        <h2 className="mb-2 font-bold">Plans & billing</h2>
        <p className="text-muted">
          Paid plans are billed through Polar, our merchant of record. Subscriptions renew
          automatically until cancelled, and you can manage or cancel your plan at any time from
          Billing. rdyrct is also open source under the MIT license; you may self-host it from the{" "}
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noreferrer"
            className="text-accent hover:underline"
          >
            public repository
          </a>
          , in which case these hosted-service terms do not apply and support is provided on a
          best-effort basis through GitHub issues only.
        </p>
        <p className="mt-2 text-muted">
          Links keep redirecting however many clicks they get. Each plan records a set number of
          clicks a month for each organization ({exactCount(PLAN_LIMITS.free.trackedClicks)} on
          Free, {exactCount(PLAN_LIMITS.hobby.trackedClicks)} on Hobby,{" "}
          {exactCount(PLAN_LIMITS.pro.trackedClicks)} on Pro). Past that, the rest of that month's
          clicks are not recorded for analytics; the links themselves keep working.
        </p>
      </section>

      <section>
        <h2 className="mb-2 font-bold">Service provided "as is"</h2>
        <p className="text-muted">
          rdyrct is provided "as is" and "as available," without warranties of any kind. To the
          maximum extent permitted by law, we are not liable for indirect, incidental, or
          consequential damages arising from your use of the service.
        </p>
      </section>

      <section>
        <h2 className="mb-2 font-bold">Termination</h2>
        <p className="text-muted">
          You may stop using rdyrct and delete your account at any time. We may suspend or terminate
          access to accounts that violate these terms.
        </p>
      </section>

      <section>
        <h2 className="mb-2 font-bold">Governing law</h2>
        <p className="text-muted">
          These terms are governed by the laws of Italy, without regard to conflict-of-law rules.
          Nothing here limits any mandatory consumer rights you may have under the law of your
          country of residence.
        </p>
      </section>

      <section>
        <h2 className="mb-2 font-bold">Changes to these terms</h2>
        <p className="text-muted">
          We may update these terms from time to time. Continued use of rdyrct after changes take
          effect constitutes acceptance of the revised terms.
        </p>
      </section>

      <section>
        <h2 className="mb-2 font-bold">Contact</h2>
        <p className="text-muted">
          Questions about these terms can be sent to{" "}
          <a href={`mailto:${SUPPORT_EMAIL}`} className="text-accent hover:underline">
            {SUPPORT_EMAIL}
          </a>
          .
        </p>
      </section>
    </LegalPageLayout>
  );
}
