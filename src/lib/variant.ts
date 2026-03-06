import { useLocation } from "react-router-dom";

export type VariantPath = "a" | "b";

export function variantFromPathname(pathname: string): VariantPath {
  return pathname.startsWith("/b") ? "b" : "a";
}

export function useVariant(): VariantPath {
  const { pathname } = useLocation();
  return variantFromPathname(pathname);
}