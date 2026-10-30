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
import { Lock, Plus, QrCode } from "@/app/ui/icons";
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
import { QrContrastNote, QrEditorRows, type QrLookValue, type QrPatch } from "./qr-pickers";
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

/** The link's own QR look, as opposed to the organization's defaults. The
 * server refuses these outright on a plan without qrCustom. */
const QR_OVERRIDE_FIELDS = [
  "qrStyle",
  "qrColor",
  "qrCorner",
  "qrEyeColor",
  "qrBg",
  "qrLogo",
  "qrLogoSize",
] as const;

/** Whether this link already carries a QR look of its own, so the editor can
 * say it is kept and locked rather than showing an upsell for a feature the
 * link is visibly using (#162). */
function hasQrOverrides(data: LinkInput): boolean {
  return QR_OVERRIDE_FIELDS.some((field) =>
    field === "qrLogoSize" ? data.qrLogoSize != null : !!data[field],
  );
}

/** The three tags people set on almost every link, shown at once; term and
 * content sit behind one line until somebody wants them. */
const UTM_MAIN: { key: UtmKey; label: string; placeholder: string }[] = [
  { key: "utmSource", label: "Source", placeholder: "newsletter" },
  { key: "utmMedium", label: "Medium", placeholder: "email" },
  { key: "utmCampaign", label: "Campaign", placeholder: "spring-sale" },
];
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

/** UTM params already in the pasted/typed URL, mirroring the server's
 * resolveUtm: params present in the destination win over whatever is in
 * the form fields. A param that's present but empty still wins (so
 * backspacing its value out clears the field instead of leaving a stale
 * one behind); a param that's absent leaves the field alone. */
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

/** Where the link will send people, split so the tags it adds can be told
 * from the address that was typed. Mirrors the save: the destination with
 * its own utm_* params dropped, then the fields' values added. */
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

/** UTM tags inline, because people change them more than anything else on
 * a link. Term and content open on request, and stay open once either has a
 * value, so nothing set is ever out of sight. */
function UtmFields({
  form,
  setForm,
  showMore,
  onShowMore,
}: {
  form: LinkInput;
  setForm: SetForm;
  showMore: boolean;
  onShowMore: () => void;
}) {
  const open = showMore || !!form.utmTerm || !!form.utmContent;
  return (
    <fieldset className="flex min-w-0 flex-col gap-2">
      <legend className="mb-2 flex w-full items-baseline justify-between gap-3">
        <span className="text-sm font-semibold">UTM tags</span>
        <span className="text-xs text-muted">Added to the destination</span>
      </legend>
      <div className="grid grid-cols-1 gap-2 min-[420px]:grid-cols-3">
        {UTM_MAIN.map((f) => (
          <UtmInput key={f.key} field={f} form={form} setForm={setForm} />
        ))}
      </div>
      {open ? (
        <div className="grid grid-cols-1 gap-2 min-[420px]:grid-cols-2">
          {UTM_MORE.map((f) => (
            <UtmInput key={f.key} field={f} form={form} setForm={setForm} />
          ))}
        </div>
      ) : (
        <button
          type="button"
          onClick={onShowMore}
          aria-expanded={false}
          className="-ml-1 flex h-8 w-fit cursor-pointer items-center gap-1 rounded-md px-1 text-xs text-muted transition-colors [@media(hover:hover)]:hover:text-text"
        >
          <Plus size={13} aria-hidden /> Term and content
        </button>
      )}
    </fieldset>
  );
}

/**
 * What sits under the QR on a plan without `qrCustom`.
 *
 * Two different sentences, because they are two different situations. A link
 * with no styling is being offered a feature. A link that already has some,
 * on an org that downgraded, is keeping it: saying "add your logo on a paid
 * plan" to somebody whose logo is right there in the preview reads as a bug.
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

/** The short link as a domain and a slug joined by a slash. Chosen slugs
 * only exist on custom domains, so on the shared one the slug is locked. */
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
      {/* One ring around the three parts, the way one field reads as one. */}
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

