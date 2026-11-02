import { useMemo } from "react";
import { geoNaturalEarth1 } from "d3-geo";
import { feature } from "topojson-client";
import type { Topology, GeometryCollection } from "topojson-specification";
import { whereNumeric } from "iso-3166-1";
import type { TopEntry } from "@/shared/types";
import worldTopology from "../data/world-110m.json";
import { defineChart } from "@tanstack/charts";
// geoShape is TanStack Charts' own export name, not ours; geoMark is what this file uses.
// oxlint-disable-next-line anti-slop/no-shape-in-symbol-names
import { geoShape as geoMark } from "@tanstack/charts/geo";
import { motion } from "@tanstack/charts/motion";
import { chartMotion } from "../lib/chart-motion";
import { RendererChart } from "@tanstack/react-charts/tooltip";
import { pointerTooltip } from "./chart-tooltip";
import { ClicksTip } from "./clicks-tip";
import { formatNumber } from "../lib/numbers";

// The world without Antarctica, in Natural Earth: about 2.1 wide for 1 tall.
const ASPECT = 2.1;

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
const shade = (share: number) =>
  `color-mix(in oklab, var(--accent) ${Math.round(Math.sqrt(share) * 100)}%, color-mix(in oklab, var(--chart) 45%, var(--surface-2)))`;

/** Fewer to more, under the map: the scale's two ends and the counts they
 * stand for, so a shade reads as a number. */
function MapLegend({ max }: { max: number }) {
  return (
    <div className="flex items-center justify-end gap-2 text-xs text-muted">
      <span className="tnum">1</span>
      <span
        aria-hidden
        className="h-1.5 w-24 rounded-full"
        style={{ background: `linear-gradient(to right, ${shade(0)}, ${shade(1)})` }}
      />
      <span className="tnum">{formatNumber(max)}</span>
    </div>
  );
}

/**
 * Self-contained choropleth (no tile requests, satisfies the app's strict
 * CSP): countries shade from --surface-2 (no clicks) to --chart (most
 * clicks), matching the BarList ranking it sits next to.
 *
 * Drawn by Charts' geoShape mark rather than by hand, so it carries the same
 * tooltip as every other chart. One consequence worth knowing: geoShape gives
 * each country one interaction point, at its projected centroid, so hover
 * resolves to the nearest centroid rather than to the shape under the
 * pointer. maxFocusDistance keeps that from reaching across an ocean.
 */
export function CountryMap({ countries: data }: { countries: TopEntry[] }) {
  const definition = useMemo(() => {
    const clicksByAlpha2 = new Map(data.map((d) => [d.key, d.clicks]));
    const max = Math.max(1, ...data.map((d) => d.clicks));
    const clicksOf = (f: CountryFeature) => {
      const alpha2 = alpha2ById.get(f.id);
      return (alpha2 && clicksByAlpha2.get(alpha2)) || 0;
    };
    return defineChart({
      marks: [
        geoMark(countries, {
          projection: {
            type: () => geoNaturalEarth1(),
            fit: "data",
          },
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
  }, [data]);

  if (!data.length) return <p className="py-4 text-sm text-muted">No data yet</p>;

  return (
    <div className="flex h-full flex-col justify-center gap-3 overflow-hidden">
      <RendererChart
        definition={definition}
        renderer={mapMotion}
        aspectRatio={ASPECT}
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
          const clicksByAlpha2 = new Map(data.map((d) => [d.key, d.clicks]));
          return (
            <ClicksTip
              label={alpha2 ? fmtCountry(alpha2) : String(named?.name ?? "")}
              clicks={(alpha2 && clicksByAlpha2.get(alpha2)) || 0}
            />
          );
        }}
      />
      <MapLegend max={Math.max(1, ...data.map((d) => d.clicks))} />
    </div>
  );
}
