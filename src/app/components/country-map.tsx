import { useMemo, useState } from "react";
import { geoCentroid, geoNaturalEarth1 } from "d3-geo";
import type { GeoProjection } from "d3-geo";
import { feature } from "topojson-client";
import type { Topology, GeometryCollection } from "topojson-specification";
import { whereNumeric } from "iso-3166-1";
import type { TopEntry } from "@/shared/types";
import worldTopology from "../data/world-110m.json";
import { defineChart } from "@tanstack/charts";
// geoShape is TanStack Charts' own export name, not ours; geoMark is what this file uses.
// oxlint-disable-next-line anti-slop/no-shape-in-symbol-names
import { geoShape as geoMark } from "@tanstack/charts/geo";
import type { GeoProjectionContext } from "@tanstack/charts/geo";
import { motion } from "@tanstack/charts/motion";
import { chartMotion } from "../lib/chart-motion";
import { RendererChart } from "@tanstack/react-charts/tooltip";
import { pointerTooltip } from "./chart-tooltip";
import { ClicksTip } from "./clicks-tip";
import { formatNumber } from "../lib/numbers";

// tsc infers world-110m.json's literal shape from the file itself, which is
// far wider than the TopoJSON types and does not narrow to them on its own.
const worldJson: unknown = worldTopology;
// SAFETY: the file is a checked-in TopoJSON world map with a "countries"
// object; feature() below reads exactly that and nothing else.
const world = worldJson as Topology<{ countries: GeometryCollection }>;
// Antarctica (ISO 010) goes: nobody clicks from there, and it took a fifth of
// the map's height for a white band.
const countries = feature(world, world.objects.countries).features.filter(
  (f) => String(f.id) !== "010",
);

type CountryFeature = (typeof countries)[number];

const WORLD = { type: "FeatureCollection" as const, features: countries };

/** The map's frame inside the plot: the countries it zooms to fill the
 * middle, so their neighbours show round them for a sense of where. */
const FRAME_PAD = { x: 0.18, y: 0.14 };

/** A width to measure the frame against before the card has one: the map
 * column on a desktop. Only decides whether the map zooms and what falls
 * outside it; the chart draws to its real width. */
const NOMINAL_WIDTH = 640;

/** The projection for a plot box: the world, or, when `frame` is given and
 * fits closer than the world does, that frame. Never wider than the world,
 * so spread-out clicks get the whole map and not a shrunken one. */
function projectionFor(
  box: { x: number; y: number; width: number; height: number },
  frame: CountryFeature[] | null,
): GeoProjection {
  const { x, y, width: w, height: h } = box;
  const whole = geoNaturalEarth1().fitExtent(
    [
      [x, y],
      [x + w, y + h],
    ],
    WORLD,
  );
  if (!frame) return whole;
  const near = geoNaturalEarth1().fitExtent(
    [
      [x + w * FRAME_PAD.x, y + h * FRAME_PAD.y],
      [x + w * (1 - FRAME_PAD.x), y + h * (1 - FRAME_PAD.y)],
    ],
    { type: "FeatureCollection", features: frame },
  );
  return (near.scale() > whole.scale() ? near : whole).clipExtent([
    [x, y],
    [x + w, y + h],
  ]);
}

/** The countries holding most clicks: the fewest, from the top, that reach
 * nine in ten. The map frames these. */
function busiest(features: CountryFeature[], clicksOf: (f: CountryFeature) => number) {
  const ranked = features.filter((f) => clicksOf(f) > 0).sort((a, b) => clicksOf(b) - clicksOf(a));
  const total = ranked.reduce((sum, f) => sum + clicksOf(f), 0);
  let seen = 0;
  return ranked.filter((f) => {
    const keep = seen < total * 0.9;
    seen += clicksOf(f);
    return keep;
  });
}

const mapMotion = motion<CountryFeature, number, number>(chartMotion);

/** Topojson feature ids are ISO 3166-1 numeric codes; click data keys are
 * alpha-2. Built once from the static topology, not per render. */
const alpha2ById = new Map(
  countries.map((f) => {
    const iso = whereNumeric(String(f.id).padStart(3, "0"));
    return [f.id, iso?.alpha2] as const;
  }),
);

const COUNTRY_NAMES = new Intl.DisplayNames("en", { type: "region" });
const fmtCountry = (key: string) => {
  try {
    return COUNTRY_NAMES.of(key) ?? key;
  } catch {
    return key;
  }
};

/** A country's colour for its share of the top country's clicks: from a
 * dim violet up to the bright accent, on a square root. On a linear scale,
 * and with --chart as the top, one big country left every other one
 * indistinguishable from no clicks at all. */
export const shade = (share: number) =>
  `color-mix(in oklab, var(--accent) ${Math.round(Math.sqrt(share) * 100)}%, color-mix(in oklab, var(--chart) 45%, var(--surface-2)))`;

/** "+2 countries outside, 4 clicks": what a zoomed frame leaves out. */
function outsideLine({ countries, clicks }: { countries: number; clicks: number }): string {
  const places = countries === 1 ? "country" : "countries";
  return `+${countries} ${places} outside, ${formatNumber(clicks)} ${clicks === 1 ? "click" : "clicks"}`;
}

/** Whether a projected point misses the box (or did not project at all). */
function offBox(at: [number, number] | null, box: { width: number; height: number }): boolean {
  if (!at) return true;
  const [x, y] = at;
  return x < 0 || x > box.width || y < 0 || y > box.height;
}

