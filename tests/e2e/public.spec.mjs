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
