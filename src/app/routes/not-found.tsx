import { Link } from "@tanstack/react-router";
import { HOME_LINK } from "../components/not-found-home";
import { NotFoundView } from "../components/not-found-view";

export function NotFound() {
  return (
    <NotFoundView
      back={
        <Link to="/" className={HOME_LINK}>
          Go home
        </Link>
      }
    />
  );
}
