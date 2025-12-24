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

test("can step through stream while async component is still pending", async () => {
  // This async component will never resolve - but we should still be able to
  // step through the synchronous parts of the stream (header + Suspense fallback)
  await h.loadCode(
    `
    import { Suspense } from 'react'

    export default function App() {
      return (
        <div>
          <h1>Streaming Test</h1>
          <Suspense fallback={<p>Loading forever...</p>}>
            <NeverResolves />
          </Suspense>
        </div>
      )
    }

    async function NeverResolves() {
      await new Promise(() => {}) // Never resolves
      return <p>This will never appear</p>
    }
    `,
    `'use client'`,
  );

  // We should be able to step through the initial render
  // The Suspense fallback should be visible
  expect(await h.stepAll()).toMatchInlineSnapshot(`
    "<div>
      <h1>Streaming Test</h1>
      <Suspense fallback={
        <p>Loading forever...</p>
      }>
        Pending
      </Suspense>
    </div>"
  `);

  // The preview should show the header and fallback
  expect(await h.preview("Loading forever")).toMatchInlineSnapshot(`
    "Streaming Test

    Loading forever..."
  `);

  // Step info should show "Waiting" (stream is still open)
  expect(await h.stepInfo()).toBe("Waiting");
});
