import { Link } from "react-router";

export function NotFound() {
  return (
    <div className="grid min-h-dvh place-items-center px-4 text-center">
      <div>
        <p className="text-4xl font-bold text-accent">404</p>
        <p className="mt-2 text-sm text-muted">
          This short link does not exist (or the page moved).
        </p>
        <p className="mt-4 text-sm">
          <Link to="/">Go home</Link>
        </p>
      </div>
    </div>
  );
}
