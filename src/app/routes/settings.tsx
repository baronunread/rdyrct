import { useState } from "react";
import { Link } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useCurrentUser } from "../lib/hooks";
import { useCurrentOrg } from "../lib/current-org";
import { api, shortUrl } from "../lib/api";
import { authClient } from "../lib/auth-client";
import {
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
import { useToast } from "../ui/toast";
import { QRPreview, QrLogoInput, QrColorField } from "../components/qr";

export function SettingsPage() {
  const { org } = useCurrentOrg();
  const orgId = org?.id ?? "";
  const me = useCurrentUser();
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
  const [qrCorner, setQrCorner] = useState(org?.qrCorner ?? "");
  const [qrBg, setQrBg] = useState(org?.qrBg ?? "");
  const [qrEyeColor, setQrEyeColor] = useState(org?.qrEyeColor ?? "");
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
        body: { qrLogo, qrStyle, qrColor, qrCorner, qrBg, qrEyeColor },
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
        <Card className="max-w-2xl">
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

        <Card className="max-w-2xl">
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
              <div className="flex flex-col gap-6 sm:flex-row">
                <div className="flex min-w-0 flex-1 flex-col gap-4">
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Dot style">
                      <MenuSelect
                        label="Dot style"
                        value={qrStyle}
                        onChange={setQrStyle}
                        disabled={!isOwner}
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
                        disabled={!isOwner}
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
                      disabled={!isOwner}
                    />
                    <QrColorField
                      label="Eye color"
                      value={qrEyeColor}
                      fallback={qrColor || QR_DEFAULT_COLOR}
                      onChange={setQrEyeColor}
                      disabled={!isOwner}
                    />
                  </div>

                  <QrColorField
                    label="Background"
                    value={qrBg}
                    fallback={QR_DEFAULT_BG}
                    allowTransparent
                    onChange={setQrBg}
                    disabled={!isOwner}
                  />

                  <div>
                    <span className="mb-1.5 block text-[11px] tracking-wider text-muted uppercase">
                      Logo (PNG/SVG, ≤ 96 KB)
                    </span>
                    <QrLogoInput disabled={!isOwner} onLoad={setQrLogo} />
                    {qrLogo && isOwner && (
                      <button
                        type="button"
                        onClick={() => setQrLogo("")}
                        className="mt-1.5 cursor-pointer text-[11px] tracking-wider text-muted uppercase hover:text-text"
                      >
                        Remove logo
                      </button>
                    )}
                  </div>

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
                    corner={qrCorner}
                    eyeColor={qrEyeColor}
                    bg={qrBg}
                    size={160}
                  />
                </div>
              </div>
            )}
          </div>
        </Card>

        <Card className="max-w-2xl">
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
