import AxeBuilder from "@axe-core/playwright";
import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";

const setupEmail = "journey@example.test";
const mailboxUrl = process.env.ODIINA_MAILBOX_URL ?? "http://127.0.0.1:54324";

type MailpitMessage = {
  ID: string;
  To?: Array<{ Address?: string }>;
};

async function magicLink(
  request: APIRequestContext,
  existing: Set<string>,
  invitedEmail: string,
): Promise<string> {
  await expect
    .poll(
      async () => {
        const listResponse = await request.get(`${mailboxUrl}/api/v1/messages`);
        if (!listResponse.ok()) return null;
        const list = (await listResponse.json()) as {
          messages?: MailpitMessage[];
        };
        const message = (list.messages ?? []).find(
          (candidate) =>
            !existing.has(candidate.ID) &&
            candidate.To?.some(
              (recipient) => recipient.Address?.toLowerCase() === invitedEmail,
            ),
        );
        if (!message) return null;
        const detailResponse = await request.get(
          `${mailboxUrl}/api/v1/message/${message.ID}`,
        );
        if (!detailResponse.ok()) return null;
        const detail = (await detailResponse.json()) as {
          HTML?: string;
          Text?: string;
        };
        return `${detail.HTML ?? ""}\n${detail.Text ?? ""}`
          .replaceAll("&amp;", "&")
          .match(/https?:\/\/[^\s"'<>]+/g)
          ?.find((candidate) => candidate.includes("/auth/v1/verify"));
      },
      { message: "a new local magic link", timeout: 15_000 },
    )
    .not.toBeNull();

  const response = await request.get(`${mailboxUrl}/api/v1/messages`);
  const list = (await response.json()) as { messages?: MailpitMessage[] };
  const message = (list.messages ?? []).find(
    (candidate) =>
      !existing.has(candidate.ID) &&
      candidate.To?.some(
        (recipient) => recipient.Address?.toLowerCase() === invitedEmail,
      ),
  )!;
  const detail = (await (
    await request.get(`${mailboxUrl}/api/v1/message/${message.ID}`)
  ).json()) as { HTML?: string; Text?: string };
  return `${detail.HTML ?? ""}\n${detail.Text ?? ""}`
    .replaceAll("&amp;", "&")
    .match(/https?:\/\/[^\s"'<>]+/g)!
    .find((candidate) => candidate.includes("/auth/v1/verify"))!;
}

async function expectAccessible(page: Page) {
  await expect(page).toHaveTitle(/Odiina/);
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(results.violations).toEqual([]);
}

test("@calendar-journey recalls and corrects occurrence dates", async ({
  context,
  page,
  request,
}, testInfo) => {
  test.setTimeout(180_000);
  test.skip(
    process.env.ODIINA_E2E !== "1",
    "Requires a reset local Supabase stack, Mailpit and ODIINA_E2E=1.",
  );
  const journeyEmail = testInfo.project.name.includes("mobile")
    ? "calendar-journey-mobile@example.test"
    : "calendar-journey-desktop@example.test";

  const list = await request.get(`${mailboxUrl}/api/v1/messages`);
  const existing = new Set(
    (
      ((await list.json()) as { messages?: MailpitMessage[] }).messages ?? []
    ).map((message) => message.ID),
  );
  await page.goto("/login");
  await page.getByLabel("Email address").fill(journeyEmail);
  await page.getByRole("button", { name: "Email me a magic link" }).click();
  await page.goto(await magicLink(request, existing, journeyEmail));
  await expect(page).toHaveURL(/\/onboarding$/);
  await page.getByLabel("IANA timezone").fill("UTC");
  await page.getByRole("button", { name: "Confirm and continue" }).click();
  await expect(page).toHaveURL(/\/feed$/);

  await page.getByRole("link", { name: "Calendar", exact: true }).click();
  await expect(page).toHaveURL(/\/calendar(?:\?date=.*)?$/);
  await expectAccessible(page);

  const initialCalendarUrl = page.url();
  const previousMonth = page.getByRole("link", {
    name: "Previous month, June 2026",
  });
  const previousMonthHref = await previousMonth.getAttribute("href");
  expect(previousMonthHref).toMatch(
    /^\/calendar\?date=2026-06-\d{2}#calendar-month-heading$/,
  );
  const previousMonthUrl = new URL(previousMonthHref!, page.url()).toString();
  await previousMonth.click();
  await expect(page).toHaveURL(previousMonthUrl);
  await expect(page.getByRole("heading", { name: "June 2026" })).toBeFocused();
  await page.goBack();
  await expect(page).toHaveURL(initialCalendarUrl);
  await expect(page.getByRole("heading", { name: "July 2026" })).toBeVisible();
  await page.goForward();
  await expect(page).toHaveURL(previousMonthUrl);
  await expect(page.getByRole("heading", { name: "June 2026" })).toBeVisible();
  await page.getByRole("link", { name: "Today" }).click();

  const keyboardDate = page.getByRole("link", {
    name: "Sunday, July 19, 2026, no Entries",
  });
  await keyboardDate.focus();
  await expect(keyboardDate).toBeFocused();
  await keyboardDate.press("Enter");
  await expect(page).toHaveURL(/\/calendar\?date=2026-07-19/);
  await expect(
    page.getByRole("heading", { name: "Sunday, July 19, 2026" }),
  ).toBeFocused();

  await page.goto("/calendar?date=2026-02-30");
  await expect(
    page.getByRole("heading", { name: "That Calendar date is not valid" }),
  ).toBeVisible();
  await page.goto("/calendar?date=2026-07-12");
  await expect(
    page.getByRole("heading", { name: "Sunday, July 12, 2026" }),
  ).toBeVisible();
  await expect(page.getByLabel("Occurrence date")).toHaveValue("2026-07-12");

  const historicalBody = "Historical Calendar Entry";
  await page.getByLabel("Entry text").fill(historicalBody);
  await page.getByRole("button", { name: "Add to 2026-07-12" }).click();
  await expect(page.getByText(historicalBody, { exact: true })).toBeVisible();
  await expect(
    page.getByRole("link", {
      name: "Sunday, July 12, 2026, selected, 1 Entry",
    }),
  ).toBeVisible();

  await page.getByRole("link", { name: /Open Entry from/ }).click();
  await expect(
    page.getByText("Recorded later", { exact: false }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Edit Entry" }).click();
  await page.getByLabel("Occurrence date").fill("2026-07-13");
  await page.getByLabel("Occurrence time").fill("10:30");
  await page.getByRole("button", { name: "Save revision" }).click();
  const currentRevision = page.getByRole("listitem").filter({
    has: page.getByRole("heading", { name: /Revision 2.*Current/ }),
  });
  await expect(currentRevision).toBeVisible();
  await expect(currentRevision).toContainText("Occurrence corrected");

  await page.goto("/calendar?date=2026-07-12");
  await expect(page.getByText(historicalBody, { exact: true })).toHaveCount(0);
  await page.goto("/calendar?date=2026-07-13");
  await expect(page.getByText(historicalBody, { exact: true })).toBeVisible();
  await expect(
    page.getByRole("link", {
      name: "Monday, July 13, 2026, selected, 1 Entry",
    }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Move Entry to Trash" }).click();
  await page.getByRole("button", { name: "Move to Trash" }).click();
  await page.goto("/calendar?date=2026-07-13");
  await expect(
    page.getByRole("link", {
      name: "Monday, July 13, 2026, selected, no Entries",
    }),
  ).toBeVisible();

  await page.getByRole("link", { name: "Trash" }).click();
  await page.getByRole("button", { name: "Restore Entry" }).click();
  await page.goto("/calendar?date=2026-07-13");
  await expect(page.getByText(historicalBody, { exact: true })).toBeVisible();
  await expectAccessible(page);

  await page.getByRole("link", { name: "Settings" }).click();
  await page.getByRole("button", { name: "Log out of Odiina" }).click();
  await expect(page).toHaveURL(/status=logged-out/);
  expect(
    (await context.cookies()).filter((cookie) =>
      cookie.name.includes("auth-token"),
    ),
  ).toEqual([]);
  await page.goto("/calendar?date=2026-07-13");
  await expect(page).toHaveURL(/\/login$/);
});

test("@calendar-setup confirms the invited user's timezone", async ({
  context,
  page,
  request,
}) => {
  test.setTimeout(90_000);
  test.skip(
    process.env.ODIINA_E2E !== "1",
    "Requires a reset local Supabase stack, Mailpit and ODIINA_E2E=1.",
  );

  const list = await request.get(`${mailboxUrl}/api/v1/messages`);
  const existing = new Set(
    (
      ((await list.json()) as { messages?: MailpitMessage[] }).messages ?? []
    ).map((message) => message.ID),
  );
  await page.goto("/login");
  await page.getByLabel("Email address").fill(setupEmail);
  await page.getByRole("button", { name: "Email me a magic link" }).click();
  await page.goto(await magicLink(request, existing, setupEmail));
  await expect(page).toHaveURL(/\/onboarding$/);
  const csrf = (await context.cookies()).find(
    (cookie) => cookie.name === "odiina_csrf",
  )?.value;
  expect(csrf).toBeTruthy();
  const preferences = await page.request.put("/api/preferences", {
    headers: {
      "content-type": "application/json",
      origin: "http://localhost:3000",
      "x-odiina-csrf": csrf!,
    },
    data: { timezone: "UTC", weekStartsOn: 1 },
  });
  expect(preferences.status()).toBe(200);
  await page.goto("/feed");
  await expect(page).toHaveURL(/\/feed$/);
  await context.storageState({ path: "test-results/calendar-auth.json" });
});

test("@calendar-layout keeps the month and selected-day flow usable", async ({
  page,
}) => {
  test.setTimeout(90_000);
  test.skip(
    process.env.ODIINA_E2E !== "1",
    "Requires a reset local Supabase stack, Mailpit and ODIINA_E2E=1.",
  );

  await page.goto("/calendar?date=2026-07-13");
  await expect(
    page.getByRole("heading", { name: "Monday, July 13, 2026" }),
  ).toBeVisible();
  const grid = page.getByRole("grid", { name: "July 2026" });
  const composer = page.getByRole("region", { name: "Capture a moment" });
  await expect(grid).toBeVisible();
  await expect(composer).toBeVisible();

  const layout = await page.evaluate(() => {
    const gridElement = document.querySelector('[role="grid"]');
    const composerElement = document.querySelector(".composer-shell-inline");
    const selectedElement = document.querySelector(".selected-day");
    if (!gridElement || !composerElement || !selectedElement) return null;
    const gridBox = gridElement.getBoundingClientRect();
    const selectedBox = selectedElement.getBoundingClientRect();
    const composerBox = composerElement.getBoundingClientRect();
    return {
      noHorizontalOverflow:
        document.documentElement.scrollWidth <= window.innerWidth + 1,
      selectedAfterGrid: selectedBox.top >= gridBox.bottom,
      composerAfterSelected: composerBox.top >= selectedBox.bottom,
    };
  });
  expect(layout).toEqual({
    noHorizontalOverflow: true,
    selectedAfterGrid: true,
    composerAfterSelected: true,
  });

  const dateTarget = await page
    .getByRole("link", {
      name: "Monday, July 13, 2026, selected, no Entries",
    })
    .boundingBox();
  expect(dateTarget).not.toBeNull();
  expect(dateTarget!.width).toBeGreaterThanOrEqual(36);
  expect(dateTarget!.height).toBeGreaterThanOrEqual(44);
});