/** The host a destination points at, for its letter tile, or "" while it is
 * not an address yet. */
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
  showMoreUtm,
  onShowMoreUtm,
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
  showMoreUtm: boolean;
  onShowMoreUtm: () => void;
}) {
  const toast = useToast();
  const host = destinationHost(form.destination);

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
    <div className="flex min-w-0 flex-col gap-[18px]">
      <Field
        label="Destination"
        error={destinationError?.reason}
        errorDetail={destinationError?.detail}
      >
        <span className="relative block">
          {/* The site's letter stands in for its favicon: the CSP allows no
              remote images. A globe until there is a site to name. */}
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

      <UtmFields form={form} setForm={setForm} showMore={showMoreUtm} onShowMore={onShowMoreUtm} />
    </div>
  );
}

/** What the code is drawn with: the link's own look over the org's, every
 * value concrete. */
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

/** The code on a white card, the way it prints. */
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

/** The side column's text: the short link, and where it opens. */
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
        <dd className="font-mono text-[13px] font-bold [overflow-wrap:anywhere]">
          {host}/{slug || <span className="font-sans font-normal text-muted">(random)</span>}
        </dd>
      </div>
      <div className="flex min-w-0 flex-col gap-0.5">
        <dt className="text-xs text-muted">Opens</dt>
        <dd className="font-mono text-[11.5px] leading-relaxed text-muted [overflow-wrap:anywhere]">
          {opened ? (
            <>
              {opened.base}
              <span className="text-text">{opened.tags}</span>
            </>
          ) : (
            "Nothing yet"
          )}
        </dd>
      </div>
    </dl>
  );
}

/** The link's own QR fields, to put back on Cancel. */
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

/** The link with every QR override cleared: back to the org's look. */
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

/** The buttons along the bottom: on a desktop the foot of the side column,
 * on a phone pinned to the sheet's bottom edge. */
function Footer({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("flex items-center justify-end gap-1.5", className)}>{children}</div>;
}

// A phone sheet scrolls as one; this keeps its buttons on its bottom edge.
const PHONE_FOOTER =
  "sticky bottom-0 z-10 bg-surface px-5 pt-3 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-[0_-1px_0_color-mix(in_oklab,var(--text)_8%,transparent)] sm:hidden";

