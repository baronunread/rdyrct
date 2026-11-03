import { useNavigate, useParams } from "@tanstack/react-router";
import { HrefLink } from "../lib/router-search";
import { errorMessage } from "@/app/lib/error-message";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "../lib/api";
import type { InvitePreview } from "@/shared/types";
import { useCurrentUser } from "../lib/hooks";
import { useCurrentOrg } from "../lib/current-org";
import { Button } from "../ui/button";
import { InviteSkeleton } from "../components/skeletons";
import { useToast } from "../ui/toast";
import posthog from "../lib/posthog";
import { AuthPanel, InviteJoinCard } from "../components/auth-panel";

function InviteAuthActions({
  signedIn,
  accept,
  onSignIn,
  here,
}: {
  signedIn: boolean;
  accept: () => void;
  onSignIn: () => void;
  here: string;
}) {
  if (signedIn) {
    return (
      <Button variant="primary" onClick={accept}>
        Accept invite
      </Button>
    );
  }
  return (
    <>
      <Button variant="primary" onClick={onSignIn}>
        Sign in to accept
      </Button>
      <p className="text-xs text-muted">
        New here?{" "}
        <HrefLink href={`/signup?next=${encodeURIComponent(here)}`}>Create an account</HrefLink>
      </p>
    </>
  );
}

export function InvitePage() {
  const { token } = useParams({ strict: false });
  const currentUser = useCurrentUser();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const { setOrg } = useCurrentOrg();

  const preview = useQuery<InvitePreview>({
    queryKey: ["invite", token],
    queryFn: () => api(`/invites/${token}`),
    retry: false,
  });

  const accept = async () => {
    try {
      const res = await api<{ orgId: string }>(`/invites/${token}/accept`, {
        method: "POST",
      });
      await qc.invalidateQueries({ queryKey: ["user"] });
      posthog.capture("organization_invite_accepted");
      setOrg(res.orgId);
      navigate({ to: "/dashboard" });
    } catch (e) {
      toast(errorMessage(e), "error");
      // A 404 here means the link is spent or revoked, and the card is still
      // offering to accept it. Re-asking flips it to the dead-invite screen,
      // so a second click cannot just repeat the toast.
      if (e instanceof ApiError && e.status === 404)
        await qc.invalidateQueries({ queryKey: ["invite", token] });
    }
  };

  const here = `/invite/${token}`;

  // The mock's join screen (auth-panel.tsx), in the same card as sign-in.
  if (preview.isLoading || currentUser.isLoading)
    return (
      <AuthPanel className="text-center">
        <InviteSkeleton />
      </AuthPanel>
    );
  if (preview.isError || !preview.data)
    return (
      <AuthPanel className="text-center">
        <p className="text-sm text-muted">This invite is invalid or has expired.</p>
      </AuthPanel>
    );
  return (
    <InviteJoinCard
      preview={preview.data}
      actions={
        <div className="flex flex-col gap-2">
          <InviteAuthActions
            signedIn={!!currentUser.data}
            accept={accept}
            onSignIn={() => navigate({ href: `/login?next=${encodeURIComponent(here)}` })}
            here={here}
          />
        </div>
      }
    />
  );
}
