// Passed to <LazyMotion features>. The animation bundle is 24 KB gzipped and
// nothing above the fold needs it to paint, so it loads after first paint.
export const loadMotionFeatures = () => import("./motion-features").then((m) => m.default);
