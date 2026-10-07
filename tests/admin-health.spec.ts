import { expect, test } from "@playwright/test";

const snapshot = {
  checkedAt: "2026-10-07T12:00:00Z",
  outcomesSince: "2026-10-06T12:00:00Z",
  blockedWindowMinutes: 10,
  maxConcurrentTasks: 2,
  retailers: ["Coles", "Woolworths"].map((name) => ({
    code: name.toLowerCase(),
    name,
    waiting: 3,
    processing: 1,
    expiredLeases: 1,
    failed: 2,
    oldestOutstandingCreatedAt: "2026-10-07T10:00:00Z",
    completedLast24Hours: 8,
    failedLast24Hours: 2,
    completionPercent: 80,
    recentBlockedReports: 3,
    workloadStatus: "Paused",
    pausedUntil: "2026-10-07T12:10:00Z",
    trialExpiresAt: null,
    commonFailures: [{ code: "retailer_blocked", count: 2 }],
  })),
};

test("hidden pages pause refresh and visible pages resume", async ({
  page,
}) => {
  await page.clock.install();
  let requests = 0;
  await page.route("**/api/admin/health", (route) => {
    requests++;
    return route.fulfill({ json: snapshot });
  });
  await page.goto("/admin/health");
  await expect(
    page.getByRole("region", { name: "Coles health" }),
  ).toBeVisible();
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: true,
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  const before = requests;
  await page.clock.runFor(60001);
  expect(requests).toBe(before);
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: false,
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect.poll(() => requests).toBeGreaterThan(before);
});

test("health shows queue statistics and refreshes manually without horizontal overflow", async ({
  page,
}) => {
  let requests = 0;
  await page.route("**/api/admin/health", (route) => {
    requests++;
    return route.fulfill({ json: snapshot });
  });
  await page.goto("/admin/health");
  await expect(
    page.getByRole("region", { name: "Coles health" }),
  ).toContainText("80% completed successfully");
  await expect(
    page.getByRole("region", { name: "Woolworths health" }),
  ).toContainText("retailer blocked");
  const before = requests;
  await page.getByRole("button", { name: "Refresh health" }).click();
  await expect.poll(() => requests).toBeGreaterThan(before);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

test("access loss clears statistics and stops automatic requests", async ({
  page,
}) => {
  await page.clock.install();
  let denied = false,
    requests = 0;
  await page.route("**/api/admin/health", (route) => {
    requests++;
    return route.fulfill(
      denied ? { status: 403, json: { title: "Denied" } } : { json: snapshot },
    );
  });
  await page.goto("/admin/health");
  await expect(
    page.getByRole("region", { name: "Coles health" }),
  ).toBeVisible();
  denied = true;
  await page.clock.runFor(30001);
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "Administrator access required",
  );
  await expect(page.getByRole("region")).toHaveCount(0);
  const before = requests;
  await page.clock.runFor(60001);
  expect(requests).toBe(before);
});

test("temporary failure labels the retained snapshot", async ({ page }) => {
  let fail = false;
  await page.route("**/api/admin/health", (route) =>
    route.fulfill(
      fail
        ? { status: 503, json: { title: "Unavailable" } }
        : { json: snapshot },
    ),
  );
  await page.goto("/admin/health");
  await expect(
    page.getByRole("region", { name: "Coles health" }),
  ).toBeVisible();
  fail = true;
  await page.getByRole("button", { name: "Refresh health" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "last successful snapshot",
  );
  await expect(
    page.getByRole("region", { name: "Coles health" }),
  ).toBeVisible();
});
