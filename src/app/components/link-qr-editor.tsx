/**
 * The link editor's QR view: what "Customize QR" opens, in the same dialog
 * (rdyrct-design, "Creating is a dialog"). Rows, not boxes: the shape
 * pickers are small drawings of the shape, the colors are native pickers.
 *
 * Every value here is an override. An empty one inherits the organization's
 * default, which is what the pressed tile and the swatch show until somebody
 * picks something of their own.
 */
import type { ReactNode } from "react";
import { Info } from "@/app/ui/icons";
import { QR_CORNER_STYLES, QR_DEFAULT_CORNER, QR_DOT_STYLES, type LinkInput } from "@/shared/types";
import { oneOf } from "@/shared/lookup";
import { cn } from "../ui/cn";
import { Tooltip } from "../ui/tooltip";
import { hasTransparency } from "../lib/qr-look";
import { qrFallbacks, type OrgQr } from "../lib/org-qr";
import { QrLogoInput } from "./qr-logo-input";

type DotStyle = (typeof QR_DOT_STYLES)[number];
type CornerStyle = (typeof QR_CORNER_STYLES)[number];

const DOT_NAMES = {
  rounded: "Rounded",
  square: "Square",
  dots: "Dots",
  classy: "Classy",
  "classy-rounded": "Classy rounded",
  "extra-rounded": "Extra rounded",
} satisfies Record<DotStyle, string>;

const CORNER_NAMES = {
  "extra-rounded": "Extra rounded",
  rounded: "Rounded",
  dot: "Dot",
  square: "Square",
  classy: "Classy",
} satisfies Record<CornerStyle, string>;

const LOGO_SIZES = [
  { value: "", short: "Auto", name: "Organization default" },
  { value: "0.25", short: "S", name: "Small" },
  { value: "0.35", short: "M", name: "Medium" },
  { value: "0.5", short: "L", name: "Large" },
  { value: "0.65", short: "XL", name: "Extra large" },
] as const;

/** A rect path with its own radius per corner: top left, top right, bottom
 * right, bottom left. */
function roundedRect(
  x: number,
  y: number,
  w: number,
  h: number,
  [a, b, c, d]: [number, number, number, number],
) {
  return `M${x + a},${y} H${x + w - b} Q${x + w},${y} ${x + w},${y + b} V${y + h - c} Q${x + w},${y + h} ${x + w - c},${y + h} H${x + d} Q${x},${y + h} ${x},${y + h - d} V${y + a} Q${x},${y} ${x + a},${y} Z`;
}

function dotPath(style: DotStyle, x: number, y: number, z: number) {
  const all = (r: number): [number, number, number, number] => [r, r, r, r];
  switch (style) {
    case "square":
      return roundedRect(x, y, z, z, all(0));
    case "rounded":
      return roundedRect(x, y, z, z, all(z * 0.3));
    case "extra-rounded":
      return roundedRect(x, y, z, z, all(z * 0.5));
    case "classy":
      return roundedRect(x, y, z, z, [z * 0.5, 0, z * 0.5, 0]);
    case "classy-rounded":
      return roundedRect(x, y, z, z, [z * 0.5, z * 0.15, z * 0.5, z * 0.15]);
    case "dots":
      return `M${x + z / 2},${y + z * 0.08} a${z * 0.42},${z * 0.42} 0 1,0 0.01,0 Z`;
  }
}

/** Five modules in an X, drawn in the style: enough to tell them apart. */
function DotGlyph({ style }: { style: DotStyle }) {
  const cells = [
    [0, 0],
    [2, 0],
    [1, 1],
    [0, 2],
    [2, 2],
  ];
  return (
    <svg width="20" height="20" viewBox="0 0 30 30" fill="currentColor" aria-hidden>
      <path d={cells.map(([c, r]) => dotPath(style, 1 + c * 10, 1 + r * 10, 8)).join(" ")} />
    </svg>
  );
}

/** A finder pattern (the "eye") in the style. */
function CornerGlyph({ style }: { style: CornerStyle }) {
  const radii = {
    square: [0, 0],
    rounded: [5, 2],
    "extra-rounded": [9, 3],
    dot: [14, 4.5],
    classy: [0, 0],
  } satisfies Record<CornerStyle, [number, number]>;
  const [o, i] = radii[style];
  const outer =
    style === "classy"
      ? roundedRect(2, 2, 26, 26, [9, 0, 9, 0])
      : roundedRect(2, 2, 26, 26, [o, o, o, o]);
  const inner =
    style === "classy"
      ? roundedRect(10, 10, 10, 10, [4, 0, 4, 0])
      : roundedRect(10, 10, 10, 10, [i, i, i, i]);
  return (
    <svg width="20" height="20" viewBox="0 0 30 30" aria-hidden>
      <path d={outer} fill="none" stroke="currentColor" strokeWidth="3.5" />
      <path d={inner} fill="currentColor" />
    </svg>
  );
}

