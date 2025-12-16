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

test("async sample", async () => {
  await h.load("async");

  // First tree state - Suspense with Pending
  expect(await h.stepAll()).toMatchInlineSnapshot(`
    "<div>
      <h1>Async Component</h1>
      <Suspense fallback={
        <p>Loading...</p>
      }>
        Pending
      </Suspense>
    </div>"
  `);
  expect(await h.preview("Loading")).toMatchInlineSnapshot(`
    "Async Component

    Loading..."
  `);

  // Tree changes when async data resolves
  expect(await h.stepAll()).toMatchInlineSnapshot(`
    "<div>
      <h1>Async Component</h1>
      <Suspense fallback={
        <p>Loading...</p>
      }>
        <p>Data loaded!</p>
      </Suspense>
    </div>"
  `);
  expect(await h.preview("Data loaded")).toMatchInlineSnapshot(`
    "Async Component

    Data loaded!"
  `);
});
