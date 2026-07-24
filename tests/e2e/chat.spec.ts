import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

async function expectAccessible(page: Page) {
  await expect(page).toHaveTitle(/Odiina/);
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(results.violations).toEqual([]);
}

async function enableChat(page: Page) {
  await page.goto("/settings/ai");
  for (const name of [
    "Enable private AI processing",
    "Allow requested private insights",
    "Allow Odiina Chat",
  ]) {
    const control = page.getByLabel(name);
    if (!(await control.isChecked())) await control.check();
  }
  await page.getByRole("button", { name: "Save AI choices" }).click();
  await expect(page.getByText("Private AI settings saved.")).toBeVisible();
  await expect(page.getByLabel("Semantic Memory")).toBeDisabled();
}

test("@chat-layout keeps private memory conversations usable at certified widths", async ({
  page,
}, testInfo) => {
  test.skip(
    process.env.ODIINA_E2E !== "1",
    "Requires authenticated local setup.",
  );
  await page.goto("/chat");
  await expect(
    page.getByRole("heading", { level: 1, name: "Odiina Chat" }),
  ).toBeVisible();
  await expect(page.getByText("OC · private and read-only")).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 1,
    ),
  ).toBe(true);
  await expectAccessible(page);
  const width = testInfo.project.use.viewport?.width ?? 0;
  if ([390, 1440].includes(width)) {
    await page.screenshot({
      path: `test-results/evidence/increment-k-chat-${width}.png`,
      fullPage: true,
    });
  }
});

test("@chat-journey retrieves current private evidence and manages saved and temporary Chats", async ({
  page,
}) => {
  test.setTimeout(180_000);
  test.skip(
    process.env.ODIINA_CHAT_E2E !== "1",
    "Requires the loopback fake provider and restricted AI worker.",
  );

  await enableChat(page);
  const marker = `chat-evidence-${crypto.randomUUID().slice(0, 8)}`;
  await page.goto("/feed");
  await page.getByLabel("Entry text").fill(`Practiced guitar with ${marker}.`);
  await page.getByRole("button", { name: /Add to/ }).click();
  await expect(
    page.locator("article.entry-card").filter({ hasText: marker }),
  ).toBeVisible();

  await page.goto("/chat");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "test-results/evidence/increment-k-chat-empty-390.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page
    .getByRole("textbox", { name: "Ask Odiina" })
    .fill(`What did I write about ${marker} today?`);
  await page.getByRole("button", { name: "Ask Odiina" }).click();
  await expect(page).toHaveURL(/\/chat\/[0-9a-f-]{36}$/i, {
    timeout: 90_000,
  });
  await expect(page.getByText(/I found 1 matching memory/i)).toBeVisible();
  const source = page.getByRole("region", { name: "Evidence sources" });
  await expect(source).toContainText(marker);
  await expectAccessible(page);
  await page.screenshot({
    path: "test-results/evidence/increment-k-chat-answer-1440.png",
    fullPage: true,
  });
  const chatUrl = page.url();
  await Promise.all([
    page.waitForURL(/\/entries\/[0-9a-f-]{36}$/i),
    source.getByRole("link").first().click(),
  ]);
  await expect(page.locator("main")).toContainText(
    `Practiced guitar with ${marker}.`,
  );
  await page.goto(chatUrl);
  await expect(page.locator(".chat-composer")).toHaveAttribute(
    "data-ready",
    "true",
  );

  await page
    .getByRole("textbox", { name: "Ask Odiina" })
    .fill("What about yesterday?");
  await page.getByRole("button", { name: "Ask Odiina" }).click();
  await expect(page.getByText(/could not find matching evidence/i)).toBeVisible(
    { timeout: 90_000 },
  );
  await page.screenshot({
    path: "test-results/evidence/increment-k-chat-no-evidence-1440.png",
    fullPage: true,
  });

  await page.getByRole("button", { name: "Rename" }).click();
  await page.getByLabel("Conversation title").fill("Guitar memory check");
  await page.getByRole("button", { name: "Save title" }).click();
  await expect(
    page.getByRole("heading", { name: "Guitar memory check" }),
  ).toBeVisible();
  await Promise.all([
    page.waitForEvent("framenavigated"),
    page.getByRole("button", { name: "Reset context" }).click(),
  ]);

  await page.goto("/chat");
  await page.getByRole("button", { name: "Temporary Chat" }).click();
  await expect(
    page.getByText(/deleted at logout or within one hour/i),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/evidence/increment-k-chat-temporary-1440.png",
    fullPage: true,
  });
  await page
    .getByRole("textbox", { name: "Ask Odiina" })
    .fill(`Find ${marker}.`);
  await page.getByRole("button", { name: "Ask Odiina" }).click();
  await expect(page).toHaveURL(/\/chat\/[0-9a-f-]{36}$/i, {
    timeout: 90_000,
  });
  await expect(page.getByText(/Temporary Chat · expires/)).toBeVisible();
  await page.getByRole("button", { name: "Save this Chat" }).click();
  await expect(page.getByText("Saved Chat", { exact: true })).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 1,
    ),
  ).toBe(true);
  const conversations = page.getByText("Conversations", { exact: true });
  await expect(conversations).toBeVisible();
  await conversations.click();
  await expectAccessible(page);
  await page.screenshot({
    path: "test-results/evidence/increment-k-chat-drawer-390.png",
    fullPage: true,
  });
  await conversations.click();
  await expect(page.locator("details.chat-history-mobile")).not.toHaveAttribute(
    "open",
    "",
  );

  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(page).toHaveURL(/\/chat$/);

  await page.goto("/settings/ai");
  await page.getByLabel("Enable private AI processing").uncheck();
  await page.getByRole("button", { name: "Save AI choices" }).click();
  await expect(page.getByText("Private AI settings saved.")).toBeVisible();
  await page.goto("/chat");
  await expect(
    page.getByRole("heading", { name: "Chat consent required" }),
  ).toBeVisible();
  await page.goto("/settings");
  await page.getByRole("button", { name: "Log out of Odiina" }).click();
  await expect(page).toHaveURL(/status=logged-out/);
  await page.goto("/chat");
  await expect(page).toHaveURL(/\/login$/);
});
