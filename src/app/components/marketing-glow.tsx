export function MarketingGlow() {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-120"
      style={{
        background:
          "radial-gradient(55% 60% at 50% 0%, color-mix(in srgb, var(--accent) 9%, transparent), transparent)",
      }}
    />
  );
}
