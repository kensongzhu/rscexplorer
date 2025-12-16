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

test("form sample", async () => {
  await h.load("form");

  expect(await h.stepAll()).toMatchInlineSnapshot(`
    "<div>
      <h1>Form Action</h1>
      <Form greetAction={[Function: greet]} />
    </div>"
  `);
  expect(await h.preview("Greet")).toMatchInlineSnapshot(`
    "Form Action
    Greet"
  `);

  // Submit form
  await h.frame().locator('.preview-container input[name="name"]').fill("World");
  await h.frame().locator(".preview-container button").click();
  expect(await h.preview("Sending")).toMatchInlineSnapshot(`
    "Form Action
    Sending..."
  `);

  // Action response
  expect(await h.stepAll()).toMatchInlineSnapshot(`"{ message: "Hello, World!", error: null }"`);
  expect(await h.preview("Hello, World")).toMatchInlineSnapshot(
    `
    "Form Action
    Greet

    Hello, World!"
  `,
  );
});
