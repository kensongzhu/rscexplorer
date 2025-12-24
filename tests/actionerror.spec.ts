import { test, expect, beforeAll, afterAll, afterEach } from "vitest";
import { createHelpers, launchBrowser, type TestHelpers } from "./helpers.ts";
import type { Browser, Page } from "playwright";

const ACTION_ERROR_SERVER = `import { Button } from './client'

export default function App() {
  return (
    <div>
      <h1>Action Error</h1>
      <Button failAction={failAction} />
    </div>
  )
}

async function failAction() {
  'use server'
  throw new Error('Action failed intentionally')
}`;

const ACTION_ERROR_CLIENT = `'use client'

import { useTransition } from 'react'

export function Button({ failAction }) {
  const [isPending, startTransition] = useTransition()

  const handleClick = () => {
    startTransition(async () => {
      await failAction()
    })
  }

  return (
    <button onClick={handleClick} disabled={isPending}>
      {isPending ? 'Running...' : 'Trigger Failing Action'}
    </button>
  )
}`;

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

test("action error - throwing action shows error in entry and clears pending state", async () => {
  await h.loadCode(ACTION_ERROR_SERVER, ACTION_ERROR_CLIENT);

  // Render completes
  expect(await h.stepAll()).toMatchInlineSnapshot(`
    "<div>
      <h1>Action Error</h1>
      <Button failAction={[Function: failAction]} />
    </div>"
  `);
  expect(await h.preview("Trigger Failing Action")).toMatchInlineSnapshot(`
    "Action Error
    Trigger Failing Action"
  `);

  // Click the button to trigger the failing action
  await h.frame().getByTestId("preview-container").locator("button").click();

  // Wait for the error entry to appear (action fails quickly)
  const errorEntry = h.frame().getByTestId("flight-entry-error");
  await expect.poll(() => errorEntry.count(), { timeout: 10000 }).toBeGreaterThan(0);

  // Verify error message is displayed in the FlightLog entry
  const errorText = await errorEntry.innerText();
  expect(errorText).toContain("Action failed intentionally");

  // Verify preview shows error (no ErrorBoundary, so error propagates)
  expect(await h.preview("Action failed intentionally")).toContain("Action failed intentionally");
});

test("action error - raw action with invalid payload shows error", async () => {
  await h.load("form");

  // Render completes
  expect(await h.stepAll()).toMatchInlineSnapshot(`
    "<div>
      <h1>Form Action</h1>
      <Form greetAction={[Function: greet]} />
    </div>"
  `);

  // Click + to add raw action
  await h.frame().locator(".FlightLog-addButton").click();

  // Enter invalid payload (not valid URLSearchParams format for decodeReply)
  await h.frame().locator(".FlightLog-rawForm-textarea").fill("invalid-payload-that-will-fail");

  // Submit
  await h.frame().locator(".FlightLog-rawForm-submitBtn").click();

  // Wait for the error entry to appear
  const errorEntry = h.frame().getByTestId("flight-entry-error");
  await expect.poll(() => errorEntry.count(), { timeout: 10000 }).toBeGreaterThan(0);

  // Verify error message includes our helpful hint about payload format
  const errorText = await errorEntry.innerText();
  expect(errorText).toContain("React couldn't parse the request payload");
});