// The side column: the paper colour, split from the form by a hairline.
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
  /** Shows Delete at the left of the footer, when editing. The caller opens
   * its own confirmation. */
  onDelete?: () => void;
  /**
   * The last save's failure. One the server pins on a field (a destination
   * it refuses, a slug that is taken) marks that field instead of a toast:
   * check `linkFieldError(e)` before toasting it yourself.
   */
  saveError?: Error | null;
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
  const shake = useShake();
  const destinationRef = useRef<HTMLInputElement>(null);
  const slugRef = useRef<HTMLInputElement>(null);
  const customizeRef = useRef<HTMLButtonElement>(null);
  const backRef = useRef<HTMLButtonElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  // The form's height as the QR view opened: the QR view is shorter, and a
  // centred dialog that shrank would jump up the screen under the pointer.
  const [formHeight, setFormHeight] = useState<number | undefined>();
  // The QR editor replaces the form in the same dialog, with a way back.
  const [view, setView] = useState<"form" | "qr">("form");
  const [showMoreUtm, setShowMoreUtm] = useState(false);
  // A refusal pinned on a field: by the server, or by the same address test
  // run here first. Cleared as soon as that field changes.
  const [fieldError, setFieldError] = useState<LinkFieldError | null>(null);
  // The QR look as it was when the QR view opened, for its Cancel.
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

  // A new link starts on the org's default domain, which also unlocks the
  // slug field: chosen slugs only exist on custom domains, so the customer
  // who set a default is exactly the one who wants to name their links.
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
      setShowMoreUtm(false);
      // react-doctor-disable-next-line react-doctor/no-adjust-state-on-prop-change -- the dialog stays mounted to animate, so opening it is the reset.
      setFieldError(null);
      // react-doctor-disable-next-line react-doctor/no-adjust-state-on-prop-change -- the dialog stays mounted to animate, so opening it is the reset.
      setLogoName(undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editingLink, reset]);

  // The org's domains can arrive after the dialog opened (New link pressed
  // straight after a reload). Until somebody picks a domain, follow the
  // default as it resolves; once they pick, leave their choice alone.
  useEffect(() => {
    if (!open || editingLink || getFieldState("domainId").isDirty) return;
    setValue("domainId", newDomainId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newDomainId]);

  // Focus follows the view switch: into the QR editor's back button, and
  // home to the button that opened it on the way back.
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

  /** Marks one field, says why in its label row, and puts focus on it. */
  const markField = (error: LinkFieldError) => {
    setFieldError(error);
    shake.start();
    setView("form");
    // After the view has rendered, so the field exists to take focus.
    requestAnimationFrame(() => {
      const el = (error.field === "slug" ? slugRef : destinationRef).current;
      el?.scrollIntoView({ block: "center", behavior: "smooth" });
      el?.focus();
    });
  };

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

  // A refusal the server pinned on a field lands on that field.
  useEffect(() => {
    if (!saveError) return;
    const pinned = linkFieldError(saveError);
    if (pinned) markField(pinned);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saveError]);

  const form = watch();
  // Every call site passes the full next LinkInput (spreading the current
  // `form` and overriding one or a few keys), which made reset(next) look
  // like the obvious fit — but reset() re-registers and revalidates every
  // field in the form, not just the one that changed. On a destination
  // field it's cheap enough per keystroke to be invisible; it's still the
  // wrong tool, so a fast typist hitting it 5+ times a second (typing
  // "https://" is exactly that, back-to-back identical characters) can
  // outrun it and land a keystroke against a stale re-render. setValue
  // updates just the fields that actually changed. After a failed submit it
  // also re-checks them, so a fixed field drops its mark as it is fixed.
  const setForm = (next: LinkInput) => {
    // SAFETY: `next` is typed LinkInput, a fully-defined object type, so
    // Object.keys(next) can only return its own declared keys.
    (Object.keys(next) as (keyof LinkInput)[]).forEach((key) => {
      if (next[key] === form[key]) return;
      setValue(key, next[key], { shouldDirty: true, shouldValidate: isSubmitted });
      if (fieldError?.field === key) setFieldError(null);
      // A new domain is a new namespace: a slug taken on the old one says
      // nothing about this one.
      if (key === "domainId" && fieldError?.field === "slug") setFieldError(null);
    });
  };

  // Sends what it loaded. Clearing the QR fields on a plan without qrCustom
  // was how a title edit silently destroyed a link's logo and colours (#162);
  // the server now only refuses a save that *changes* them.
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

  // A form error marks its field (rdyrct-design): the reason in the label
  // row, focus on the field, and the button shakes. No toast.
  const onInvalid: SubmitErrorHandler<LinkInput> = (errors) => {
    // destination is the only field this schema can reject.
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
        <Button
          variant="ghost"
          onClick={onDelete}
          // Its padding tucked under the column's edge, so three buttons
          // fit the 240px the side column leaves them.
          className="-ml-2 mr-auto px-2 text-danger [@media(hover:hover)]:hover:bg-danger/10 [@media(hover:hover)]:hover:text-danger"
        >
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
                showMoreUtm={showMoreUtm}
                onShowMoreUtm={() => setShowMoreUtm(true)}
              />
            </div>
            <aside className={ASIDE}>
              <div className="flex justify-end max-sm:hidden">
                <DialogClose className="-mr-1.5" />
              </div>
              <div className="flex flex-col items-center gap-3">
                <LinkQrPreview form={form} orgQr={orgQr} previewUrl={previewUrl} size={156} />
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
              {/* The dialog keeps its name (New link) for assistive tech;
                  what shows is where you are inside it. */}
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
                <LinkQrPreview form={form} orgQr={orgQr} previewUrl={previewUrl} size={168} />
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
