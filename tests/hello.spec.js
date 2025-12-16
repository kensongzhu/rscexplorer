import { test, expect, beforeAll, afterAll, afterEach } from "vitest";
import { createHelpers, launchBrowser } from "./helpers.js";

let browser, page, h;

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

test("hello sample", async () => {
  await h.load("hello");

  expect(await h.stepAll()).toMatchInlineSnapshot(`"<h1>Hello World</h1>"`);
  expect(await h.preview("Hello World")).toMatchInlineSnapshot(`"Hello World"`);
});