/** Under the map: the way between the zoomed frame and the whole world, and
 * what the frame leaves out, so nobody reads a country off the edge as no
 * clicks. */
function MapFoot({
  zoomable,
  world,
  onWorld,
  outside,
}: {
  zoomable: boolean;
  world: boolean;
  onWorld: (world: boolean) => void;
  outside: { countries: number; clicks: number };
}) {
  if (!zoomable) return null;
  return (
    <div className="flex items-center justify-between gap-3 text-xs text-muted">
      <button
        type="button"
        onClick={() => onWorld(!world)}
        className="cursor-pointer rounded transition-colors duration-150 ease-out [@media(hover:hover)]:hover:text-text"
      >
        {world ? "Zoom to the clicks" : "Show the world"}
      </button>
      {!world && outside.countries > 0 && <span className="tnum">{outsideLine(outside)}</span>}
    </div>
  );
}

/**
 * Self-contained choropleth (no tile requests, satisfies the app's strict
 * CSP): countries shade from --surface-2 (no clicks) to --chart (most
 * clicks), matching the BarList ranking it sits next to.
 *
 * It frames the countries most clicks come from (busiest, projectionFor):
 * clicks from five neighbouring countries fill the map instead of a speck
 * of a world map. Clicks from everywhere get the whole world, and a footnote
 * says what a frame leaves out and switches to the world and back.
 *
 * Drawn by Charts' geoShape mark rather than by hand, so it carries the same
 * tooltip as every other chart. One consequence worth knowing: geoShape gives
 * each country one interaction point, at its projected centroid, so hover
 * resolves to the nearest centroid rather than to the shape under the
 * pointer. maxFocusDistance keeps that from reaching across an ocean.
 */
export function CountryMap({
  countries: data,
  height,
}: {
  countries: TopEntry[];
  /** The map's height in px; it is as wide as its column. */
  height: number;
}) {
  const [world, setWorld] = useState(false);
  const { clicksOf, max, frame, outside } = useMemo(() => {
    const clicksByAlpha2 = new Map(data.map((d) => [d.key, d.clicks]));
    const clicksOf = (f: CountryFeature) => {
      const alpha2 = alpha2ById.get(f.id);
      return (alpha2 && clicksByAlpha2.get(alpha2)) || 0;
    };
    const core = busiest(countries, clicksOf);
    // Measured on a desktop-sized box: whether a frame beats the world, and
    // which clicked countries it leaves off the edge.
    const box = { x: 0, y: 0, width: NOMINAL_WIDTH, height };
    const near = projectionFor(box, core);
    const zooms = near.scale() > projectionFor(box, null).scale();
    const off = countries.filter(
      (f) => clicksOf(f) > 0 && !core.includes(f) && offBox(near(geoCentroid(f)), box),
    );
    return {
      clicksOf,
      max: Math.max(1, ...data.map((d) => d.clicks)),
      frame: zooms ? core : null,
      outside: { countries: off.length, clicks: off.reduce((sum, f) => sum + clicksOf(f), 0) },
    };
  }, [data, height]);

  const definition = useMemo(() => {
    const shown = world ? null : frame;
    return defineChart({
      marks: [
        geoMark(countries, {
          projection: ({ chart }: GeoProjectionContext<CountryFeature>) =>
            projectionFor(chart, shown),
          key: (f: CountryFeature) => String(f.id),
          fill: (f: CountryFeature) => {
            const clicks = clicksOf(f);
            return clicks ? shade(clicks / max) : "var(--surface-2)";
          },
          // Gaps in the card's colour rather than drawn borders: the shapes
          // read as land, not as a wireframe.
          stroke: "var(--surface)",
          strokeWidth: 0.6,
        }),
      ],
      // A map has no axes to draw, and no grid to draw them on. Charts 0.18
      // requires both Cartesian entries anyway; null says "not used".
      scales: { x: null, y: null },
      guides: false,
      focusRing: false,
      maxFocusDistance: 60,
      tooltip: pointerTooltip,
    });
  }, [clicksOf, max, frame, world]);

  if (!data.length) return <p className="py-4 text-sm text-muted">No data yet</p>;

  return (
    // A zoomed frame cuts countries at its edge; round corners make that a
    // window onto the map rather than a crop.
    <div className="flex min-w-0 flex-col gap-2 [&_svg.ts-chart]:[clip-path:inset(0_round_8px)]">
      <RendererChart
        definition={definition}
        renderer={mapMotion}
        height={height}
        ariaLabel="Clicks by country"
        // The map only explains the country ranking beside it. It has no action
        // of its own, so it must not become a tab stop or draw a focus border.
        tabIndex={-1}
        renderTooltipBody={({ points }) => {
          const f = points[0]?.datum;
          if (!f) return null;
          const alpha2 = alpha2ById.get(f.id);
          // SAFETY: TopoJSON leaves feature properties untyped, and
          // world-110m.json carries a "name" on each country. The ?? below
          // covers a feature that does not.
          const named = f.properties as { name?: string } | null;
          return (
            <ClicksTip
              label={alpha2 ? fmtCountry(alpha2) : String(named?.name ?? "")}
              clicks={clicksOf(f)}
            />
          );
        }}
      />
      <MapFoot zoomable={frame !== null} world={world} onWorld={setWorld} outside={outside} />
    </div>
  );
}