/** One row: the name and what it is set to on the left, the control on the
 * right, and anything wide (the logo dropzone) underneath. */
function QrRow({
  title,
  sub,
  children,
  below,
}: {
  title: ReactNode;
  sub?: string;
  children?: ReactNode;
  below?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 py-3.5">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <div className="text-sm font-semibold">{title}</div>
          {sub && <p className="text-xs text-muted">{sub}</p>}
        </div>
        {children}
      </div>
      {below}
    </div>
  );
}

/** Mutually exclusive tiles, each named for a screen reader and on hover. */
function TilePicker<V extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: readonly { value: V; name: string; face: ReactNode }[];
  value: string;
  onChange: (value: V) => void;
}) {
  return (
    // Radii nest: a 12px track, 2px of padding, 10px tiles.
    <div
      role="group"
      aria-label={label}
      className="flex w-fit max-w-full flex-wrap gap-0.5 rounded-xl bg-surface-2 p-0.5"
    >
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            aria-label={o.name}
            title={o.name}
            aria-pressed={on}
            onClick={() => onChange(o.value)}
            className={cn(
              "grid h-10 min-w-10 cursor-pointer place-items-center rounded-[10px] px-2 text-xs transition-[color,background-color] duration-150 focus-visible:outline-2 focus-visible:outline-accent",
              on
                ? "bg-surface font-semibold text-text smooth-shadow-ring-xs"
                : "text-muted [@media(hover:hover)]:hover:text-text",
            )}
          >
            {o.face}
          </button>
        );
      })}
    </div>
  );
}

/** "#rrggbb" for the native picker, which takes nothing else: an alpha byte
 * and the legacy "transparent" are dropped. */
