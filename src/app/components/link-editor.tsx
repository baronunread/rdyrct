import {
  useMemo,
  useEffect,
  useRef,
  type ChangeEvent,
  type ClipboardEvent,
  type RefObject,
} from "react";
import { useForm, type SubmitErrorHandler } from "react-hook-form";
import { valibotResolver } from "@hookform/resolvers/valibot";
import { Link as RouterLink } from "react-router";
import { Lock, Info } from "lucide-react";
import { shortUrl } from "../lib/api";
import { QR_CORNER_STYLES, QR_DOT_STYLES, type DomainDTO, type LinkInput } from "@/shared/types";
import { Button } from "../ui/button";
import { cn } from "../ui/cn";
import { Dialog } from "../ui/dialog";
import { Field, Input } from "../ui/field";
import { MenuSelect } from "../ui/menu";
import { BusyContent } from "../ui/spinner";
import { useToast } from "../ui/toast";
import { Tooltip } from "../ui/tooltip";
import { QRPreview } from "./qr";
import { QrLogoInput } from "./qr-logo-input";
import { QrColorField } from "./qr-color-field";
import { linkInputSchema } from "../lib/schemas";
import { qrFallbacks, resolveQrLook, type OrgQr } from "../lib/org-qr";
import { firstFormError } from "../lib/form-errors";
import { resolveDefaultDomainId } from "../lib/default-domain";
import { useShake } from "../lib/use-shake";

const defaultForm: LinkInput = {
  destination: "",
  domainId: null,
  slug: "",
  title: "",
  utmSource: "",
  utmMedium: "",
  utmCampaign: "",
  utmTerm: "",
  utmContent: "",
  qrStyle: "",
  qrColor: "",
  qrCorner: "",
  qrEyeColor: "",
  qrBg: "",
  qrLogo: "",
  qrLogoSize: null,
};

type UtmKey = "utmSource" | "utmMedium" | "utmCampaign" | "utmTerm" | "utmContent";

const UTM_FIELDS: { key: UtmKey; label: string; placeholder: string }[] = [
  { key: "utmSource", label: "Source", placeholder: "newsletter" },
  { key: "utmMedium", label: "Medium", placeholder: "email" },
  { key: "utmCampaign", label: "Campaign", placeholder: "spring-launch" },
  { key: "utmTerm", label: "Term", placeholder: "running-shoes" },
  { key: "utmContent", label: "Content", placeholder: "ad-variant-a" },
];

const UTM_PARAMS: { param: string; key: UtmKey }[] = [
  { param: "utm_source", key: "utmSource" },
  { param: "utm_medium", key: "utmMedium" },
  { param: "utm_campaign", key: "utmCampaign" },
  { param: "utm_term", key: "utmTerm" },
  { param: "utm_content", key: "utmContent" },
];

const UTM_PARAM_BY_KEY: Record<UtmKey, string> = Object.fromEntries(
  UTM_PARAMS.map(({ param, key }) => [key, param]),
) as Record<UtmKey, string>;

/** UTM params already in the pasted/typed URL, mirroring the server's
 * resolveUtm: params present in the destination win over whatever is in
 * the form fields. A param that's present but empty still wins (so
 * backspacing its value out clears the field instead of leaving a stale
 * one behind); a param that's absent leaves the field alone. */
function utmFromDestination(destination: string): Partial<Record<UtmKey, string>> {
  let url: URL;
  try {
    url = new URL(destination);
  } catch {
    return {};
  }
  const out: Partial<Record<UtmKey, string>> = {};
  for (const { param, key } of UTM_PARAMS) {
    if (url.searchParams.has(param)) out[key] = url.searchParams.get(param)!.trim();
  }
  return out;
}

/** Drop a UTM param from the destination's query string, if present. Used
 * when a UTM field is edited by hand, so the field's value (not a stale
 * copy baked into the destination) is what wins on submit. */
function withoutUtmParam(destination: string, param: string): string {
  let url: URL;
  try {
    url = new URL(destination);
  } catch {
    return destination;
  }
  if (!url.searchParams.has(param)) return destination;
  url.searchParams.delete(param);
  return url.toString();
}

