/** better-auth checks the session before redirecting here, so this page can assume a signed-in person.
 * The query is a signed bundle: read it, never rebuild it, and hand it back as `oauth_query`. */
import { useQuery, useMutation } from "@tanstack/react-query";
import { errorMessage } from "@/app/lib/error-message";
import { lookup } from "@/shared/lookup";
import { useCurrentUser } from "../lib/hooks";
import { Button } from "../ui/button";
import { Spinner } from "../ui/spinner";
import { useToast } from "../ui/toast";
import { Logo } from "../ui/logo";

interface PublicClient {
  client_id: string;
  client_name?: string;
  client_uri?: string;
  logo_uri?: string;
}

const SCOPE_LABELS = {
  openid: "Confirm your identity",
  profile: "Read your name",
  email: "Read your email address",
  offline_access: "Stay connected after this session ends",
} satisfies Record<string, string>;

/** Reads the raw query string, not the router's `searchStr`: re-serializing changes `+` vs `%20` and param order,
 * and better-auth's signature check rejects that. */
function useOAuthQuery() {
  const search = window.location.search;
  const params = new URLSearchParams(search);
  return {
    raw: search.startsWith("?") ? search.slice(1) : search,
    clientId: params.get("client_id") ?? "",
    scopes: (params.get("scope") ?? "").split(" ").filter(Boolean),
    redirectHost: hostOf(params.get("redirect_uri")),
  };
}

/** An anonymously registered client chooses its own name, so "Claude wants access" proves nothing; where the redirect goes does. */
function hostOf(uri: string | null): string | null {
  if (!uri) return null;
  try {
    return new URL(uri).host || null;
  } catch {
    return null;
  }
}

async function respond(oauthQuery: string, accept: boolean): Promise<string> {
  const res = await fetch("/api/auth/oauth2/consent", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ accept, oauth_query: oauthQuery }),
  });
  // SAFETY: better-auth's own oauth2/consent response shape, per its docs
  // (a redirect url on success, error_description on failure).
  const body = (await res.json()) as { url?: string; error_description?: string };
  if (!res.ok || !body.url)
    throw new Error(body.error_description ?? "Could not respond to the request.");
  return body.url;
}

function ConsentDetails({
  clientName,
  email,
  scopes,
  redirectHost,
  onDecide,
  deciding,
}: {
  clientName: string;
  email: string | undefined;
  scopes: string[];
  redirectHost: string | null;
  onDecide: (accept: boolean) => void;
  deciding: boolean;
}) {
  return (
    <>
      <p className="text-sm">
        <span className="font-bold text-accent">{clientName}</span> wants access to your rdyrct
        account
        {email && (
          <>
            {" "}
            (<span className="font-mono text-xs">{email}</span>)
          </>
        )}
        .
      </p>
      {redirectHost && (
        <p className="mt-2 text-xs text-muted">
          Your answer goes to <span className="font-mono text-text">{redirectHost}</span>.
        </p>
      )}

      {scopes.length > 0 && (
        <>
          <p className="mt-4 text-left text-xs text-muted">This will let it:</p>
          <ul className="mt-1.5 flex flex-col gap-1.5 text-left text-sm text-muted">
            {scopes.map((scope) => (
              <li key={scope} className="flex items-center gap-2">
                <span className="h-1 w-1 shrink-0 rounded-full bg-muted" />
                {lookup(SCOPE_LABELS, scope) ?? scope}
              </li>
            ))}
          </ul>
        </>
      )}

      <p className="mt-4 text-xs text-muted">
        <span className="font-bold text-text">Full account access:</span> it can call the API and
        MCP tools as you, the same as a scoped API key. Revoke it anytime from the API page's MCP
        tab.
      </p>

      <div className="mt-5 flex flex-col gap-2">
        <Button variant="primary" onClick={() => onDecide(true)} disabled={deciding}>
          Allow
        </Button>
        <Button variant="outline" onClick={() => onDecide(false)} disabled={deciding}>
          Deny
        </Button>
      </div>
    </>
  );
}

export function ConsentPage() {
  const toast = useToast();
  const currentUser = useCurrentUser();
  const { raw, clientId, scopes, redirectHost } = useOAuthQuery();

  const client = useQuery<PublicClient>({
    queryKey: ["oauth-client", clientId],
    queryFn: async () => {
      const res = await fetch(
        `/api/auth/oauth2/public-client?client_id=${encodeURIComponent(clientId)}`,
      );
      if (!res.ok) throw new Error("This connection request is invalid or has expired.");
      return res.json();
    },
    enabled: !!clientId,
    retry: false,
  });

  const decide = useMutation({
    mutationFn: (accept: boolean) => respond(raw, accept),
    onSuccess: (url) => window.location.assign(url),
    onError: (e) => toast(errorMessage(e), "error"),
  });

  const loading = currentUser.isLoading || client.isLoading;

  return (
    <div className="grid min-h-dvh place-items-center px-4">
      <div className="w-full max-w-sm rounded-xl bg-surface p-6 text-center smooth-shadow-ring-sm">
        <p className="mb-4 text-xl">
          <Logo />
        </p>

        {loading ? (
          <Spinner className="mx-auto" />
        ) : client.isError ? (
          <p className="text-sm text-muted">{errorMessage(client.error)}</p>
        ) : (
          <ConsentDetails
            clientName={client.data?.client_name || clientId}
            email={currentUser.data?.user.email}
            scopes={scopes}
            redirectHost={redirectHost}
            onDecide={(accept) => decide.mutate(accept)}
            deciding={decide.isPending}
          />
        )}
      </div>
    </div>
  );
}
