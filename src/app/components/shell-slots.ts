import { createContext } from "react";

// The prerendered shell has no user, so it leaves slots that styles.css fills
// from CSS variables the head script in index.html sets. In the app, false.
export const ShellSlots = createContext(false);
