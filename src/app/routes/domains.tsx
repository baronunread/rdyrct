import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router";
import { AnimatePresence, MotionConfig, motion } from "motion/react";
import { Trash2, RefreshCw, Copy, Check } from "lucide-react";
import { useMe, useConfig, useDomains, useDomainMutations } from "../lib/hooks";
import { useCurrentOrg } from "../lib/current-org";
import { PLAN_LIMITS, type DomainDTO } from "@/shared/types";
import { Button, IconButton } from "../ui/button";
import { Dialog } from "../ui/dialog";
import { Input } from "../ui/field";
import { Badge, Card, PageHeader } from "../ui/misc";
import { DomainsSkeleton } from "../components/skeletons";
import { useToast } from "../ui/toast";
import { cn } from "../ui/cn";

const domainStatusColor: Record<
  DomainDTO["status"],
  "accent" | "butter" | "mint" | "pink"
> = {
  checking_dns: "butter",
  issuing_tls: "accent",
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
      <PageHeader
        title="Domains"
        sub="Serve short links from your own domain"
      />
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
  const { add, refresh, setRootRedirect, remove } =
    useDomainMutations(orgId);
  const config = useConfig();
  const appHost = config.data?.appHost ?? window.location.host;
  const toast = useToast();
  const limits = PLAN_LIMITS[plan];
  const [hostname, setHostname] = useState("");
  const [deleting, setDeleting] = useState<DomainDTO | null>(null);
  const [redirectDraft, setRedirectDraft] = useState<Record<string, string>>(
    {},
  );

  const copy = (text: string) => {
    navigator.clipboard.writeText(text);
    toast("Copied to clipboard");
  };

  const addDomain = () => {
    const value = hostname.trim();
    if (!value) return;
    add.mutate(value, {
      onSuccess: (d) => {
        setHostname("");
        toast(
          d.status === "active"
            ? "Domain added successfully"
            : d.status === "issuing_tls"
              ? "Domain added, DNS resolved — issuing certificate…"
              : "Domain added, checking DNS…",
        );
      },
      onError: (e) => toast(e.message, "error"),
    });
  };

  const recheck = (d: DomainDTO) => {
    const oldStatus = d.status;
    refresh.mutate(d.id, {
      onSuccess: (updated) => {
        if (updated.status === oldStatus) {
          if (oldStatus === "checking_dns")
            toast(
              "CNAME record not detected yet — create it at your DNS provider to continue",
            );
          else if (oldStatus === "issuing_tls")
            toast("Certificate still being issued — usually takes a few minutes");
        } else if (updated.status === "active") {
          toast("Domain is live!");
        } else if (oldStatus === "checking_dns" && updated.status === "issuing_tls") {
          toast("DNS resolved! Issuing TLS certificate…");
        }
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

  if (limits.domains === 0)
    return (
      <Card className="max-w-2xl">
        <div className="flex flex-col gap-3">
          <p className="text-[11px] tracking-wider text-muted uppercase">
            Custom domains
          </p>
          <p className="text-sm text-muted">
            Use your own domain for short links instead of the shared default.
            Custom domains are a Pro feature.
          </p>
          <div>
            <Link to="/billing">
              <Button variant="primary">Upgrade to add a domain</Button>
            </Link>
          </div>
        </div>
      </Card>
    );

  const transitional = (status: DomainDTO["status"]) =>
    status === "checking_dns" || status === "issuing_tls";

  return (
    <>
      <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
        <Card className="w-full max-w-2xl">
          <div className="flex flex-col gap-4">
            <p className="text-[11px] tracking-wider text-muted uppercase">
              Custom domains
            </p>

            {domains.isLoading ? (
              <DomainsSkeleton />
            ) : (
              <div className="flex flex-col gap-4">
                <MotionConfig reducedMotion="user">
                  {domains.data?.map((d) => (
                  <div
                    key={d.id}
                    className="rounded-lg border border-border p-3"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-bold">{d.hostname}</span>
                      <div className="relative flex items-center gap-1">
                        <AnimatePresence mode="popLayout">
                          <motion.span
                            key={d.status}
                            initial={
                              document.visibilityState === "visible"
                                ? { x: 16, opacity: 0 }
                                : { x: 0, opacity: 1 }
                            }
                            animate={{ x: 0, opacity: 1 }}
                            exit={
                              document.visibilityState === "visible"
                                ? { x: -16, opacity: 0 }
                                : { x: 0, opacity: 1 }
                            }
                            transition={{
                              duration:
                                document.visibilityState === "visible"
                                  ? 0.2
                                  : 0,
                            }}
                            className="inline-flex"
                          >
                            <Badge color={domainStatusColor[d.status]}>
                              {d.status === "checking_dns"
                                ? "Checking DNS"
                                : d.status === "issuing_tls"
                                  ? "Issuing TLS"
                                  : d.status}
                            </Badge>
                          </motion.span>
                        </AnimatePresence>
                        {transitional(d.status) && (
                          <IconButton
                            label="Re-check now"
                            disabled={refresh.isPending}
                            onClick={() => recheck(d)}
                          >
                            <RefreshCw
                              size={14}
                              className={
                                refresh.isPending ? "animate-spin" : ""
                              }
                            />
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

                    {transitional(d.status) && (
                      <div className="mt-3 flex flex-col gap-1.5 rounded-md bg-surface-2/50 p-3 text-xs text-muted">
                        <p>
                          {d.status === "checking_dns"
                            ? "To activate, create this record at your DNS provider:"
                            : "DNS resolved. Waiting for the TLS certificate to be issued."}
                        </p>
                        {d.status === "checking_dns" && (
                          <div className="flex flex-wrap items-center gap-1.5">
                            <code className="rounded bg-bg px-1.5 py-0.5 text-text">
                              {d.hostname} CNAME {appHost}
                            </code>
                            <CopyButton
                              text={appHost}
                              label="Copy CNAME target"
                              onCopy={copy}
                            />
                          </div>
                        )}
                        <p>
                          {d.status === "checking_dns"
                            ? "We re-check automatically every few seconds — "
                            : "This usually takes a few minutes. "}
                          Hit the refresh button above to check progress
                          manually.
                        </p>
                      </div>
                    )}

                    {d.status === "active" && (
                      <div className="mt-3">
                        <span className="mb-1.5 block text-xs tracking-wider text-muted uppercase">
                          Root redirect
                        </span>
                        <div className="flex items-center gap-2">
                          <div className="min-w-0 flex-1">
                            <Input
                              aria-label="Root redirect"
                              value={redirectDraft[d.id] ?? d.rootRedirect}
                              onChange={(e) =>
                                setRedirectDraft({
                                  ...redirectDraft,
                                  [d.id]: e.target.value,
                                })
                              }
                              placeholder="https://example.com"
                            />
                          </div>
                          <Button
                            size="sm"
                            disabled={setRootRedirect.isPending}
                            onClick={() => saveRedirect(d)}
                          >
                            Save
                          </Button>
                        </div>
                        <span className="mt-1 block text-xs text-muted/80">
                          Where the bare domain (no slug) sends visitors, e.g.
                          your homepage
                        </span>
                      </div>
                    )}
                  </div>
                  ))}
                </MotionConfig>

                <form
                  className={cn(
                    "flex flex-col gap-3",
                    domains.data?.length ? "border-t border-border pt-4" : "",
                  )}
                  onSubmit={(e) => {
                    e.preventDefault();
                    addDomain();
                  }}
                >
                  <div>
                    <span className="mb-1.5 block text-xs tracking-wider text-muted uppercase">
                      Add a domain
                    </span>
                    <div className="flex items-center gap-2">
                      <div className="min-w-0 flex-1">
                        <Input
                          aria-label="Add a domain"
                          value={hostname}
                          onChange={(e) => {
                            setHostname(e.target.value);
                          }}
                          placeholder="links.example.com"
                        />
                      </div>
                      <Button
                        type="submit"
                        variant="primary"
                        size="sm"
                        disabled={
                          !hostname.trim() || add.isPending
                        }
                        className="w-24"
                      >
                        {add.isPending
                          ? "Adding…"
                          : "Add domain"}
                      </Button>
                    </div>
                    <span className="mt-1 block text-xs text-muted/80">
                      After adding, we check for the CNAME record every few
                      seconds. Once detected, we issue a TLS certificate
                      automatically. You can also hit the refresh button to
                      check progress.
                    </span>
                  </div>
                </form>
              </div>
            )}
          </div>
        </Card>

        <aside className="w-full shrink-0 lg:w-72">
          <p className="text-[11px] tracking-wider text-muted uppercase">
            How it works
          </p>
          <ol className="mt-3 flex flex-col gap-3">
            <Step n={1}>
              At your DNS provider, create a CNAME record pointing a hostname
              you own (e.g.{" "}
              <code className="text-text">links.example.com</code>) at{" "}
              <code className="text-text">{appHost}</code>.
            </Step>
            <Step n={2}>
              Add the hostname below — we detect the CNAME and issue TLS
              automatically.
            </Step>
            <Step n={3}>
              Your short links go live under your brand. Certificates and
              renewals are handled for you.
            </Step>
          </ol>
        </aside>
      </div>

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

// Copy-to-clipboard button whose icon animates into a tick on success. The
// tick holds for a couple of seconds and repeat clicks while ticked don't
// replay the animation — the icon only flips back once the timeout elapses.
function CopyButton({
  text,
  label,
  onCopy,
}: {
  text: string;
  label: string;
  onCopy: (text: string) => void;
}) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  const handleClick = () => {
    onCopy(text);
    if (copied) return;
    setCopied(true);
    timer.current = setTimeout(() => setCopied(false), 2000);
  };

  return (
    <IconButton label={label} onClick={handleClick}>
      <span className="relative block h-3 w-3">
        <Copy
          size={12}
          className={cn(
            "absolute inset-0 transition-all duration-200",
            copied ? "scale-50 opacity-0 blur-xs" : "scale-100 opacity-100",
          )}
        />
        <Check
          size={12}
          className={cn(
            "absolute inset-0 text-accent-2 transition-all duration-200",
            copied ? "scale-100 opacity-100" : "scale-50 opacity-0 blur-xs",
          )}
        />
      </span>
    </IconButton>
  );
}

function Step({ n, children }: { n: number; children: ReactNode }) {
  return (
    <li className="flex gap-2.5 text-xs text-muted">
      <span className="tnum font-bold text-accent">{n}</span>
      <span>{children}</span>
    </li>
  );
}
