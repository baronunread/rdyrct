import { Link } from "@tanstack/react-router";
import { NotFoundView } from "../components/not-found-view";

export function NotFound() {
  return <NotFoundView back={<Link to="/">Go home</Link>} />;
}
