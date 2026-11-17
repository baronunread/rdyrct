// qr-code-styling paints one `<rect>` through a clipPath of every module. A renderer
// antialiases each shared edge, so a scaled SVG shows a pale grid. Merging the modules
// into one `<path>` leaves no interior edges.
const SVG_NS = "http://www.w3.org/2000/svg";

type Point = [number, number];
import { lookup } from "@/shared/lookup";

type Turn = (x: number, y: number) => Point;
interface Place {
  spin: Turn;
  around: Turn;
}

const TURNS = {
  0: (x, y) => [x, y],
  90: (x, y) => [-y, x],
  180: (x, y) => [-x, -y],
  270: (x, y) => [y, -x],
} satisfies Record<number, Turn>;

const ROTATE = /rotate\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\)/;

function placement(el: Element): Place | null {
  const found = ROTATE.exec(el.getAttribute("transform") ?? "");
  const [angle, cx, cy] = found ? found.slice(1).map(Number) : [0, 0, 0];
  const spin = lookup(TURNS, ((angle % 360) + 360) % 360);
  if (!spin) return null;
  return {
    spin,
    around: (x, y) => {
      const [dx, dy] = spin(x - cx, y - cy);
      return [cx + dx, cy + dy];
    },
  };
}

function num(el: Element, name: string): number {
  return Number(el.getAttribute(name) ?? 0);
}

function rectSubpath(el: Element, { around }: Place): string {
  const x = num(el, "x");
  const y = num(el, "y");
  const right = x + num(el, "width");
  const bottom = y + num(el, "height");
  const corners: Point[] = [
    [x, y],
    [right, y],
    [right, bottom],
    [x, bottom],
  ];
  return `M${corners.map((corner) => around(...corner).join(" ")).join("L")}Z`;
}

function circleSubpath(el: Element, { around }: Place): string {
  const r = num(el, "r");
  const [cx, cy] = around(num(el, "cx"), num(el, "cy"));
  return `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${r * 2} 0a${r} ${r} 0 1 0 ${r * -2} 0Z`;
}

// A turned horizontal is no longer horizontal, so `h` and `v` both become `l`.
const COMMANDS = {
  M: (n, { around }) => `M${around(n[0], n[1]).join(" ")}`,
  h: (n, { spin }) => `l${spin(n[0], 0).join(" ")}`,
  v: (n, { spin }) => `l${spin(0, n[0]).join(" ")}`,
  a: (n, { spin }) => `a${n[0]} ${n[1]} 0 ${n[3]} ${n[4]} ${spin(n[5], n[6]).join(" ")}`,
  z: () => "Z",
  Z: () => "Z",
} satisfies Record<string, (n: number[], place: Place) => string>;

const SEGMENT = /[A-Za-z][^A-Za-z]*/g;

function segments(el: Element): string[] {
  return (el.getAttribute("d") ?? "").match(SEGMENT) ?? [];
}

function numbers(segment: string): number[] {
  return (segment.slice(1).match(/-?[\d.]+/g) ?? []).map(Number);
}

function pathSubpath(el: Element, place: Place): string | null {
  const written = segments(el).map((segment) =>
    lookup(COMMANDS, segment[0])?.(numbers(segment), place),
  );
  return written.includes(undefined) ? null : `${written.join("")}Z`;
}

const SUBPATH_BUILDERS = {
  rect: rectSubpath,
  circle: circleSubpath,
  path: pathSubpath,
} satisfies Record<string, (el: Element, place: Place) => string | null>;

function subpath(el: Element): string | null {
  const place = placement(el);
  const build = lookup(SUBPATH_BUILDERS, el.tagName);
  return place && build ? build(el, place) : null;
}

function clipId(painted: Element): string {
  return /url\(['"]?#([^'")]+)/.exec(painted.getAttribute("clip-path") ?? "")?.[1] ?? "";
}

function crowdedClip(svg: SVGElement, painted: Element): Element | null {
  const clip = svg.querySelector(`clipPath[id="${clipId(painted)}"]`);
  return clip && clip.children.length > 1 ? clip : null;
}

// Half a code merged and half of it clipped would be worse than the seams.
function mergedPath(svg: SVGElement, painted: Element, clip: Element): SVGPathElement | null {
  const parts = [...clip.children].map(subpath);
  if (parts.includes(null)) return null;

  const merged = svg.ownerDocument.createElementNS(SVG_NS, "path");
  merged.setAttribute("d", parts.join(""));
  merged.setAttribute("fill", painted.getAttribute("fill") ?? "");
  return merged;
}

export function fillSeams(svg: SVGElement): void {
  for (const painted of svg.querySelectorAll("[clip-path]")) {
    const clip = crowdedClip(svg, painted);
    if (!clip) continue;

    const merged = mergedPath(svg, painted, clip);
    if (!merged) continue;

    painted.replaceWith(merged);
    clip.remove();
  }
}
