/**
 * OAuth consent (#139 follow-up): where the mcp() plugin's own authorize
 * endpoint sends a signed-in visitor. better-auth checks the session itself
 * before ever redirecting here (unauthenticated goes to loginPage instead),
 * so this page can assume it is always talking to a signed-in person — it
 * only has to show who is asking and for what, then relay the answer.
 *
 * The query string is a signed, opaque bundle (client_id, scope, resource,
 * a signature, an expiry): read from it, never rebuilt by hand, and handed
 * straight back as `oauth_query` on accept or deny. Tampering with it (or
 * letting it go stale) is the API's problem, not this page's: a bad or
 * expired bundle comes back as a plain error from /oauth2/consent.
 */
import { useQuery, useMutation } from "@tanstack/react-query";
import { errorMessage } from "@/app/lib/error-message";
import { lookup } from "@/shared/lookup";
import { useCurrentUser } from "../lib/hooks";
import { Button } from "../ui/button";
import { Spinner } from "../ui/spinner";
import { useToast } from "../ui/toast";

interface PublicClient {
  client_id: string;
  client_name?: string;
  client_uri?: string;
  logo_uri?: string;
}

const SCOPE_LABELS = {
  openid: "Confirm who you are",
  profile: "Your name",
  email: "Your email address",
  offline_access: "Stay connected when you're not using it",
} satisfies Record<string, string>;

/**
 * Reads the raw query string, not TanStack Router's `searchStr`: the router
 * parses and re-serializes it, which does not preserve byte-for-byte
 * encoding (`+` vs `%20`, param order). better-auth's signature check does
 * care about that, and a re-encoded bundle fails it with a plain 400 — the
 * exact string the browser navigated to is the only one it will accept back.
 */
function useOAuthQuery() {
  const search = window.location.search;
  const params = new URLSearchParams(search);
  return {
    raw: search.startsWith("?") ? search.slice(1) : search,
    clientId: params.get("client_id") ?? "",
    scopes: (params.get("scope") ?? "").split(" ").filter(Boolean),
  };
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

/** The request itself: who's asking, what for, and the Allow/Deny pair.
 * Split from ConsentPage so that component only has to decide which of
 * loading/error/this to show. */
function ConsentDetails({
  clientName,
  email,
  scopes,
  onDecide,
  deciding,
}: {
  clientName: string;
  email: string | undefined;
  scopes: string[];
  onDecide: (accept: boolean) => void;
  deciding: boolean;
}) {
  return (
    <>
      <p className="text-sm">
        <span className="font-bold text-accent">{clientName}</span> wants to connect to your rdyrct
        account
        {email && (
          <>
            {" "}
            (<span className="font-mono text-xs">{email}</span>)
          </>
        )}
        .
      </p>

      {scopes.length > 0 && (
        <ul className="mt-4 flex flex-col gap-1.5 text-left text-sm text-muted">
          {scopes.map((scope) => (
            <li key={scope} className="flex items-center gap-2">
              <span className="h-1 w-1 shrink-0 rounded-full bg-muted" />
              {lookup(SCOPE_LABELS, scope) ?? scope}
            </li>
          ))}
        </ul>
      )}

      <p className="mt-4 text-xs text-muted">
        It can call the API and MCP tools as you, the same as a scoped API key. Revoke it any time
        from the API page's MCP tab.
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
  const { raw, clientId, scopes } = useOAuthQuery();

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
        <p className="mb-4 text-xl font-bold tracking-widest">rdyrct</p>

        {loading ? (
          <Spinner className="mx-auto" />
        ) : client.isError ? (
          <p className="text-sm text-muted">{errorMessage(client.error)}</p>
        ) : (
          <ConsentDetails
            clientName={client.data?.client_name || clientId}
            email={currentUser.data?.user.email}
            scopes={scopes}
            onDecide={(accept) => decide.mutate(accept)}
            deciding={decide.isPending}
          />
        )}
      </div>
    </div>
  );
}
