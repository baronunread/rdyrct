/**
 * What changed, release by release.
 *
 * Rendered from CHANGELOG.md (see lib/changelog.ts) so the file a self-hoster
 * reads on GitHub and this page cannot disagree. Identifiers in the text
 * (environment variables, paths) take the mono face, per the type rule.
 */
import { MarketingPage } from "../components/marketing-page";
import { GITHUB_URL } from "../ui/footer";
import { inlinePieces, parseChangelog } from "../lib/changelog";
import changelogSource from "../../../CHANGELOG.md?raw";

const RELEASES = parseChangelog(changelogSource);

function Inline({ text }: { text: string }) {
  return inlinePieces(text).map((piece, i) =>
    piece.kind === "bold" ? (
      <strong key={i} className="font-semibold text-text">
        {piece.text}
      </strong>
    ) : piece.kind === "code" ? (
      <span key={i} className="font-mono text-[0.9em] text-text">
        {piece.text}
      </span>
    ) : (
      piece.text
    ),
  );
}

// main.tsx names this export as a string, for lazyRouteComponent, which
// static analysis can't follow.
// fallow-ignore-next-line unused-export
export function ChangelogPage() {
  return (
    <MarketingPage
      path="/changelog"
      title="Changelog"
      intro={
        <>
          What changed in each release of rdyrct. Every change is a pull request you can read on{" "}
          <a href={`${GITHUB_URL}/pulls?q=is%3Apr+is%3Amerged`} className="text-accent">
            GitHub
          </a>
          .
        </>
      }
    >
      {RELEASES.map((release) => (
        <section key={release.version} className="mx-auto max-w-3xl border-t border-border py-12">
          <h2 className="text-2xl font-bold tracking-tight">{release.version}</h2>
          {release.intro.map((paragraph) => (
            <p key={paragraph} className="mt-3 text-muted">
              <Inline text={paragraph} />
            </p>
          ))}
          {release.sections.map((section) => (
            <div key={section.title} className="mt-8">
              {section.title && <h3 className="font-bold">{section.title}</h3>}
              <ul className="mt-3 flex list-disc flex-col gap-2 pl-5 text-muted marker:text-accent">
                {section.items.map((item) => (
                  <li key={item}>
                    <Inline text={item} />
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </section>
      ))}
    </MarketingPage>
  );
}
