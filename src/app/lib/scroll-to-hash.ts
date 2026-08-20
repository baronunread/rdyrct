import { useEffect } from "react";
import { useLocation } from "@tanstack/react-router";

/**
 * A client-side navigation to a hash (the header's FAQ link, clicked from a
 * different page entirely) doesn't scroll to the target the way a fresh
 * document load does, because the section it points at often doesn't exist
 * yet at the moment the route change commits. Call this from the page that
 * owns the section: by the time it renders, the element is there.
 */
export function useScrollToHash() {
  const { hash } = useLocation();
  useEffect(() => {
    if (!hash) return;
    document.getElementById(hash)?.scrollIntoView({ behavior: "smooth" });
  }, [hash]);
}
