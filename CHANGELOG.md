# Changelog

## 1.0.0

First stable release. rdyrct now runs on your own Cloudflare account with
only two secrets.

### Self-hosting

- **No email provider needed.** Leave `RESEND_API_KEY` unset and sign-up signs
  people in at once, with no verification. Password reset by email is off.
  Without email or Google sign-in an instance is not secure: set one of them.
  Existing installs that have a Resend key behave as before.
- **No billing needed.** Leave `POLAR_ACCESS_TOKEN` unset and every org gets the
  "Unlimited (Selfhosted Instance)" plan. Billing pages and routes are hidden.
  **If you update an instance that never set a Polar token, its limits go away.**
- README covers the minimum setup, the optional settings, queues and the domain.
- `/admin` warns when neither email nor Google sign-in is set up.

### Deploying

- `bun run deploy` ships only a `v*` tag on `main` with green CI, and applies
  D1 migrations before the new code.
- New migrations must be additive (no `DROP`, no `RENAME`).

### Other

- TanStack Charts 1.0.
