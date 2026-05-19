import { describe, expect, it } from "bun:test";
import {
  BANNER_POSITION_STORAGE_KEY,
  getNextBannerPosition,
  persistBannerPosition,
  resolveBannerPosition,
  snapBannerPosition,
} from "./bannerPosition";

class MemStorage implements Storage {
  private store = new Map<string, string>();

  get length(): number {
    return this.store.size;
  }

  clear(): void {
    this.store.clear();
  }

  getItem(key: string): string | null {
    return this.store.get(key) ?? null;
  }

  key(index: number): string | null {
    return Array.from(this.store.keys())[index] ?? null;
  }

  removeItem(key: string): void {
    this.store.delete(key);
  }

  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }
}

describe("banner position", () => {
  it("defaults to bottom when no default or persisted value exists", () => {
    expect(resolveBannerPosition({ storage: new MemStorage() })).toBe("bottom");
  });

  it("uses the provided default position when nothing is persisted", () => {
    expect(
      resolveBannerPosition({
        defaultPosition: "top",
        storage: new MemStorage(),
      })
    ).toBe("top");
  });

  it("uses a persisted position before the provided default", () => {
    const storage = new MemStorage();
    storage.setItem(BANNER_POSITION_STORAGE_KEY, "bottom");

    expect(resolveBannerPosition({ defaultPosition: "top", storage })).toBe(
      "bottom"
    );
  });

  it("ignores invalid persisted positions", () => {
    const storage = new MemStorage();
    storage.setItem(BANNER_POSITION_STORAGE_KEY, "left");

    expect(resolveBannerPosition({ defaultPosition: "top", storage })).toBe(
      "top"
    );
  });

  it("persists top and bottom positions only", () => {
    const storage = new MemStorage();

    persistBannerPosition("top", storage);
    expect(storage.getItem(BANNER_POSITION_STORAGE_KEY)).toBe("top");

    persistBannerPosition("bottom", storage);
    expect(storage.getItem(BANNER_POSITION_STORAGE_KEY)).toBe("bottom");
  });

  it("toggles to the opposite position", () => {
    expect(getNextBannerPosition("bottom")).toBe("top");
    expect(getNextBannerPosition("top")).toBe("bottom");
  });

  it("snaps by viewport midpoint", () => {
    expect(snapBannerPosition(299, 600)).toBe("top");
    expect(snapBannerPosition(300, 600)).toBe("bottom");
  });
});
