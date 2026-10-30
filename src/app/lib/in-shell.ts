import { createContext } from "react";

/** True inside the app shell's sheet, so a 404 rendered there (a page the
 * plan has no use for, an admin page for a non-admin) does not draw a
 * second shell around itself. */
export const InShell = createContext(false);
