# rdyrct WebMCP promo video

A 15-second product promo for rdyrct's WebMCP browser-agent tools, built with
[HyperFrames](https://hyperframes.dev).

The composition lives in `index.html` — a GSAP timeline registered on
`window.__timelines["main"]`. It shows a browser agent issuing tool calls
(`create_link`, `get_analytics`, `generate_qr_code`) against the rdyrct app,
then lifts the generated QR code into a hero close.

## Develop

```sh
cd video-hf
npm run preview   # Studio preview (live)
npm run check     # lint + motion + contrast
npm run render    # render to rdyrct-webmcp.mp4
```

## Notes

- The rendered `rdyrct-webmcp.mp4` is **gitignored** — it is a build artifact,
  not source. Regenerate it with `npm run render`.
- No audio track is included. Sound effects, music, or a voiceover can be wired
  in via root-level `<audio>` elements (see the HyperFrames audio docs).
- This replaces an earlier Remotion-based attempt (`video/`), which was removed.
