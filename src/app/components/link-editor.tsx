import {
  useMemo,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from "react";
import { useForm, type SubmitErrorHandler } from "react-hook-form";
import { valibotResolver } from "@hookform/resolvers/valibot";
import { Link as RouterLink } from "@tanstack/react-router";
import { IconChevronLeft, IconWorld } from "@tabler/icons-react";
import { Lock, QrCode } from "@/app/ui/icons";
import { shortUrl } from "../lib/api";
import { useLinkHost } from "../lib/hooks";
import {
  QR_CORNER_STYLES,
  QR_DEFAULT_BG,
  QR_DEFAULT_COLOR,
  QR_DEFAULT_CORNER,
  QR_DEFAULT_LOGO_SIZE,
  QR_DOT_STYLES,
  type DomainDTO,
  type LinkInput,
} from "@/shared/types";
import { oneOf } from "@/shared/lookup";
import { Button } from "../ui/button";
import { buttonClass } from "../ui/button-class";
import { cn } from "../ui/cn";
import { Dialog, DialogClose, DialogTitle } from "../ui/dialog";
import { Field, FieldReason, Input, InvalidMark } from "../ui/field";
import { MenuSelect } from "../ui/menu";
import { BusyContent } from "../ui/spinner";
import { useToast } from "../ui/toast";
import { QRPreview } from "./qr";
import { SiteLetter } from "./link-marks";
import { QrContrastNote, QrEditorRows } from "./qr-pickers";
import type { QrLookValue, QrPatch } from "../lib/qr-look";
import { linkInputSchema } from "../lib/schemas";
import { resolveQrLook, type OrgQr } from "../lib/org-qr";
import { resolveDefaultDomainId } from "../lib/default-domain";
import { useShake } from "../lib/use-shake";
import { isWebAddress, linkFieldError, type LinkFieldError } from "../lib/link-field-errors";

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

/** The link's own QR look. The server refuses these on a plan without qrCustom. */
const QR_OVERRIDE_FIELDS = [
  "qrStyle",
  "qrColor",
  "qrCorner",
  "qrEyeColor",
  "qrBg",
  "qrLogo",
  "qrLogoSize",
] as const;

/** Whether the link carries its own QR look, so the editor says it is kept and locked, not an upsell (#162). */
function hasQrOverrides(data: LinkInput): boolean {
  return QR_OVERRIDE_FIELDS.some((field) =>
    field === "qrLogoSize" ? data.qrLogoSize != null : !!data[field],
  );
}

const UTM_MAIN: { key: UtmKey; label: string; placeholder: string }[] = [
  { key: "utmSource", label: "Source", placeholder: "newsletter" },
  { key: "utmMedium", label: "Medium", placeholder: "email" },
  { key: "utmCampaign", label: "Campaign", placeholder: "spring-sale" },
];
const QR_PREVIEW_SIZE = 160;

const UTM_MORE: { key: UtmKey; label: string; placeholder: string }[] = [
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

// SAFETY: Object.fromEntries types its result as an open record whatever it
// is given. UTM_PARAMS lists every UtmKey exactly once, so the object built
// from it has one entry per key.
const UTM_PARAM_BY_KEY = Object.fromEntries(
  UTM_PARAMS.map(({ param, key }) => [key, param] as const),
) as Record<UtmKey, string>;

/** Mirrors the server's resolveUtm: a param in the destination wins, even empty (so
 * backspacing clears the field); an absent one leaves the field alone. */
function utmFromDestination(destination: string) {
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

/** The server's normalization (stripUtmParams in src/worker/util.ts): drop every utm_* param. */
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

function mergePastedText(input: HTMLInputElement, pasted: string): string {
  const start = input.selectionStart ?? input.value.length;
  const end = input.selectionEnd ?? input.value.length;
  return input.value.slice(0, start) + pasted + input.value.slice(end);
}

function openedUrl(form: LinkInput): { base: string; tags: string } | null {
  const raw = form.destination.trim();
  if (!raw) return null;
  // Shown as typed until it is an address: a browser would happily turn
  // "copperkettle winter menu" into a percent-encoded host.
  if (!isWebAddress(raw)) return { base: raw, tags: "" };
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return { base: raw, tags: "" };
  }
  for (const { param } of UTM_PARAMS) url.searchParams.delete(param);
  const hash = url.hash;
  url.hash = "";
  const tags = new URLSearchParams();
  for (const { param, key } of UTM_PARAMS) {
    const value = form[key]?.trim();
    if (value) tags.set(param, value);
  }
  const base = url.toString().replace(/^https?:\/\//, "");
  const query = tags.toString();
  return { base, tags: (query ? (url.search ? "&" : "?") + query : "") + hash };
}

type SetForm = (f: LinkInput) => void;

function UtmInput({
  field,
  form,
  setForm,
}: {
  field: { key: UtmKey; label: string; placeholder: string };
  form: LinkInput;
  setForm: SetForm;
}) {
  const { key, label, placeholder } = field;
  return (
    <Field label={label}>
      <Input
        value={form[key] ?? ""}
        onChange={(e) =>
          setForm({
            ...form,
            [key]: e.target.value,
            destination: withoutUtmParam(form.destination, UTM_PARAM_BY_KEY[key]),
          })
        }
        placeholder={placeholder}
        autoComplete="off"
        autoCapitalize="none"
        spellCheck={false}
        className="px-2.5 font-mono text-xs"
      />
    </Field>
  );
}

function UtmFields({ form, setForm }: { form: LinkInput; setForm: SetForm }) {
  return (
    <fieldset className="flex min-w-0 flex-col gap-2">
      <legend className="mb-2 text-sm font-semibold">UTM tags</legend>
      <div className="grid grid-cols-1 gap-2 min-[420px]:grid-cols-3">
        {UTM_MAIN.map((f) => (
          <UtmInput key={f.key} field={f} form={form} setForm={setForm} />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-2 min-[420px]:grid-cols-2">
        {UTM_MORE.map((f) => (
          <UtmInput key={f.key} field={f} form={form} setForm={setForm} />
        ))}
      </div>
    </fieldset>
  );
}

/**
 * A link that already has styling, on an org that downgraded, is keeping it: "add your
 * logo on a paid plan" beside a visible logo reads as a bug.
 */
function QrCustomizationUpsell({ locked }: { locked: boolean }) {
  return (
    <div className="flex flex-col items-center gap-2 text-center">
      <p className="flex items-start gap-1.5 text-xs text-pretty text-muted">
        <Lock size={13} className="mt-px shrink-0" aria-hidden />
        <span>
          {locked
            ? "This QR keeps the look it already has, and still downloads that way. Changing it needs a paid plan."
            : "Add your logo, colors, and dot shapes to this QR on a paid plan."}
        </span>
      </p>
      <RouterLink to="/billing" className={buttonClass({ variant: "outline", size: "sm" })}>
        See plans
      </RouterLink>
    </div>
  );
}

// react-doctor-disable-next-line react-doctor/no-high-complexity-react-function -- one field with its domain, slug and lock states; split tracked in #422.
function ShortLinkField({
  form,
  setForm,
  editing,
  activeDomains,
  domainsAllowed,
  slugRef,
  error,
}: {
  form: LinkInput;
  setForm: SetForm;
  editing: boolean;
  activeDomains: DomainDTO[];
  domainsAllowed: boolean;
  slugRef: RefObject<HTMLInputElement | null>;
  error?: LinkFieldError;
}) {
  const linkHost = useLinkHost();
  const slugLocked = !form.domainId;
  const hasDomains = activeDomains.length > 0;
  const reasonId = "link-editor-slug-reason";
  const hints: ReactNode[] = [];
  if (slugLocked) {
    hints.push(
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
      ),
    );
  } else if (!editing) {
    hints.push("Leave the slug empty for a random one.");
  }
  if (editing && hasDomains) {
    hints.push("A link's domain can't change: create a new link on the other domain instead.");
  }

  return (
    <div className="min-w-0">
      <span className="mb-1.5 flex min-h-4 items-center gap-1.5 text-xs text-muted">
        Short link
        {error && <FieldReason id={reasonId} reason={error.reason} detail={error.detail} />}
      </span>
      <div
        className={cn(
          "flex h-10 min-w-0 items-stretch rounded-lg smooth-shadow-ring-xs",
          error && "shadow-[0_0_0_1.5px_var(--danger)]",
        )}
      >
        {hasDomains ? (
          // A fixed share of the row: the trigger fills whatever box it is
          // given, so the box sets the width.
          <span className="flex w-[42%] max-w-[210px] min-w-0 shrink-0">
            <MenuSelect
              label="Domain"
              value={form.domainId ?? ""}
              onChange={(v) => setForm({ ...form, domainId: v || null, slug: "" })}
              disabled={editing}
              className="h-10 min-w-0 rounded-l-lg rounded-r-none border-0 bg-surface font-mono text-[13px] [@media(hover:hover)]:hover:bg-surface-2"
              options={[
                { value: "", label: linkHost },
                ...activeDomains.map((d) => ({ value: d.id, label: d.hostname })),
              ]}
            />
          </span>
        ) : (
          <span className="flex max-w-[60%] min-w-0 shrink-0 items-center truncate rounded-l-lg bg-surface-2 px-3 font-mono text-[13px] text-muted">
            {linkHost}
          </span>
        )}
        <span
          aria-hidden
          className="grid w-[22px] shrink-0 place-items-center bg-surface font-mono text-sm text-placeholder shadow-[inset_1px_0_0_color-mix(in_oklab,var(--text)_8%,transparent),inset_-1px_0_0_color-mix(in_oklab,var(--text)_8%,transparent)]"
        >
          /
        </span>
        <span className="relative flex min-w-0 flex-1">
          <Input
            ref={slugRef}
            aria-label="Slug"
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? reasonId : undefined}
            value={form.slug ?? ""}
            onChange={(e) => setForm({ ...form, slug: e.target.value })}
            placeholder={slugLocked ? "random" : "launch-2026"}
            disabled={slugLocked}
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            className={cn(
              "h-10 min-w-0 flex-1 rounded-l-none font-mono text-[13px] shadow-none aria-invalid:shadow-none",
              error && "pr-8",
            )}
          />
          {error && <InvalidMark />}
        </span>
      </div>
      {hints.map((hint, i) => (
        // react-doctor-disable-next-line react-doctor/no-array-index-as-key -- a fixed list built each render, never reordered.
        <span key={i} className="mt-1.5 block text-xs text-muted">
          {hint}
        </span>
      ))}
    </div>
  );
}

function destinationHost(raw: string): string {
  const value = raw.trim();
  if (!value || /\s/.test(value)) return "";
  try {
    return new URL(/^[a-z][a-z0-9+.-]*:/i.test(value) ? value : `https://${value}`).hostname;
  } catch {
    return "";
  }
}

function LinkFormFields({
  form,
  setForm,
  editing,
  activeDomains,
  domainsAllowed,
  destinationRef,
  slugRef,
  destinationError,
  slugError,
}: {
  form: LinkInput;
  setForm: SetForm;
  editing: boolean;
  activeDomains: DomainDTO[];
  domainsAllowed: boolean;
  destinationRef: RefObject<HTMLInputElement | null>;
  slugRef: RefObject<HTMLInputElement | null>;
  destinationError?: LinkFieldError;
  slugError?: LinkFieldError;
}) {
  const toast = useToast();
  const host = destinationHost(form.destination);

  const onDestinationChange = (e: ChangeEvent<HTMLInputElement>) => {
    const destination = e.target.value;
    setForm({ ...form, destination, ...utmFromDestination(destination) });
  };

  // A paste with utm_* params shows the cleaned link at once: they move into the UTM
  // fields. A typed URL shows as typed (onDestinationChange) until it is stripped on save.
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
    <div className="flex min-w-0 flex-col gap-[18px]">
      <Field
        label="Destination"
        error={destinationError?.reason}
        errorDetail={destinationError?.detail}
      >
        <span className="relative block">
          {/* The CSP allows no remote images, so the site's letter stands in for its favicon. */}
          <span className="pointer-events-none absolute top-1/2 left-2.5 z-10 -translate-y-1/2">
            {host ? (
              <SiteLetter host={host} className="size-[22px] rounded-md text-[11px]" />
            ) : (
              <span className="grid size-[22px] place-items-center text-placeholder">
                <IconWorld size={15} aria-hidden />
              </span>
            )}
          </span>
          <Input
            ref={destinationRef}
            value={form.destination}
            onChange={onDestinationChange}
            onPaste={onDestinationPaste}
            // A URL keyboard on a text field: the form's own check marks the
            // field, where type="url" would have the browser refuse first in
            // a bubble of its own.
            inputMode="url"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            placeholder="https://example.com/launch"
            autoFocus={!editing}
            className="h-11 rounded-[10px] pl-10 font-mono text-[13.5px]"
          />
        </span>
      </Field>

      <ShortLinkField
        form={form}
        setForm={setForm}
        editing={editing}
        activeDomains={activeDomains}
        domainsAllowed={domainsAllowed}
        slugRef={slugRef}
        error={slugError}
      />

      <Field label="Title" optional>
        <Input
          value={form.title ?? ""}
          onChange={(e) => setForm({ ...form, title: e.target.value })}
          placeholder="Spring launch"
          className="h-10"
        />
      </Field>

      <UtmFields form={form} setForm={setForm} />
    </div>
  );
}

function lookOf(form: LinkInput, orgQr: OrgQr): QrLookValue {
  const look = resolveQrLook(form, orgQr);
  const ink = look.color || QR_DEFAULT_COLOR;
  return {
    dot: oneOf(QR_DOT_STYLES, look.dotStyle, "rounded"),
    corner: oneOf(QR_CORNER_STYLES, look.corner, QR_DEFAULT_CORNER),
    dotColor: ink,
    cornerColor: look.eyeColor || ink,
    bg: look.bg || QR_DEFAULT_BG,
    logo: look.logo ?? "",
    logoSize: look.logoSize ?? QR_DEFAULT_LOGO_SIZE,
  };
}

function LinkQrPreview({
  form,
  orgQr,
  previewUrl,
  size,
}: {
  form: LinkInput;
  orgQr: OrgQr;
  previewUrl: string;
  size: number;
}) {
  const look = resolveQrLook(form, orgQr);
  return (
    <div className="rounded-2xl bg-white p-3 smooth-shadow-ring-sm [&_[role=img]]:rounded-none [&_[role=img]]:border-0">
      <QRPreview
        url={previewUrl}
        logo={look.logo}
        dotStyle={look.dotStyle}
        color={look.color}
        corner={look.corner}
        eyeColor={look.eyeColor}
        bg={look.bg}
        logoSize={look.logoSize}
        size={size}
      />
    </div>
  );
}

function LinkSummary({
  form,
  host,
  opened,
}: {
  form: LinkInput;
  host: string;
  opened: ReturnType<typeof openedUrl>;
}) {
  const slug = form.slug?.trim();
  return (
    <dl className="flex min-w-0 flex-col gap-3">
      <div className="flex min-w-0 flex-col gap-0.5">
        <dt className="text-xs text-muted">Short link</dt>
        {/* A fixed min-h, so a long value does not grow the dialog a line per keystroke. */}
        <dd className="line-clamp-2 min-h-[2lh] font-mono text-[13px] font-bold [overflow-wrap:anywhere]">
          {host}/{slug || <span className="font-sans font-normal text-muted">(random)</span>}
        </dd>
      </div>
      <div className="flex min-w-0 flex-col gap-0.5">
        <dt className="text-xs text-muted">Opens</dt>
        <dd className="flex min-h-[4lh] flex-col font-mono text-[11.5px] leading-relaxed text-muted [overflow-wrap:anywhere]">
          {opened ? (
            <>
              <span className={opened.tags ? "line-clamp-2" : "line-clamp-4"}>{opened.base}</span>
              {opened.tags && <span className="line-clamp-2 text-text">{opened.tags}</span>}
            </>
          ) : (
            "Nothing yet"
          )}
        </dd>
      </div>
    </dl>
  );
}

function qrOverridesOf(form: LinkInput): Pick<LinkInput, (typeof QR_OVERRIDE_FIELDS)[number]> {
  return {
    qrStyle: form.qrStyle,
    qrColor: form.qrColor,
    qrCorner: form.qrCorner,
    qrEyeColor: form.qrEyeColor,
    qrBg: form.qrBg,
    qrLogo: form.qrLogo,
    qrLogoSize: form.qrLogoSize,
  };
}

function withoutQrOverrides(form: LinkInput): LinkInput {
  return {
    ...form,
    qrStyle: "",
    qrColor: "",
    qrCorner: "",
    qrEyeColor: "",
    qrBg: "",
    qrLogo: "",
    qrLogoSize: null,
  };
}

function Footer({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("flex items-center justify-end gap-1.5", className)}>{children}</div>;
}

const PHONE_FOOTER =
  "sticky bottom-0 z-10 bg-surface px-5 pt-3 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-[0_-1px_0_color-mix(in_oklab,var(--text)_8%,transparent)] sm:hidden";

const ASIDE =
  "flex min-w-0 flex-col gap-4 bg-bg px-5 pt-4 pb-6 max-sm:shadow-[inset_0_1px_0_color-mix(in_oklab,var(--text)_8%,transparent)] sm:shadow-[inset_1px_0_0_color-mix(in_oklab,var(--text)_8%,transparent)]";

// react-doctor-disable-next-line react-doctor/no-high-complexity-react-function, react-doctor/no-giant-component -- the form, the QR view and the preview share one form state; split tracked in #422.
export function LinkEditor({
  open,
  onOpenChange,
  editingLink,
  busy,
  onSave,
  onDelete,
  saveError,
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
  onDelete?: () => void;
  /** A failure the server pins on a field marks it, not a toast: check `linkFieldError(e)`. */
  saveError?: Error | null;
  activeDomains: DomainDTO[];
  /** Ignored when editing: that link already has an address. */
  defaultDomainId: string | null;
  /** Governs the shared-domain slug hint. */
  domainsAllowed: boolean;
  qrCustomEnabled: boolean;
  orgQr: OrgQr;
  shakeKey: number;
}) {
  const editing = editingLink != null;
  const shake = useShake();
  const destinationRef = useRef<HTMLInputElement>(null);
  const slugRef = useRef<HTMLInputElement>(null);
  const customizeRef = useRef<HTMLButtonElement>(null);
  const backRef = useRef<HTMLButtonElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  // The form's height as the QR view opened: the QR view is shorter, and a
  // centred dialog that shrank would jump up the screen under the pointer.
  const [formHeight, setFormHeight] = useState<number | undefined>();
  const [view, setView] = useState<"form" | "qr">("form");
  const [fieldError, setFieldError] = useState<LinkFieldError | null>(null);
  const qrBefore = useRef<ReturnType<typeof qrOverridesOf> | null>(null);
  // The logo's file name, known only for one picked in this session: the
  // API stores the uploaded file under an id. TODO(lead): store the name.
  const [logoName, setLogoName] = useState<string | undefined>();

  const {
    handleSubmit,
    watch,
    reset,
    setValue,
    getFieldState,
    formState: { errors, isSubmitted },
  } = useForm<LinkInput>({
    resolver: valibotResolver(linkInputSchema),
    defaultValues: defaultForm,
  });

  const newDomainId = resolveDefaultDomainId(defaultDomainId, activeDomains);

  // Deliberately not a dependency: the default is read when the dialog opens
  // and not again, so a background refetch of the org's domains cannot re-run
  // this and wipe whatever the person had already typed.
  useEffect(() => {
    if (open) {
      reset(editingLink ?? { ...defaultForm, domainId: newDomainId });
      // react-doctor-disable-next-line react-doctor/no-adjust-state-on-prop-change -- the dialog stays mounted to animate, so opening it is the reset.
      setView("form");
      // react-doctor-disable-next-line react-doctor/no-adjust-state-on-prop-change -- the dialog stays mounted to animate, so opening it is the reset.
      setFieldError(null);
      // react-doctor-disable-next-line react-doctor/no-adjust-state-on-prop-change -- the dialog stays mounted to animate, so opening it is the reset.
      setLogoName(undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editingLink, reset]);

  useEffect(() => {
    if (!open || editingLink || getFieldState("domainId").isDirty) return;
    setValue("domainId", newDomainId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newDomainId]);

  const switched = useRef(false);
  useEffect(() => {
    if (!switched.current) return;
    switched.current = false;
    (view === "qr" ? backRef : customizeRef).current?.focus();
  }, [view]);
  const showView = (next: "form" | "qr") => {
    switched.current = true;
    setView(next);
  };

  const markField = (error: LinkFieldError) => {
    setFieldError(error);
    shake.start();
    setView("form");
    requestAnimationFrame(() => {
      const el = (error.field === "slug" ? slugRef : destinationRef).current;
      el?.scrollIntoView({ block: "center", behavior: "smooth" });
      el?.focus();
    });
  };

  const lastShakeKey = useRef(shakeKey);
  useEffect(() => {
    if (shakeKey !== lastShakeKey.current) {
      lastShakeKey.current = shakeKey;
      shake.start();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shakeKey]);

  useEffect(() => {
    if (!saveError) return;
    const pinned = linkFieldError(saveError);
    if (pinned) markField(pinned);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saveError]);

  const form = watch();
  // setValue, not reset(next): reset re-registers and revalidates every field, and a
  // fast typist ("https://") can outrun it and land a keystroke on a stale render.
  const setForm = (next: LinkInput) => {
    // SAFETY: `next` is typed LinkInput, a fully-defined object type, so
    // Object.keys(next) can only return its own declared keys.
    (Object.keys(next) as (keyof LinkInput)[]).forEach((key) => {
      if (next[key] === form[key]) return;
      setValue(key, next[key], { shouldDirty: true, shouldValidate: isSubmitted });
      if (fieldError?.field === key) setFieldError(null);
      if (key === "domainId" && fieldError?.field === "slug") setFieldError(null);
    });
  };

  // Sends what it loaded: clearing QR fields on a plan without qrCustom silently
  // destroyed a link's logo and colours (#162).
  const save = (data: LinkInput) => {
    if (!isWebAddress(data.destination.trim())) {
      markField({
        field: "destination",
        reason: "Not a web address",
        detail: "Enter a full address, like https://example.com/menu",
      });
      return;
    }
    onSave(data);
  };

  const onInvalid: SubmitErrorHandler<LinkInput> = (errors) => {
    if (!errors.destination) return shake.start();
    markField({
      field: "destination",
      reason: form.destination.trim() ? "Not a web address" : "Required",
      detail: form.destination.trim()
        ? "Enter a full address, like https://example.com/menu"
        : "Enter the address this link opens",
    });
  };
  const destinationError =
    fieldError?.field === "destination"
      ? fieldError
      : errors.destination
        ? {
            field: "destination" as const,
            reason: form.destination.trim() ? "Not a web address" : "Required",
            detail: errors.destination.message ?? "Enter a valid URL",
          }
        : undefined;
  const slugError = fieldError?.field === "slug" ? fieldError : undefined;

  const selectedDomain = activeDomains.find((d) => d.id === form.domainId)?.hostname ?? null;
  const linkHost = useLinkHost();

  const previewUrl = useMemo(
    () => shortUrl(form.slug?.trim() || "preview", selectedDomain, linkHost),
    [form.slug, selectedDomain, linkHost],
  );
  const opened = openedUrl(form);
  const look = lookOf(form, orgQr);

  const openQr = () => {
    qrBefore.current = qrOverridesOf(form);
    setFormHeight(formRef.current?.offsetHeight);
    showView("qr");
  };
  const cancelQr = () => {
    if (qrBefore.current) setForm({ ...form, ...qrBefore.current });
    showView("form");
  };
  const applyQr = (patch: QrPatch, fileName?: string) => {
    if (fileName) setLogoName(fileName);
    if (patch.qrLogo === "") setLogoName(undefined);
    setForm({ ...form, ...patch });
  };

  const formActions = (
    <>
      {editing && onDelete && (
        <Button variant="danger" onClick={onDelete} className="mr-auto px-2.5">
          Delete
        </Button>
      )}
      <Button
        variant="ghost"
        onClick={() => onOpenChange(false)}
        className={cn(editing && onDelete && "px-2.5")}
      >
        Cancel
      </Button>
      <Button
        variant="primary"
        type="submit"
        disabled={busy}
        className={cn("whitespace-nowrap", shake.className)}
        onAnimationEnd={shake.end}
      >
        <BusyContent busy={busy}>{editing ? "Save changes" : "Create link"}</BusyContent>
      </Button>
    </>
  );
  const qrActions = (
    <>
      <button
        type="button"
        onClick={() => setForm(withoutQrOverrides(form))}
        disabled={!hasQrOverrides(form)}
        className="mr-auto cursor-pointer text-xs text-muted underline decoration-from-font underline-offset-2 disabled:cursor-default disabled:no-underline disabled:opacity-50 enabled:[@media(hover:hover)]:hover:text-text"
      >
        Reset
      </button>
      <Button variant="ghost" onClick={cancelQr}>
        Cancel
      </Button>
      <Button variant="primary" onClick={() => showView("form")}>
        Done
      </Button>
    </>
  );
  const title = editing ? "Edit link" : "New link";
  const heldHeight: CSSProperties & { "--form-h"?: string } =
    view === "qr" && formHeight ? { "--form-h": `${formHeight}px` } : {};

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={title} size="xl" bare>
      <form
        ref={formRef}
        onSubmit={handleSubmit(save, onInvalid)}
        noValidate
        // Desktop only: a phone sheet grows from the bottom edge, so a shorter
        // view does not move what is under the thumb.
        style={heldHeight}
        className="grid min-h-full sm:min-h-[var(--form-h,0px)] sm:grid-cols-[minmax(0,1fr)_280px]"
      >
        {view === "form" ? (
          <>
            <div className="flex min-w-0 flex-col gap-[18px] px-5 pt-3 pb-6 sm:px-6 sm:pt-5">
              <div className="flex min-h-8 items-center gap-2">
                <DialogTitle className="flex-1">{title}</DialogTitle>
                <DialogClose className="-mr-1.5 sm:hidden" />
              </div>
              <LinkFormFields
                form={form}
                setForm={setForm}
                editing={editing}
                activeDomains={activeDomains}
                domainsAllowed={domainsAllowed}
                destinationRef={destinationRef}
                slugRef={slugRef}
                destinationError={destinationError}
                slugError={slugError}
              />
            </div>
            <aside className={ASIDE}>
              <div className="flex justify-end max-sm:hidden">
                <DialogClose className="-mr-1.5" />
              </div>
              <div className="flex flex-col items-center gap-3">
                <LinkQrPreview
                  form={form}
                  orgQr={orgQr}
                  previewUrl={previewUrl}
                  size={QR_PREVIEW_SIZE}
                />
                {qrCustomEnabled ? (
                  <Button ref={customizeRef} size="sm" onClick={openQr}>
                    <QrCode size={14} aria-hidden /> Customize QR
                  </Button>
                ) : (
                  <QrCustomizationUpsell locked={hasQrOverrides(form)} />
                )}
              </div>
              <LinkSummary form={form} host={selectedDomain ?? linkHost} opened={opened} />
              <Footer className="mt-auto pt-1 max-sm:hidden">{formActions}</Footer>
            </aside>
            <Footer className={PHONE_FOOTER}>{formActions}</Footer>
          </>
        ) : (
          <>
            <div className="flex min-w-0 flex-col gap-1.5 px-5 pt-3 pb-4 sm:px-6 sm:pt-5">
              <DialogTitle className="sr-only">{title}</DialogTitle>
              <div className="mb-1 flex min-h-8 items-center gap-1.5">
                <button
                  ref={backRef}
                  type="button"
                  onClick={() => showView("form")}
                  aria-label="Back to the link"
                  className="-ml-2 grid size-8 cursor-pointer place-items-center rounded-md text-muted transition-colors focus-visible:outline-2 focus-visible:outline-accent [@media(hover:hover)]:hover:bg-surface-2 [@media(hover:hover)]:hover:text-text"
                >
                  <IconChevronLeft size={16} aria-hidden />
                </button>
                <h2 className="flex-1 text-base font-semibold">QR code</h2>
                <DialogClose className="-mr-1.5 sm:hidden" />
              </div>
              <QrEditorRows
                look={look}
                onChange={applyQr}
                inherited={{ dot: !form.qrStyle, corner: !form.qrCorner }}
                logoName={
                  logoName ?? (form.qrLogo ? "This link's logo" : "Your organization's logo")
                }
                logoLockedOn={
                  !form.qrLogo && orgQr.logo
                    ? "Every QR code carries your organization's logo. Turn it off on Organization."
                    : undefined
                }
              />
            </div>
            <aside className={ASIDE}>
              <div className="flex justify-end max-sm:hidden">
                <DialogClose className="-mr-1.5" />
              </div>
              <div className="flex flex-col items-center gap-3">
                <LinkQrPreview
                  form={form}
                  orgQr={orgQr}
                  previewUrl={previewUrl}
                  size={QR_PREVIEW_SIZE}
                />
                <QrContrastNote look={look} />
              </div>
              <Footer className="mt-auto pt-1 max-sm:hidden">{qrActions}</Footer>
            </aside>
            <Footer className={PHONE_FOOTER}>{qrActions}</Footer>
          </>
        )}
      </form>
    </Dialog>
  );
}