/** Same normalization the server applies on save (see stripUtmParams in
 * src/worker/util.ts): drop every utm_* param, leave the rest alone. */
function stripUtmFromDestination(destination: string): string {
  let url: URL;
  try {
    url = new URL(destination);
  } catch {
    return destination;
  }
  for (const { param } of UTM_PARAMS) url.searchParams.delete(param);
  return url.toString();
}

/** Splice pasted text into an input's current selection, the way the
 * browser's own paste would, so a partial selection is respected instead of
 * always replacing the whole field. */
function mergePastedText(input: HTMLInputElement, pasted: string): string {
  const start = input.selectionStart ?? input.value.length;
  const end = input.selectionEnd ?? input.value.length;
  return input.value.slice(0, start) + pasted + input.value.slice(end);
}

function UtmFields({
  form,
  setForm,
  className,
}: {
  form: LinkInput;
  setForm: (f: LinkInput) => void;
  className?: string;
}) {
  const set = (key: UtmKey) => (e: ChangeEvent<HTMLInputElement>) => {
    setForm({
      ...form,
      [key]: e.target.value,
      destination: withoutUtmParam(form.destination, UTM_PARAM_BY_KEY[key]),
    });
  };
  return (
    <fieldset className={cn("rounded-lg border border-border p-3", className)}>
      <legend className="px-1 text-2xs tracking-wider text-muted uppercase">UTM parameters</legend>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {UTM_FIELDS.map(({ key, label, placeholder }) => (
          <Field key={key} label={label}>
            <Input
              value={(form[key] as string) ?? ""}
              onChange={set(key)}
              placeholder={placeholder}
            />
          </Field>
        ))}
      </div>
    </fieldset>
  );
}

function QrPreviewSidebar({
  form,
  orgQr,
  previewUrl,
}: {
  form: LinkInput;
  orgQr: OrgQr;
  previewUrl: string;
}) {
  const look = resolveQrLook(form, orgQr);
  return (
    <div className="flex flex-col gap-2 sm:w-60">
      <p className="text-2xs tracking-wider text-muted uppercase">QR code</p>
      <QRPreview
        url={previewUrl}
        logo={look.logo}
        dotStyle={look.dotStyle}
        color={look.color}
        corner={look.corner}
        eyeColor={look.eyeColor}
        bg={look.bg}
        logoSize={look.logoSize}
        size={192}
      />
    </div>
  );
}

function QrShapeFields({
  form,
  setForm,
  fallbacks,
}: {
  form: LinkInput;
  setForm: (f: LinkInput) => void;
  fallbacks: ReturnType<typeof qrFallbacks>;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Dots">
          <MenuSelect
            label="Dots"
            value={form.qrStyle ?? ""}
            onChange={(v) => setForm({ ...form, qrStyle: v })}
            options={[
              { value: "", label: "Org default" },
              ...QR_DOT_STYLES.map((s) => ({ value: s, label: s })),
            ]}
          />
        </Field>
        <Field label="Corners">
          <MenuSelect
            label="Corners"
            value={form.qrCorner ?? ""}
            onChange={(v) => setForm({ ...form, qrCorner: v })}
            options={[
              { value: "", label: "Org default" },
              ...QR_CORNER_STYLES.map((s) => ({ value: s, label: s })),
            ]}
          />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <QrColorField
          label="Dot color"
          value={form.qrColor ?? ""}
          fallback={fallbacks.dotColor}
          onChange={(v) => setForm({ ...form, qrColor: v })}
        />
        <QrColorField
          label="Eye color"
          value={form.qrEyeColor ?? ""}
          fallback={fallbacks.eyeColor}
          onChange={(v) => setForm({ ...form, qrEyeColor: v })}
        />
      </div>
    </div>
  );
}

