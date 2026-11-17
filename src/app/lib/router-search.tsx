import { Link, useLocation, useNavigate, type LinkComponentProps } from "@tanstack/react-router";

// Reads and writes the raw query string, for flat filter/pagination params that need
// no typed per-route search schema.
export function useSearchParams(): [
  URLSearchParams,
  (next: URLSearchParams, opts?: { replace?: boolean }) => void,
] {
  const searchStr = useLocation({ select: (l) => l.searchStr });
  const navigate = useNavigate();
  const params = new URLSearchParams(searchStr);
  const setParams = (next: URLSearchParams, opts?: { replace?: boolean }) => {
    const search: Record<string, string> = {};
    next.forEach((value, key) => {
      search[key] = value;
    });
    void navigate({ to: ".", search, replace: opts?.replace });
  };
  return [params, setParams];
}

// `href` fully drives navigation: buildLocation parses it and overwrites `to`, so `to`
// only satisfies the router's typed-route prop requirement.
export function HrefLink({
  href,
  ...props
}: { href: string } & Omit<LinkComponentProps<"a">, "to" | "href">) {
  // SAFETY: `to` only needs to satisfy the router's typed-route prop
  // requirement; `href` (above) is what buildLocation actually navigates
  // to, so `to`'s value is never used to resolve or match a route.
  return <Link to={href as never} href={href} {...props} />;
}
