import { Link, useNavigate, useParams } from "react-router";
import { errorMessage } from "@/app/lib/error-message";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import type { InvitePreview } from "@/shared/types";
import { useCurrentUser } from "../lib/hooks";
import { useCurrentOrg } from "../lib/current-org";
import { Button } from "../ui/button";
import { InviteSkeleton } from "../components/skeletons";
import { useToast } from "../ui/toast";
import posthog from "../lib/posthog";

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
        New here? <Link to={`/signup?next=${encodeURIComponent(here)}`}>Create an account</Link>
      </p>
    </>
  );
}

function InviteDetails({
  preview,
  signedIn,
  accept,
  onSignIn,
  here,
}: {
  preview: InvitePreview;
  signedIn: boolean;
  accept: () => void;
  onSignIn: () => void;
  here: string;
}) {
  return (
    <>
      <p className="text-sm">
        You have been invited to join{" "}
        <span className="font-bold text-accent">{preview.orgName}</span> as{" "}
        <span className="text-accent-2">{preview.role}</span>.
      </p>
      <div className="mt-5 flex flex-col gap-2">
        <InviteAuthActions signedIn={signedIn} accept={accept} onSignIn={onSignIn} here={here} />
      </div>
    </>
  );
}

export function InvitePage() {
  const { token } = useParams<{ token: string }>();
  const me = useCurrentUser();
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
      navigate("/dashboard");
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  };

  const here = `/invite/${token}`;

  return (
    <div className="grid min-h-dvh place-items-center px-4">
      <div className="w-full max-w-sm rounded-xl bg-surface p-6 text-center smooth-shadow-ring-sm">
        <p className="mb-4 text-xl font-bold tracking-widest">rdyrct</p>
        {preview.isLoading || me.isLoading ? (
          <InviteSkeleton />
        ) : preview.isError ? (
          <p className="text-sm text-muted">This invite is invalid or has expired.</p>
        ) : (
          <InviteDetails
            preview={preview.data!}
            signedIn={!!me.data}
            accept={accept}
            onSignIn={() => navigate(`/login?next=${encodeURIComponent(here)}`)}
            here={here}
          />
        )}
      </div>
    </div>
  );
}
