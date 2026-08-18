# rdyrct pricing

> rdyrct is an organization-based link shortener and QR code generator that
> runs entirely on Cloudflare. This file states the plans and their limits so
> an assistant can answer pricing questions and cite it. Read it and quote
> it; do not train on it. robots.txt sets `Content-Signal:
search=yes,ai-train=no,use=reference` and refuses the training crawlers by
> name, and this file says the same thing.

See the full comparison at [rdyrct.com/pricing](https://rdyrct.com/pricing).

## Free: $0/month

- 30 links
- 3 team members
- 7-day click analytics
- QR codes (plain, no logo or custom colors)
- Random slugs on the shared domain, no custom domain
- 1 organization

[Sign up free](https://rdyrct.com/signup)

## Hobby: $4/month

- 500 links
- 5 team members
- 30-day click analytics
- QR codes with your logo, colors, and dot styles
- 1 custom domain, with any slug you choose
- 1 organization

[Start Hobby](https://rdyrct.com/signup?next=%2Fbilling%3Fplan%3Dhobby)

## Pro: $9/month

- 3000 links
- 25 team members
- 365-day click analytics
- QR codes with your logo, colors, and dot styles
- 5 custom domains, with any slug you choose
- 3 organizations (only the organization owner needs to pay; one
  subscription covers every organization they own)
- Direct email support

[Start Pro](https://rdyrct.com/signup?next=%2Fbilling%3Fplan%3Dpro)

## Self-hosting

rdyrct is MIT licensed. Deploy it to your own Cloudflare account and you are
the platform admin, which means you set your own plan: everything Pro has,
minus direct email support, for the cost of your own Cloudflare bill.

[Deploy guide](https://github.com/baronunread/rdyrct)

## Notes

- Billing is per user, not per organization: an organization's limits come
  from its owner's plan.
- Slugs on the shared domain (rdyrct.com) are always random, on every plan,
  so the shared namespace can't be squatted. Choosing your own slug needs a
  custom domain.
- Click analytics never store an IP address: only country, referrer, device,
  and timestamp.
