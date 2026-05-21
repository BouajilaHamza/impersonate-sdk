export type BannerPosition = "top" | "bottom";

export const BANNER_POSITION_STORAGE_KEY = "impersonate_banner_position";

export function isBannerPosition(value: string | null): value is BannerPosition {
  return value === "top" || value === "bottom";
}

export function resolveBannerPosition({
  defaultPosition = "bottom",
  storage = getBrowserStorage(),
}: {
  defaultPosition?: BannerPosition;
  storage?: Storage | null;
} = {}): BannerPosition {
  const stored = storage?.getItem(BANNER_POSITION_STORAGE_KEY) ?? null;
  return isBannerPosition(stored) ? stored : defaultPosition;
}

export function persistBannerPosition(
  position: BannerPosition,
  storage: Storage | null = getBrowserStorage()
): void {
  storage?.setItem(BANNER_POSITION_STORAGE_KEY, position);
}

export function getNextBannerPosition(position: BannerPosition): BannerPosition {
  return position === "top" ? "bottom" : "top";
}

export function snapBannerPosition(
  pointerY: number,
  viewportHeight: number
): BannerPosition {
  return pointerY < viewportHeight / 2 ? "top" : "bottom";
}

function getBrowserStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  return window.localStorage;
}
