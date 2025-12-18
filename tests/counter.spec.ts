import { test, expect, beforeAll, afterAll, afterEach } from "vitest";
import { createHelpers, launchBrowser, type TestHelpers } from "./helpers.ts";
import type { Browser, Page } from "playwright";

let browser: Browser;
let page: Page;
let h: TestHelpers;

beforeAll(async () => {
  browser = await launchBrowser();
  page = await browser.newPage();
  h = createHelpers(page);
});

afterAll(async () => {
  await browser.close();
});

afterEach(async () => {
  await h.checkNoRemainingSteps();
});

test("counter sample", async () => {
  await h.load("counter");

  expect(await h.stepAll()).toMatchInlineSnapshot(`
    "<div>
      <h1>Counter</h1>
      <Counter initialCount={0} />
    </div>"
  `);
  expect(await h.preview("Count: 0")).toMatchInlineSnapshot(`
    "Counter

    Count: 0

    −
    +"
  `);

  // Client interactivity works
  await h.frame().getByTestId("preview-container").locator("button").last().click();
  expect(await h.preview("Count: 1")).toMatchInlineSnapshot(`
    "Counter

    Count: 1

    −
    +"
  `);
});
