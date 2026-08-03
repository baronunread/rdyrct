import { useMemo, useState } from "react";
import { geoNaturalEarth1, geoPath } from "d3-geo";
import { feature } from "topojson-client";
import type { Topology, GeometryCollection } from "topojson-specification";
import { whereNumeric } from "iso-3166-1";
import type { TopEntry } from "@/shared/types";
import worldTopology from "../data/world-110m.json";

const WIDTH = 960;
const HEIGHT = 500;

const world = worldTopology as unknown as Topology<{ countries: GeometryCollection }>;
const countries = feature(world, world.objects.countries).features;

const projection = geoNaturalEarth1().fitSize([WIDTH, HEIGHT], {
  type: "FeatureCollection",
  features: countries,
});
const path = geoPath(projection);

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
 * Self-contained SVG choropleth (no tile requests, satisfies the app's
 * strict CSP): countries shade from --surface-2 (no clicks) to --chart
 * (most clicks), matching the BarList ranking it sits next to.
 */
export function CountryMap({ countries: data }: { countries: TopEntry[] }) {
  const [hover, setHover] = useState<{ name: string; clicks: number; x: number; y: number } | null>(
    null,
  );
  const clicksByAlpha2 = useMemo(() => new Map(data.map((d) => [d.key, d.clicks])), [data]);
  const max = Math.max(1, ...data.map((d) => d.clicks));

  if (!data.length) return <p className="py-4 text-sm text-muted">No data yet</p>;

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="h-auto w-full"
        role="img"
        aria-label="Clicks by country"
      >
        {countries.map((f) => {
          const alpha2 = alpha2ById.get(f.id);
          const clicks = alpha2 ? clicksByAlpha2.get(alpha2) : undefined;
          const d = path(f);
          if (!d) return null;
          const fill = clicks
            ? `color-mix(in srgb, var(--chart) ${5 + (clicks / max) * 95}%, var(--surface-2))`
            : "var(--surface-2)";
          return (
            <path
              key={f.id}
              d={d}
              fill={fill}
              stroke="var(--border)"
              strokeWidth={0.5}
              onMouseEnter={(e) => {
                const rect = e.currentTarget.ownerSVGElement?.getBoundingClientRect();
                setHover({
                  name: alpha2
                    ? fmtCountry(alpha2)
                    : String((f.properties as { name?: string } | null)?.name ?? ""),
                  clicks: clicks ?? 0,
                  x: rect ? ((e.clientX - rect.left) / rect.width) * 100 : 0,
                  y: rect ? ((e.clientY - rect.top) / rect.height) * 100 : 0,
                });
              }}
              onMouseLeave={() => setHover(null)}
            />
          );
        })}
      </svg>
      {hover && (
        <div
          className="pointer-events-none absolute rounded-md border border-border bg-surface-2 px-2.5 py-1.5 text-xs whitespace-nowrap shadow-lg"
          style={{
            left: `${hover.x}%`,
            top: `${hover.y}%`,
            transform: "translate(-50%, calc(-100% - 8px))",
          }}
        >
          <span className="text-muted">{hover.name}</span>{" "}
          <span className="tnum font-bold">{hover.clicks}</span>
        </div>
      )}
    </div>
  );
}