function QrBackgroundFields({
  form,
  setForm,
  fallbacks,
}: {
  form: LinkInput;
  setForm: (f: LinkInput) => void;
  fallbacks: ReturnType<typeof qrFallbacks>;
}) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <QrColorField
        label="Background"
        value={form.qrBg ?? ""}
        fallback={fallbacks.bg}
        onChange={(v) => setForm({ ...form, qrBg: v })}
        alpha
      />
      <Field
        label="Logo size"
        tip="How much of the QR code the logo covers. A bigger logo hides more of the dots, and past a point a scanner cannot fill in what is missing."
      >
        <MenuSelect
          label="Logo size"
          value={form.qrLogoSize == null ? "" : String(form.qrLogoSize)}
          onChange={(v) => setForm({ ...form, qrLogoSize: v === "" ? null : Number(v) })}
          options={[
            { value: "", label: "Org default" },
            { value: "0.25", label: "Small" },
            { value: "0.35", label: "Medium" },
            { value: "0.5", label: "Large" },
            { value: "0.65", label: "Extra large" },
          ]}
        />
      </Field>
    </div>
  );
}

function QrLogoField({ form, setForm }: { form: LinkInput; setForm: (f: LinkInput) => void }) {
  return (
    <div>
      <span className="mb-1.5 flex items-center gap-1.5 text-2xs tracking-wider text-muted uppercase">
        Logo
        <Tooltip content="Embedded in the center of the QR code. Use a small, square image with some breathing room so the code stays easy to scan. Leave empty to use your organization's default logo from Settings.">
          <button
            type="button"
            aria-label="About QR logos"
            className="cursor-help text-muted normal-case hover:text-text"
          >
            <Info size={13} />
          </button>
        </Tooltip>
      </span>
      <QrLogoInput
        value={form.qrLogo ?? ""}
        onLoad={(url) => setForm({ ...form, qrLogo: url })}
        onClear={() => setForm({ ...form, qrLogo: "" })}
      />
    </div>
  );
}

/** Stands where the customization controls would be on a paid plan. The QR
 * itself is already on screen beside it, so this asks for the upgrade the
 * visitor can see the point of, rather than blocking the feature. */
function QrCustomizationUpsell({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center justify-between gap-3 rounded-lg border border-dashed border-border p-3",
        className,
      )}
    >
      <div className="flex items-start gap-2">
        <Lock size={14} className="mt-0.5 shrink-0 text-muted" />
        <p className="text-xs text-muted">
          Add your logo, colors, and dot shapes to this QR on a paid plan.
        </p>
      </div>
      <RouterLink to="/billing" className="shrink-0">
        <Button variant="outline" size="sm">
          See plans
        </Button>
      </RouterLink>
    </div>
  );
}

function QrCustomization({
  form,
  setForm,
  orgQr,
  className,
}: {
  form: LinkInput;
  setForm: (f: LinkInput) => void;
  orgQr: OrgQr;
  className?: string;
}) {
  const fallbacks = qrFallbacks(form, orgQr);
  return (
    <fieldset className={cn("flex flex-col gap-4 rounded-lg border border-border p-3", className)}>
      <legend className="px-1 text-2xs tracking-wider text-muted uppercase">
        QR customization
      </legend>
      <QrShapeFields form={form} setForm={setForm} fallbacks={fallbacks} />
      <QrBackgroundFields form={form} setForm={setForm} fallbacks={fallbacks} />
      <QrLogoField form={form} setForm={setForm} />
    </fieldset>
  );
}

function DomainField({
  form,
  setForm,
  editing,
  activeDomains,
}: {
  form: LinkInput;
  setForm: (f: LinkInput) => void;
  editing: boolean;
  activeDomains: DomainDTO[];
}) {
  if (!activeDomains.length) return null;
  const onDomainChange = (v: string) => setForm({ ...form, domainId: v || null, slug: "" });
  return (
    <Field
      label="Domain"
      hint={
        editing
          ? "A link's domain can't change: create a new link on the other domain instead."
          : undefined
      }
    >
      <MenuSelect
        label="Domain"
        value={form.domainId ?? ""}
        onChange={onDomainChange}
        disabled={editing}
        options={[
          { value: "", label: `shared: ${window.location.host}` },
          ...activeDomains.map((d) => ({ value: d.id, label: d.hostname })),
        ]}
      />
    </Field>
  );
}

