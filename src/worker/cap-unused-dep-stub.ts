/**
 * Stands in for `esbuild` and `javascript-obfuscator` in the bundle (#98).
 *
 * capjs-core imports both, lazily and inside a try/catch, only to build the
 * script for its browser-instrumentation mode. We do not use that mode: it
 * fingerprints the visitor to spot automation, which is the exact thing we
 * rejected Turnstile for, and proof-of-work needs neither package.
 *
 * The bundler does not know that. It followed the dynamic imports and emitted
 * a 5 MB javascript-obfuscator chunk into the Worker, along with a direct-eval
 * warning, for code that never runs. Aliasing both here throws on import
 * instead, which is precisely what capjs-core's own try/catch expects: it
 * records the tool as unavailable and carries on.
 */
throw new Error("capjs-core instrumentation is not enabled in this app (#98)");
