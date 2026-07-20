import { useState } from "react";
import { Link } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useCurrentUser } from "../lib/hooks";
import { useCurrentOrg } from "../lib/current-org";
import { api, shortUrl } from "../lib/api";
import { authClient } from "../lib/auth-client";
import {
  PLAN_LIMITS,
  QR_CORNER_STYLES,
  QR_DEFAULT_BG,
  QR_DEFAULT_COLOR,
  QR_DOT_STYLES,
} from "@/shared/types";
import { Button } from "../ui/button";
import { Dialog } from "../ui/dialog";
import { Field, Input } from "../ui/field";
import { MenuSelect } from "../ui/menu";
import { Card, PageHeader } from "../ui/misc";
import { Spinner } from "../ui/spinner";
import { useToast } from "../ui/toast";
import { QRPreview, QrLogoInput, QrColorField } from "../components/qr";
import { CopyButton } from "../ui/copy-button";

export function SettingsPage() {
  const { org } = useCurrentOrg();
  const orgId = org?.id ?? "";
  const me = useCurrentUser();
  const qc = useQueryClient();
  const toast = useToast();
  const isOwner = me.data?.user.isAdmin || org?.role === "owner";
  // Draft-until-edited: tracks the active org (including one just created
  // from the NoOrgState below, while this page stays mounted) until typed in.
  const [nameDraft, setNameDraft] = useState<string | null>(null);
  const name = nameDraft ?? org?.name ?? "";
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteOrgOpen, setDeleteOrgOpen] = useState(false);
  const [confirmName, setConfirmName] = useState("");
  const [deletingOrg, setDeletingOrg] = useState(false);

  const rename = async () => {
    try {
      await api(`/orgs/${orgId}`, { method: "PATCH", body: { name } });
      await qc.invalidateQueries({ queryKey: ["user"] });
      toast("Organization renamed");
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };

  const copyOrgName = (text: string) => {
    navigator.clipboard.writeText(text);
    toast("Copied to clipboard");
  };

  const deleteOrg = async () => {
    setDeletingOrg(true);
    try {
      await api(`/orgs/${orgId}`, { method: "DELETE" });
      setDeleteOrgOpen(false);
      setConfirmName("");
      setNameDraft(null);
      toast("Organization deleted");
      // useCurrentOrg falls back to the next org (or NoOrgState everywhere).
      await qc.refetchQueries({ queryKey: ["user"] });
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setDeletingOrg(false);
    }
  };

  const deleteAccount = async () => {
    setDeleting(true);
    try {
      const { error } = await authClient.deleteUser({ callbackURL: "/" });
      if (error) {
        toast(error.message ?? "Failed to delete account", "error");
        return;
      }
      window.location.assign("/");
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="Settings"
        sub={org ? "Organization settings" : "Your account"}
      />
      <div className="flex flex-col gap-4">
        {/* org cards only when an org exists; account deletion always */}
        {org && (
          <>
            <Card className="max-w-2xl">
              <div className="flex flex-col gap-4">
                <Field label="Organization name">
                  <Input
                    value={name}
                    onChange={(e) => setNameDraft(e.target.value)}
                    disabled={!isOwner}
                  />
                </Field>
                <Field label="Organization id">
                  <Input value={orgId} disabled readOnly />
                </Field>
                {isOwner ? (
                  <div>
                    <Button
                      variant="primary"
                      onClick={rename}
                      disabled={!name.trim()}
                    >
                      Save
                    </Button>
                  </div>
                ) : (
                  <p className="text-xs text-muted">
                    Only the owner can change these settings.
                  </p>
                )}
              </div>
            </Card>

            <QrDefaultsCard />
          </>
        )}

        <Card className="max-w-2xl">
          <div className="flex flex-col gap-3">
            <p className="text-[11px] tracking-wider text-danger uppercase">
              Danger zone
            </p>
            {org && isOwner && (
              <>
                <p className="text-sm text-muted">
                  Permanently delete{" "}
                  <span className="text-text">{org.name}</span> with every
                  link, custom domain, and all click history. Short links
                  stop working immediately.
                </p>
                <div>
                  <Button
                    variant="danger"
                    onClick={() => setDeleteOrgOpen(true)}
                  >
                    Delete organization
                  </Button>
                </div>
                <div className="my-1 border-t border-border" />
              </>
            )}
            <p className="text-sm text-muted">
              Permanently delete your account. This does not delete
              organizations you belong to as a member, but you must delete
              any organizations you own first.
            </p>
            <div>
              <Button variant="danger" onClick={() => setDeleteOpen(true)}>
                Delete account
              </Button>
            </div>
          </div>
        </Card>
      </div>

      {org && (
        <Dialog
          open={deleteOrgOpen}
          onOpenChange={(o) => {
            setDeleteOrgOpen(o);
            if (!o) setConfirmName("");
          }}
          title="Delete organization"
        >
          <div className="flex flex-col gap-4">
            <p className="text-sm">
              This permanently deletes{" "}
              <span className="font-bold text-accent">{org.name}</span>:
              every link, custom domain, and all click history. Short links
              stop working immediately. This cannot be undone.
            </p>
            {/* outside a Field: its uppercase label would hide the name's
                real casing, which the exact-match check depends on */}
            <div>
              <div className="mb-1.5 flex flex-wrap items-center gap-1.5 text-sm text-muted">
                <span>To confirm, type</span>
                <code className="rounded bg-bg px-1.5 py-0.5 text-text">
                  {org.name}
                </code>
                <CopyButton
                  text={org.name}
                  label="Copy organization name"
                  onCopy={copyOrgName}
                />
              </div>
              <Input
                value={confirmName}
                onChange={(e) => setConfirmName(e.target.value)}
                placeholder={org.name}
                aria-label={`Type ${org.name} to confirm deletion`}
                autoFocus
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setDeleteOrgOpen(false)}>
                Cancel
              </Button>
              <Button
                variant="danger"
                disabled={confirmName.trim() !== org.name || deletingOrg}
                onClick={deleteOrg}
              >
                {deletingOrg ? <Spinner /> : "Delete organization"}
              </Button>
            </div>
          </div>
        </Dialog>
      )}

      <Dialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Delete account"
      >
        <div className="flex flex-col gap-4">
          <p className="text-sm">
            This permanently deletes your account. This cannot be undone.
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setDeleteOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              disabled={deleting}
              onClick={deleteAccount}
            >
              {deleting ? <Spinner /> : "Delete account"}
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}

function QrDefaultsCard() {
  const { org } = useCurrentOrg();
  const orgId = org?.id ?? "";
  const me = useCurrentUser();
  const qc = useQueryClient();
  const toast = useToast();
  const isAdmin = me.data?.user.isAdmin || org?.role === "owner" || org?.role === "admin";
  const hasQr = org ? PLAN_LIMITS[org.plan].qr : false;

  // Org-level QR defaults; "" means the built-in default.
  const [qrStyle, setQrStyle] = useState(org?.qrStyle ?? "");
  const [qrColor, setQrColor] = useState(org?.qrColor ?? "");
  const [qrLogo, setQrLogo] = useState(org?.qrLogo ?? "");
  const [qrCorner, setQrCorner] = useState(org?.qrCorner ?? "");
  const [qrBg, setQrBg] = useState(org?.qrBg ?? "");
  const [qrEyeColor, setQrEyeColor] = useState(org?.qrEyeColor ?? "");
  // "" = built-in default (QR_DEFAULT_LOGO_SIZE)
  const [qrLogoSize, setQrLogoSize] = useState(
    () => org?.qrLogoSize?.toString() ?? "",
  );
  const [savingQr, setSavingQr] = useState(false);

  const saveQr = async () => {
    setSavingQr(true);
    try {
      await api(`/orgs/${orgId}`, {
        method: "PATCH",
        body: {
          qrLogo,
          qrStyle,
          qrColor,
          qrCorner,
          qrBg,
          qrEyeColor,
          qrLogoSize: qrLogoSize === "" ? null : Number(qrLogoSize),
        },
      });
      await qc.invalidateQueries({ queryKey: ["user"] });
      toast("QR defaults saved");
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setSavingQr(false);
    }
  };

  return (
    <Card className="max-w-2xl">
      <div className="flex flex-col gap-4">
        <div>
          <p className="text-[11px] tracking-wider text-muted uppercase">
            QR code defaults
          </p>
          <p className="mt-1 text-xs text-muted">
            Applied to every link's QR code unless the link overrides them.
          </p>
        </div>
        {!hasQr ? (
          <p className="text-sm text-muted">
            QR customization is a paid feature.{" "}
            <Link to="/billing" className="text-accent hover:underline">
              Upgrade
            </Link>{" "}
            to put your logo and style on every QR code.
          </p>
        ) : (
          <div className="flex flex-col gap-6 sm:flex-row">
            <div className="flex min-w-0 flex-1 flex-col gap-4">
              <div className="grid grid-cols-2 gap-3">
                <Field label="Dot style">
                  <MenuSelect
                    label="Dot style"
                    value={qrStyle}
                    onChange={setQrStyle}
                    disabled={!isAdmin}
                    options={[
                      { value: "", label: "Rounded (default)" },
                      ...QR_DOT_STYLES.flatMap((s) =>
                        s === "rounded" ? [] : [{ value: s, label: s }],
                      ),
                    ]}
                  />
                </Field>
                <Field label="Corner style">
                  <MenuSelect
                    label="Corner style"
                    value={qrCorner}
                    onChange={setQrCorner}
                    disabled={!isAdmin}
                    options={[
                      { value: "", label: "Extra-rounded (default)" },
                      ...QR_CORNER_STYLES.flatMap((s) =>
                        s === "extra-rounded"
                          ? []
                          : [{ value: s, label: s }],
                      ),
                    ]}
                  />
                </Field>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <QrColorField
                  label="Dot color"
                  value={qrColor}
                  fallback={QR_DEFAULT_COLOR}
                  onChange={setQrColor}
                  disabled={!isAdmin}
                />
                <QrColorField
                  label="Eye color"
                  value={qrEyeColor}
                  fallback={qrColor || QR_DEFAULT_COLOR}
                  onChange={setQrEyeColor}
                  disabled={!isAdmin}
                />
              </div>

              <QrColorField
                label="Background"
                value={qrBg}
                fallback={QR_DEFAULT_BG}
                allowTransparent
                onChange={setQrBg}
                disabled={!isAdmin}
              />

              <div>
                <span className="mb-1.5 block text-[11px] tracking-wider text-muted uppercase">
                  Logo (PNG/SVG, ≤ 96 KB)
                </span>
                    <QrLogoInput
                      value={qrLogo}
                      disabled={!isAdmin}
                      onLoad={setQrLogo}
                      onClear={isAdmin ? () => setQrLogo("") : undefined}
                    />
              </div>

              <Field
                label="Logo size"
                hint="How much of the QR code the logo covers. Bigger can hurt scannability"
              >
                <MenuSelect
                  label="Logo size"
                  value={qrLogoSize}
                  onChange={setQrLogoSize}
                  disabled={!isAdmin}
                      options={[
                        { value: "", label: "Medium (default)" },
                        { value: "0.25", label: "Small" },
                        { value: "0.5", label: "Large" },
                        { value: "0.65", label: "Extra large" },
                      ]}
                />
              </Field>

              {isAdmin ? (
                <div>
                  <Button
                    variant="primary"
                    onClick={saveQr}
                    disabled={savingQr}
                  >
                    {savingQr ? <Spinner /> : "Save QR defaults"}
                  </Button>
                </div>
              ) : (
                <p className="text-xs text-muted">
                  Only the owner and admins can change these settings.
                </p>
              )}
            </div>
            <div className="shrink-0 self-center sm:self-start">
              <QRPreview
                url={shortUrl("preview")}
                logo={qrLogo || undefined}
                dotStyle={qrStyle}
                color={qrColor}
                corner={qrCorner}
                eyeColor={qrEyeColor}
                bg={qrBg}
                logoSize={qrLogoSize === "" ? undefined : Number(qrLogoSize)}
                size={160}
              />
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}