function SlugField({
  value,
  onChange,
  slugLocked,
  domainsAllowed,
  hasDomains,
}: {
  value: string;
  onChange: (e: ChangeEvent<HTMLInputElement>) => void;
  slugLocked: boolean;
  domainsAllowed: boolean;
  /** A domain is already connected: picking it (above) unlocks the slug, so
   * the hint just names that instead of pointing at /domains or /billing. */
  hasDomains: boolean;
}) {
  return (
    <Field
      label="Slug"
      hint={
        slugLocked ? (
          hasDomains ? (
            "Use a custom domain for custom slugs."
          ) : domainsAllowed ? (
            <>
              <RouterLink to="/domains" className="text-accent hover:underline">
                Connect a domain
              </RouterLink>{" "}
              for custom slugs.
            </>
          ) : (
            <>
              <RouterLink to="/billing" className="text-accent hover:underline">
                Upgrade
              </RouterLink>{" "}
              for custom slugs.
            </>
          )
        ) : (
          "Leave empty for a random one"
        )
      }
    >
      <Input
        value={value}
        onChange={onChange}
        placeholder={slugLocked ? "random" : "launch-2026"}
        disabled={slugLocked}
      />
    </Field>
  );
}

function LinkFormFields({
  form,
  setForm,
  editing,
  activeDomains,
  slugLocked,
  domainsAllowed,
  destinationRef,
}: {
  form: LinkInput;
  setForm: (f: LinkInput) => void;
  editing: boolean;
  activeDomains: DomainDTO[];
  slugLocked: boolean;
  domainsAllowed: boolean;
  destinationRef: RefObject<HTMLInputElement | null>;
}) {
  const toast = useToast();
  const set = (key: keyof LinkInput) => (e: ChangeEvent<HTMLInputElement>) =>
    setForm({ ...form, [key]: e.target.value });

  const onDestinationChange = (e: ChangeEvent<HTMLInputElement>) => {
    const destination = e.target.value;
    setForm({ ...form, destination, ...utmFromDestination(destination) });
  };

  // Pasting a link with utm_* params already on it shows the cleaned link
  // right away, not the raw paste: extract into the UTM fields below and
  // strip them from what lands in this field. Typing a URL out by hand
  // still shows exactly what's typed (see onDestinationChange) until it's
  // stripped on save.
  const onDestinationPaste = (e: ClipboardEvent<HTMLInputElement>) => {
    const pasted = e.clipboardData.getData("text");
    if (!pasted) return;
    const merged = mergePastedText(e.currentTarget, pasted);
    const utm = utmFromDestination(merged);
    if (Object.keys(utm).length === 0) return;
    e.preventDefault();
    setForm({ ...form, destination: stripUtmFromDestination(merged), ...utm });
    toast("UTM parameters found");
  };

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <Field label="Destination URL">
        <Input
          ref={destinationRef}
          value={form.destination}
          onChange={onDestinationChange}
          onPaste={onDestinationPaste}
          placeholder="https://example.com/launch"
          autoFocus={!editing}
        />
      </Field>

      <DomainField form={form} setForm={setForm} editing={editing} activeDomains={activeDomains} />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <SlugField
          value={form.slug ?? ""}
          onChange={set("slug")}
          slugLocked={slugLocked}
          domainsAllowed={domainsAllowed}
          hasDomains={activeDomains.length > 0}
        />
        <Field label="Title">
          <Input value={form.title ?? ""} onChange={set("title")} placeholder="Spring launch" />
        </Field>
      </div>
    </div>
  );
}

