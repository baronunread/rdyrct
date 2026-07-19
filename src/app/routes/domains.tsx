import { useState } from "react";
import { Link } from "react-router";
import { Plus, Trash2, RefreshCw } from "lucide-react";
import { useMe, useDomains, useDomainMutations } from "../lib/hooks";
import { useCurrentOrg } from "../lib/current-org";
import { PLAN_LIMITS, type DomainDTO } from "@/shared/types";
import { Button, IconButton } from "../ui/button";
import { Dialog } from "../ui/dialog";
import { Field, Input } from "../ui/field";
import { Badge, Card, PageHeader, Spinner } from "../ui/misc";
import { useToast } from "../ui/toast";

const domainStatusColor: Record<
  DomainDTO["status"],
  "butter" | "mint" | "pink"
> = {
  pending: "butter",
  active: "mint",
  error: "pink",
};

export function DomainsPage() {
  const { org } = useCurrentOrg();
  const orgId = org?.id ?? "";
  const me = useMe();

  const isAdmin =
    me.data?.user.isAdmin || org?.role === "owner" || org?.role === "admin";

  return (
    <div>
      <PageHeader title="Domains" sub="Custom domains for your short links" />
      {!org || !isAdmin ? (
        <p className="text-sm text-muted">
          You don't have access to domains.
        </p>
      ) : (
        <DomainsCard orgId={orgId} plan={org.plan} />
      )}
    </div>
  );
}

function DomainsCard({
  orgId,
  plan,
}: {
  orgId: string;
  plan: "free" | "pro";
}) {
  const domains = useDomains(orgId);
  const { add, refresh, setRootRedirect, remove } = useDomainMutations(orgId);
  const toast = useToast();
  const limits = PLAN_LIMITS[plan];
  const [hostname, setHostname] = useState("");
  const [deleting, setDeleting] = useState<DomainDTO | null>(null);
  const [redirectDraft, setRedirectDraft] = useState<Record<string, string>>(
    {},
  );

  const addDomain = () => {
    const value = hostname.trim();
    if (!value) return;
    add.mutate(value, {
      onSuccess: () => {
        setHostname("");
        toast("Domain added, configure DNS to activate it");
      },
      onError: (e) => toast(e.message, "error"),
    });
  };

  const saveRedirect = (domain: DomainDTO) => {
    const value = redirectDraft[domain.id] ?? domain.rootRedirect;
    setRootRedirect.mutate(
      { id: domain.id, rootRedirect: value },
      {
        onSuccess: () => toast("Root redirect updated"),
        onError: (e) => toast(e.message, "error"),
      },
    );
  };

  return (
    <>
      <Card className="max-w-lg">
        <div className="flex flex-col gap-4">
          <p className="text-[11px] tracking-wider text-muted uppercase">
            Custom domains
          </p>

          {limits.domains === 0 ? (
            <div className="flex flex-col gap-3">
              <p className="text-sm text-muted">
                Use your own domain for short links instead of the shared
                default. Custom domains are a Pro feature.
              </p>
              <div>
                <Link to="/billing">
                  <Button variant="primary">Upgrade to add a domain</Button>
                </Link>
              </div>
            </div>
          ) : domains.isLoading ? (
            <Spinner />
          ) : (
            <div className="flex flex-col gap-3">
              {domains.data?.map((d) => (
                <div
                  key={d.id}
                  className="rounded-lg border border-border p-3"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-bold">{d.hostname}</span>
                    <div className="flex items-center gap-1">
                      <Badge color={domainStatusColor[d.status]}>
                        {d.status}
                      </Badge>
                      {d.status === "pending" && (
                        <IconButton
                          label="Check status"
                          disabled={refresh.isPending}
                          onClick={() =>
                            refresh.mutate(d.id, {
                              onError: (e) => toast(e.message, "error"),
                            })
                          }
                        >
                          <RefreshCw size={14} />
                        </IconButton>
                      )}
                      <IconButton
                        label={`Delete ${d.hostname}`}
                        danger
                        onClick={() => setDeleting(d)}
                      >
                        <Trash2 size={14} />
                      </IconButton>
                    </div>
                  </div>

                  {d.status === "pending" && (
                    <p className="mt-2 text-xs text-muted">
                      Add a CNAME record:{" "}
                      <code className="text-text">{d.hostname}</code> →{" "}
                      <code className="text-text">
                        {window.location.host}
                      </code>
                      . Certificates are provisioned automatically once DNS
                      propagates.
                    </p>
                  )}

                  <div className="mt-3 flex items-end gap-2">
                    <div className="min-w-0 flex-1">
                      <Field label="Root redirect">
                        <Input
                          value={redirectDraft[d.id] ?? d.rootRedirect}
                          onChange={(e) =>
                            setRedirectDraft({
                              ...redirectDraft,
                              [d.id]: e.target.value,
                            })
                          }
                          placeholder="https://example.com"
                        />
                      </Field>
                    </div>
                    <Button
                      size="sm"
                      disabled={setRootRedirect.isPending}
                      onClick={() => saveRedirect(d)}
                    >
                      Save
                    </Button>
                  </div>
                </div>
              ))}

              <div className="flex items-end gap-2">
                <div className="min-w-0 flex-1">
                  <Field label="Add a domain" hint="e.g. links.example.com">
                    <Input
                      value={hostname}
                      onChange={(e) => setHostname(e.target.value)}
                      placeholder="links.example.com"
                    />
                  </Field>
                </div>
                <Button
                  variant="primary"
                  disabled={add.isPending || !hostname.trim()}
                  onClick={addDomain}
                >
                  <Plus size={15} /> Add
                </Button>
              </div>
            </div>
          )}
        </div>
      </Card>

      <Dialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="Delete domain"
      >
        {deleting && (
          <div className="flex flex-col gap-4">
            <p className="text-sm">
              Delete <span className="font-bold">{deleting.hostname}</span>?
              Links still using this domain must be moved or deleted first.
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setDeleting(null)}>
                Cancel
              </Button>
              <Button
                variant="danger"
                disabled={remove.isPending}
                onClick={() =>
                  remove.mutate(deleting.id, {
                    onSuccess: () => {
                      setDeleting(null);
                      toast("Domain deleted");
                    },
                    onError: (e) => toast(e.message, "error"),
                  })
                }
              >
                Delete
              </Button>
            </div>
          </div>
        )}
      </Dialog>
    </>
  );
}
