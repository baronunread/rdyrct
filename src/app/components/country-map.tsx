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
import { RendererChart } from "@tanstack/react-charts/tooltip";
import { pointerTooltip } from "./chart-tooltip";

const WIDTH = 960;
const HEIGHT = 500;

// tsc infers world-110m.json's literal shape from the file itself, which is
// far wider than the TopoJSON types and does not narrow to them on its own.
const worldJson: unknown = worldTopology;
// SAFETY: the file is a checked-in TopoJSON world map with a "countries"
// object; feature() below reads exactly that and nothing else.
const world = worldJson as Topology<{ countries: GeometryCollection }>;
const countries = feature(world, world.objects.countries).features;

type CountryFeature = (typeof countries)[number];

const mapMotion = motion<CountryFeature, number, number>();

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
          projection: { type: () => geoNaturalEarth1(), fit: "data" },
          key: (f: CountryFeature) => String(f.id),
          fill: (f: CountryFeature) => {
            const clicks = clicksOf(f);
            return clicks
              ? `color-mix(in srgb, var(--chart) ${5 + (clicks / max) * 95}%, var(--surface-2))`
              : "var(--surface-2)";
          },
          stroke: "var(--border)",
          strokeWidth: 0.5,
        }),
      ],
      // A map has no axes to draw, and no grid to draw them on.
      guides: false,
      focusRing: false,
      maxFocusDistance: 60,
      tooltip: pointerTooltip,
    });
  }, [data]);

  if (!data.length) return <p className="py-4 text-sm text-muted">No data yet</p>;

  return (
    <RendererChart
      definition={definition}
      renderer={mapMotion}
      aspectRatio={WIDTH / HEIGHT}
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
          <>
            <span className="text-muted">
              {alpha2 ? fmtCountry(alpha2) : String(named?.name ?? "")}
            </span>{" "}
            <span className="tnum font-bold">{(alpha2 && clicksByAlpha2.get(alpha2)) || 0}</span>
          </>
        );
      }}
    />
  );
}
