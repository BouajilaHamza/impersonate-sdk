import { test, expect, type Page } from "@playwright/test";

type EventLog = Array<{ name: string; data: unknown }>;

async function loadFixture(page: Page, cfg: Record<string, unknown>): Promise<void> {
  await page.addInitScript((c) => {
    (window as any).__cfg = c;
  }, cfg);
  await page.goto("/test/e2e/fixture.html");
  await page.waitForFunction(() => (window as any).__ready === true);
}

async function getEvents(page: Page): Promise<EventLog> {
  return page.evaluate(() => (window as any).__events as EventLog);
}

test.describe("ImpersonationManager E2E", () => {
  test("smoke: fixture loads and exposes manager", async ({ page }) => {
    await loadFixture(page, {});
    const status = await page.locator("#status").textContent();
    expect(status).toBe("idle");
    expect(await page.evaluate(() => typeof (window as any).__manager.start)).toBe(
      "function"
    );
  });

  test("success path: stop() emits stopped(manual) and navigates to admin home", async ({
    page,
  }) => {
    await loadFixture(page, { restoreFails: false });
    await page.evaluate(() => (window as any).__start("target-1"));
    await expect(page.locator("#status")).toHaveText("active");
    await expect(page.locator("#banner")).toContainText("User target-1");

    await page.evaluate(() => (window as any).__stop("manual"));
    await expect(page.locator("#status")).toHaveText("idle");
    await expect(page.locator("#redirect")).toHaveText("/admin/users");

    const events = await getEvents(page);
    const stopped = events.filter((e) => e.name === "stopped");
    const errors = events.filter((e) => e.name === "error");
    expect(stopped).toHaveLength(1);
    expect((stopped[0].data as { reason: string }).reason).toBe("manual");
    expect(errors).toHaveLength(0);
    const clears = await page.evaluate(() => (window as any).__clearCalls());
    expect(clears).toBe(0);
  });

  test("restore-failed path: timer expires + restore throws → clearSession called, dual events emitted, redirect to login", async ({
    page,
  }) => {
    await loadFixture(page, {
      restoreFails: true,
      durationMs: 150,
      tickIntervalMs: 30,
    });
    await page.evaluate(() => (window as any).__start("target-2"));
    await expect(page.locator("#status")).toHaveText("active");

    // Let the timer expire and the failure path run.
    await expect(page.locator("#status")).toHaveText("idle", { timeout: 3000 });
    await expect(page.locator("#redirect")).toHaveText("/login?session_lost=1");

    const events = await getEvents(page);
    const errors = events.filter((e) => e.name === "error");
    const stopped = events.filter((e) => e.name === "stopped");
    expect(errors).toHaveLength(1);
    expect((errors[0].data as { phase: string }).phase).toBe("stop");
    expect(stopped).toHaveLength(1);
    expect((stopped[0].data as { reason: string }).reason).toBe(
      "restore-failed"
    );

    // error must precede stopped
    const errIdx = events.findIndex((e) => e.name === "error");
    const stopIdx = events.findIndex((e) => e.name === "stopped");
    expect(errIdx).toBeLessThan(stopIdx);

    // clearSession invoked exactly once
    const clears = await page.evaluate(() => (window as any).__clearCalls());
    expect(clears).toBe(1);
  });

  test("restore-failed + clearSession also throws → original error still surfaces, events still emitted", async ({
    page,
  }) => {
    await loadFixture(page, {
      restoreFails: true,
      clearFails: true,
      durationMs: 150,
      tickIntervalMs: 30,
    });
    await page.evaluate(() => (window as any).__start("target-3"));
    await expect(page.locator("#status")).toHaveText("active");
    await expect(page.locator("#status")).toHaveText("idle", { timeout: 3000 });

    const events = await getEvents(page);
    expect(events.filter((e) => e.name === "stopped")).toHaveLength(1);
    expect(events.filter((e) => e.name === "error")).toHaveLength(1);
    const err = events.find((e) => e.name === "error");
    // The bubbled error must be the original restore failure, not the clearSession one.
    expect((err!.data as { message: string }).message).toContain(
      "setSession failed (simulated)"
    );
  });
});
