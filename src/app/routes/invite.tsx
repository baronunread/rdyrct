import { Link, useNavigate, useParams } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import type { InvitePreview } from "@/shared/types";
import { useMe } from "../lib/hooks";
import { useCurrentOrg } from "../lib/current-org";
import { Button } from "../ui/button";
import { InviteSkeleton } from "../components/skeletons";
import { useToast } from "../ui/toast";

export function InvitePage() {
  const { token } = useParams<{ token: string }>();
  const me = useMe();
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
      setOrg(res.orgId);
      navigate("/dashboard");
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };

  const here = `/invite/${token}`;

  return (
    <div className="grid min-h-dvh place-items-center px-4">
      <div className="w-full max-w-sm rounded-xl border border-border bg-surface p-6 text-center">
        <p className="mb-4 text-xl font-bold tracking-widest">
          rdyrct
        </p>
        {preview.isLoading || me.isLoading ? (
          <InviteSkeleton />
        ) : preview.isError ? (
          <p className="text-sm text-muted">
            This invite is invalid or has expired.
          </p>
        ) : (
          <>
            <p className="text-sm">
              You have been invited to join{" "}
              <span className="font-bold text-accent">
                {preview.data!.orgName}
              </span>{" "}
              as <span className="text-accent-2">{preview.data!.role}</span>.
            </p>
            <div className="mt-5 flex flex-col gap-2">
              {me.data ? (
                <Button variant="primary" onClick={accept}>
                  Accept invite
                </Button>
              ) : (
                <>
                  <Button
                    variant="primary"
                    onClick={() =>
                      navigate(`/login?next=${encodeURIComponent(here)}`)
                    }
                  >
                    Sign in to accept
                  </Button>
                  <p className="text-xs text-muted">
                    New here?{" "}
                    <Link to={`/signup?next=${encodeURIComponent(here)}`}>
                      Create an account
                    </Link>
                  </p>
                </>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