function toHex6(color: string): string {
  if (/^#[0-9a-fA-F]{6}/.test(color)) return color.slice(0, 7).toLowerCase();
  return "#ffffff";
}

function ColorPick({
  label,
  value,
  fallback,
  onChange,
}: {
  label: string;
  value: string;
  fallback: string;
  onChange: (value: string) => void;
}) {
  const hex = toHex6(value || fallback);
  return (
    <label className="flex h-10 min-w-0 cursor-pointer items-center gap-2 rounded-lg bg-surface pr-2.5 pl-2 smooth-shadow-ring-xs focus-within:shadow-[0_0_0_1.5px_var(--accent),0_0_0_4px_color-mix(in_oklab,var(--accent)_25%,transparent)]">
      <input
        type="color"
        value={hex}
        onChange={(e) => onChange(e.target.value)}
        aria-label={`${label} color`}
        className="size-6 shrink-0 cursor-pointer rounded-md border-0 bg-transparent p-0 outline-none [&::-moz-color-swatch]:rounded-md [&::-moz-color-swatch]:border-0 [&::-webkit-color-swatch]:rounded-md [&::-webkit-color-swatch]:border-0 [&::-webkit-color-swatch]:shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--text)_22%,transparent)] [&::-moz-color-swatch]:shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--text)_22%,transparent)] [&::-webkit-color-swatch-wrapper]:p-0"
      />
      <span className="flex min-w-0 flex-col leading-tight">
        <span className="text-xs text-muted">{label}</span>
        <span className="font-mono text-xs uppercase">{hex}</span>
      </span>
    </label>
  );
}

/** The org's own value for a field this link leaves empty, named. */
function inherited(name: string | undefined, own: boolean) {
  if (!name) return undefined;
  return own ? name : `${name} (organization default)`;
}

// The pickers sit under their names, not beside them: the name line changes
// length as you pick, and a picker beside it would jump between lines.
function StyleRows({ form, setForm, orgQr }: QrEditorProps) {
  const dot = oneOf(QR_DOT_STYLES, form.qrStyle || orgQr.style, "rounded");
  const corner = oneOf(QR_CORNER_STYLES, form.qrCorner || orgQr.corner, QR_DEFAULT_CORNER);
  return (
    <>
      <QrRow
        title="Dots"
        sub={inherited(DOT_NAMES[dot], !!form.qrStyle)}
        below={
          <TilePicker
            label="Dots"
            value={dot}
            onChange={(v) => setForm({ ...form, qrStyle: v })}
            options={QR_DOT_STYLES.map((s) => ({
              value: s,
              name: DOT_NAMES[s],
              face: <DotGlyph style={s} />,
            }))}
          />
        }
      />
      <QrRow
        title="Corners"
        sub={inherited(CORNER_NAMES[corner], !!form.qrCorner)}
        below={
          <TilePicker
            label="Corners"
            value={corner}
            onChange={(v) => setForm({ ...form, qrCorner: v })}
            options={QR_CORNER_STYLES.map((s) => ({
              value: s,
              name: CORNER_NAMES[s],
              face: <CornerGlyph style={s} />,
            }))}
          />
        }
      />
    </>
  );
}

function ColorRow({ form, setForm, orgQr }: QrEditorProps) {
  const fallbacks = qrFallbacks(form, orgQr);
  const bg = form.qrBg || fallbacks.bg;
  const seeThrough = hasTransparency(bg);
  return (
    <QrRow
      title="Colors"
      below={
        <div className="flex flex-col gap-2.5">
          <div className="grid grid-cols-1 gap-2 min-[420px]:grid-cols-3">
            <ColorPick
              label="Dots"
              value={form.qrColor ?? ""}
              fallback={fallbacks.dotColor}
              onChange={(v) => setForm({ ...form, qrColor: v })}
            />
            <ColorPick
              label="Corners"
              value={form.qrEyeColor ?? ""}
              fallback={fallbacks.eyeColor}
              onChange={(v) => setForm({ ...form, qrEyeColor: v })}
            />
            <ColorPick
              label="Background"
              value={seeThrough ? "" : (form.qrBg ?? "")}
              fallback={toHex6(bg)}
              onChange={(v) => setForm({ ...form, qrBg: v })}
            />
          </div>
          <label className="flex w-fit cursor-pointer items-center gap-2 text-xs text-muted">
            <input
              type="checkbox"
              checked={seeThrough}
              onChange={(e) =>
                // Fully transparent is stored as 8-digit hex with a zero alpha,
                // the same value the org defaults' alpha slider writes.
                setForm({ ...form, qrBg: e.target.checked ? `${toHex6(bg)}00` : toHex6(bg) })
              }
              className="size-4 cursor-pointer accent-accent"
            />
            Transparent background
          </label>
        </div>
      }
    />
  );
}

function LogoRow({ form, setForm, orgQr }: QrEditorProps) {
  const sub = form.qrLogo ? "This link's own" : orgQr.logo ? "Organization default" : "None";
  const size = form.qrLogoSize == null ? "" : String(form.qrLogoSize);
  return (
    <QrRow
      title={
        <span className="flex items-center gap-1.5">
          Logo
          <Tooltip content="Sits in the middle of the code. A bigger logo hides more of the dots, and past a point a scanner cannot fill in what is missing. Leave it empty to use your organization's logo.">
            <button
              type="button"
              aria-label="About QR logos"
              className="relative cursor-help font-normal text-muted after:absolute after:-inset-1.5 hover:text-text"
            >
              <Info size={13} />
            </button>
          </Tooltip>
        </span>
      }
      sub={sub}
      below={
        <QrLogoInput
          value={form.qrLogo ?? ""}
          onLoad={(url) => setForm({ ...form, qrLogo: url })}
          onClear={() => setForm({ ...form, qrLogo: "" })}
        />
      }
    >
      <TilePicker
        label="Logo size"
        value={size}
        onChange={(v) => setForm({ ...form, qrLogoSize: v === "" ? null : Number(v) })}
        options={LOGO_SIZES.map((s) => ({ value: s.value, name: s.name, face: s.short }))}
      />
    </QrRow>
  );
}

interface QrEditorProps {
  form: LinkInput;
  setForm: (f: LinkInput) => void;
  orgQr: OrgQr;
}

/** All of a link's QR options, as rows. */
export function LinkQrEditor(props: QrEditorProps) {
  return (
    <fieldset className="min-w-0">
      <legend className="sr-only">QR customization</legend>
      <div className="flex flex-col [&>*+*]:shadow-[inset_0_1px_0_var(--border)]">
        <StyleRows {...props} />
        <ColorRow {...props} />
        <LogoRow {...props} />
      </div>
    </fieldset>
  );
}

/** The link with every QR override cleared: back to the org's look. */
export function withoutQrOverrides(form: LinkInput): LinkInput {
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
