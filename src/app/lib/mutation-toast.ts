import { ApiError } from "./api";

export function withErrorToast(
  toast: (message: string, kind?: "info" | "error") => void,
) {
  return (e: Error) =>
    toast(e instanceof ApiError ? e.message : "Something went wrong", "error");
}
