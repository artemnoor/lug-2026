import { expect, test } from "@playwright/test";

test("public landing page loads without private application bundles", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(page).toHaveTitle(/Лучшая учебная группа/);
  await expect(page.locator("#main-content")).toBeVisible();
  const scripts = await page
    .locator("script[src]")
    .evaluateAll((items) => items.map((item) => item.src));
  expect(scripts.some((src) => src.includes("/admin"))).toBe(false);
  expect(scripts.some((src) => src.includes("/cabinet"))).toBe(false);
  expect(errors).toEqual([]);
});

test("account dialog is keyboard accessible", async ({ page }) => {
  await page.goto("/");
  await page.locator("#siteAccountLink").click();
  const dialog = page.locator("dialog.site-auth-dialog");
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "Войти" }).first(),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
});

test("color editing controls and routes are removed", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(page.locator("[data-theme-switcher]")).toHaveCount(0);
  await expect(page.locator("[data-inline-editor-trigger]")).toHaveCount(0);
  await expect(page.locator('script[src*="theme-switcher"]')).toHaveCount(0);
  await expect(page.locator('script[src*="inline-visual-editor"]')).toHaveCount(0);

  for (const path of ["/theme-editor.html", "/visual-editor.html"]) {
    const response = await page.request.get(path);
    expect(response.status()).toBe(404);
  }
  expect(errors).toEqual([]);
});

test("public landing uses the fixed green design tokens", async ({ page }) => {
  await page.goto("/");
  const state = await page.evaluate(() => {
    const root = getComputedStyle(document.documentElement);
    const body = getComputedStyle(document.body);
    const firstCard = getComputedStyle(document.querySelector(".timeline-card"));
    return {
      background: root.getPropertyValue("--background").trim(),
      surface: root.getPropertyValue("--surface").trim(),
      primary: root.getPropertyValue("--primary").trim(),
      accent: root.getPropertyValue("--accent").trim(),
      ink: root.getPropertyValue("--ink").trim(),
      bodyBackground: body.backgroundColor,
      cardBackground: firstCard.backgroundColor,
    };
  });
  expect(state).toEqual({
    background: "#F3FFF0",
    surface: "#FFFFFF",
    primary: "#347A4A",
    accent: "#8BCF68",
    ink: "#17251C",
    bodyBackground: "rgb(243, 255, 240)",
    cardBackground: "rgb(255, 255, 255)",
  });
});

test("results page loads its external module and renders a state", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/results.html");
  await expect(page).toHaveTitle(/Результаты/);
  await expect(page.locator("#results-title")).toBeVisible();
  await expect(page.locator("#resultsLead")).not.toHaveText(
    "Загружаем итоговую таблицу.",
  );
  expect(errors).toEqual([]);
});

test("rules page loads schedule data without inline script", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/rules.html");
  await expect(page).toHaveTitle(/Правила конкурса/);
  await expect(page.locator("#rules-title")).toBeVisible();
  await expect(
    page.locator('[data-rules-date="competition-start"]'),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test("public green palette keeps rules and registration readable", async ({
  page,
}) => {
  await page.goto("/");
  const state = await page.locator(".rules-preview").evaluate((rules) => ({
    ruleTextBackground: getComputedStyle(
      rules.querySelector(".rules-preview__intro h2 span"),
    ).backgroundColor,
    registrationBackground: getComputedStyle(
      document.querySelector(".stage-reg"),
    ).backgroundColor,
    registrationTitleColor: getComputedStyle(
      document.querySelector(".stage-reg .headline"),
    ).color,
  }));

  expect(state.ruleTextBackground).toBe("rgba(0, 0, 0, 0)");
  expect(state.registrationBackground).toBe("rgb(243, 255, 240)");
  expect(state.registrationTitleColor).toBe("rgb(23, 37, 28)");
});
