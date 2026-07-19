import { useState } from "react";
import { Link } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useMe } from "../lib/hooks";
import { useCurrentOrg } from "../lib/current-org";
import { api, shortUrl } from "../lib/api";
import { authClient } from "../lib/auth-client";
import { QR_DEFAULT_COLOR, QR_DOT_STYLES } from "@/shared/types";
import { Button } from "../ui/button";
import { Dialog } from "../ui/dialog";
import { Field, Input, Select } from "../ui/field";
import { Card, PageHeader } from "../ui/misc";
import { useToast } from "../ui/toast";
import { QRPreview, QrLogoInput } from "../components/qr";

export function SettingsPage() {
  const { org } = useCurrentOrg();
  const orgId = org?.id ?? "";
  const me = useMe();
  const qc = useQueryClient();
  const toast = useToast();
  const isOwner = me.data?.user.isAdmin || org?.role === "owner";
  const isPro = org?.plan === "pro";
  const [name, setName] = useState(org?.name ?? "");
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Org-level QR defaults; "" means the built-in default.
  const [qrStyle, setQrStyle] = useState(org?.qrStyle ?? "");
  const [qrColor, setQrColor] = useState(org?.qrColor ?? "");
  const [qrLogo, setQrLogo] = useState(org?.qrLogo ?? "");
  const [savingQr, setSavingQr] = useState(false);

  const rename = async () => {
    try {
      await api(`/orgs/${orgId}`, { method: "PATCH", body: { name } });
      await qc.invalidateQueries({ queryKey: ["user"] });
      toast("Organization renamed");
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };

  const saveQr = async () => {
    setSavingQr(true);
    try {
      await api(`/orgs/${orgId}`, {
        method: "PATCH",
        body: { qrLogo, qrStyle, qrColor },
      });
      await qc.invalidateQueries({ queryKey: ["user"] });
      toast("QR defaults saved");
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setSavingQr(false);
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
      <PageHeader title="Settings" sub="Organization settings" />
      <div className="flex flex-col gap-4">
        <Card className="max-w-lg">
          <div className="flex flex-col gap-4">
            <Field label="Organization name">
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
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

        <Card className="max-w-lg">
          <div className="flex flex-col gap-4">
            <div>
              <p className="text-[11px] tracking-wider text-muted uppercase">
                QR code defaults
              </p>
              <p className="mt-1 text-xs text-muted">
                Applied to every link's QR code unless the link overrides
                them.
              </p>
            </div>
            {!isPro ? (
              <p className="text-sm text-muted">
                QR customization is a Pro feature.{" "}
                <Link to="/billing" className="text-accent hover:underline">
                  Upgrade
                </Link>{" "}
                to put your logo and style on every QR code.
              </p>
            ) : (
              <div className="flex flex-col gap-5 sm:flex-row">
                <div className="flex min-w-0 flex-1 flex-col gap-4">
                  <Field label="Dot style">
                    <Select
                      value={qrStyle}
                      onChange={(e) => setQrStyle(e.target.value)}
                      disabled={!isOwner}
                    >
                      <option value="">Rounded (default)</option>
                      {QR_DOT_STYLES.filter((s) => s !== "rounded").map(
                        (s) => (
                          <option key={s} value={s}>
                            {s}
                          </option>
                        ),
                      )}
                    </Select>
                  </Field>
                  <Field label="Ink color">
                    <div className="flex items-center gap-2">
                      <input
                        type="color"
                        value={qrColor || QR_DEFAULT_COLOR}
                        onChange={(e) => setQrColor(e.target.value)}
                        disabled={!isOwner}
                        aria-label="QR ink color"
                        className="h-9 w-14 cursor-pointer rounded-md border border-border bg-bg p-1 disabled:cursor-default disabled:opacity-50"
                      />
                      {qrColor && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setQrColor("")}
                        >
                          Reset
                        </Button>
                      )}
                    </div>
                  </Field>
                  <Field label="Logo (PNG/SVG, ≤ 96 KB)">
                    <QrLogoInput
                      disabled={!isOwner}
                      onLoad={setQrLogo}
                    />
                  </Field>
                  {qrLogo && (
                    <div>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setQrLogo("")}
                      >
                        Remove logo
                      </Button>
                    </div>
                  )}
                  {isOwner ? (
                    <div>
                      <Button
                        variant="primary"
                        onClick={saveQr}
                        disabled={savingQr}
                      >
                        {savingQr ? "…" : "Save QR defaults"}
                      </Button>
                    </div>
                  ) : (
                    <p className="text-xs text-muted">
                      Only the owner can change these settings.
                    </p>
                  )}
                </div>
                <div className="shrink-0 self-center sm:self-start">
                  <QRPreview
                    url={shortUrl("preview")}
                    logo={qrLogo || undefined}
                    dotStyle={qrStyle}
                    color={qrColor}
                    size={144}
                  />
                </div>
              </div>
            )}
          </div>
        </Card>

        <Card className="max-w-lg">
          <div className="flex flex-col gap-3">
            <p className="text-[11px] tracking-wider text-danger uppercase">
              Danger zone
            </p>
            <p className="text-sm text-muted">
              Permanently delete your account. This does not delete
              organizations you belong to as a member, but you must transfer
              or delete any organizations you own first.
            </p>
            <div>
              <Button variant="danger" onClick={() => setDeleteOpen(true)}>
                Delete account
              </Button>
            </div>
          </div>
        </Card>
      </div>

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
              {deleting ? "…" : "Delete account"}
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