export function LinkEditor({
  open,
  onOpenChange,
  editingLink,
  busy,
  onSave,
  activeDomains,
  defaultDomainId,
  domainsAllowed,
  qrCustomEnabled,
  orgQr,
  shakeKey,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editingLink: LinkInput | null;
  busy: boolean;
  onSave: (data: LinkInput) => void;
  activeDomains: DomainDTO[];
  /** The org's default domain for new links (#69), or null for the shared
   * one. Ignored when editing: that link already has an address. */
  defaultDomainId: string | null;
  /** Whether the org's plan allows a custom domain at all (regardless of
   * whether one is connected yet): governs the shared-domain slug hint. */
  domainsAllowed: boolean;
  qrCustomEnabled: boolean;
  orgQr: OrgQr;
  shakeKey: number;
}) {
  const editing = editingLink != null;
  const toast = useToast();
  const shake = useShake();
  const destinationRef = useRef<HTMLInputElement>(null);

  const { handleSubmit, watch, reset } = useForm<LinkInput>({
    resolver: valibotResolver(linkInputSchema),
    defaultValues: defaultForm,
  });

  // A new link starts on the org's default domain, which also unlocks the
  // slug field: chosen slugs only exist on custom domains, so the customer
  // who set a default is exactly the one who wants to name their links.
  //
  const newDomainId = resolveDefaultDomainId(defaultDomainId, activeDomains);

  // Deliberately not a dependency: the default is read when the dialog opens
  // and not again, so a background refetch of the org's domains cannot re-run
  // this and wipe whatever the person had already typed.
  useEffect(() => {
    if (open) {
      reset(editingLink ?? { ...defaultForm, domainId: newDomainId });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editingLink, reset]);

  // shakeKey bumps on every save failure (client validation or server
  // error): the button shakes either way, without the parent needing to
  // know shake is button-level, not whole-dialog.
  const lastShakeKey = useRef(shakeKey);
  useEffect(() => {
    if (shakeKey !== lastShakeKey.current) {
      lastShakeKey.current = shakeKey;
      shake.start();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shakeKey]);

  const form = watch();
  const setForm = (next: LinkInput) => reset(next);
  const onInvalid: SubmitErrorHandler<LinkInput> = (errors) => {
    toast(firstFormError(errors, "Check the link details"), "error");
    shake.start();
    // destination is the only field this schema can reject, so it's always
    // the culprit; scroll it into view since QR customization can push it
    // off-screen above a long, scrolled dialog.
    if (errors.destination) {
      destinationRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
      destinationRef.current?.focus();
    }
  };

  const selectedDomain = activeDomains.find((d) => d.id === form.domainId)?.hostname ?? null;
  const slugLocked = !form.domainId;

  const previewUrl = useMemo(
    () => shortUrl(form.slug?.trim() || "preview", selectedDomain),
    [form.slug, selectedDomain],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={editing ? "Edit link" : "New link"} wide>
      <form
        onSubmit={handleSubmit(onSave, onInvalid)}
        className="grid gap-6 sm:grid-cols-[1fr_auto]"
      >
        <LinkFormFields
          form={form}
          setForm={setForm}
          editing={editing}
          activeDomains={activeDomains}
          slugLocked={slugLocked}
          domainsAllowed={domainsAllowed}
          destinationRef={destinationRef}
        />
        {/* QR preview sits beside the core fields on sm+; on mobile it's more useful
            after QR customization (the controls it's actually previewing) than
            wedged above UTM parameters, so it's last in source order there. */}
        <div className="order-last sm:order-none">
          <QrPreviewSidebar form={form} orgQr={orgQr} previewUrl={previewUrl} />
        </div>

        <UtmFields form={form} setForm={setForm} className="sm:col-span-2" />

        {qrCustomEnabled ? (
          <QrCustomization form={form} setForm={setForm} orgQr={orgQr} className="sm:col-span-2" />
        ) : (
          <QrCustomizationUpsell className="sm:col-span-2" />
        )}
      </form>

      <div className="mt-6 flex justify-end gap-2">
        <Button variant="ghost" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
        <Button
          variant="primary"
          type="submit"
          disabled={busy}
          onClick={handleSubmit(onSave, onInvalid)}
          className={shake.className}
          onAnimationEnd={shake.end}
        >
          <BusyContent busy={busy}>{editing ? "Save changes" : "Create link"}</BusyContent>
        </Button>
      </div>
    </Dialog>
  );
}
