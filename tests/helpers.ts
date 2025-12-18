import { expect } from "vitest";
import { chromium, type Browser, type Page, type FrameLocator } from "playwright";

export async function launchBrowser(): Promise<Browser> {
  const executablePath = process.env.CHROMIUM_PATH;
  return chromium.launch(executablePath ? { executablePath } : undefined);
}

type RowData = {
  text: string | null;
  status: "done" | "next" | "pending";
};

type WaitForOptions = {
  timeout?: number;
};

export type TestHelpers = {
  load: (sample: string) => Promise<void>;
  step: () => Promise<string | null>;
  stepAll: () => Promise<string | null>;
  stepInfo: () => Promise<string>;
  getRows: () => Promise<RowData[]>;
  preview: (waitFor?: string) => Promise<string>;
  tree: () => Promise<string | null>;
  checkNoRemainingSteps: () => Promise<void>;
  frame: () => FrameLocator;
  waitFor: (predicate: () => boolean, options?: WaitForOptions) => Promise<void>;
};

let prevRowTexts: (string | null)[] = [];
let prevStatuses: ("done" | "next" | "pending")[] = [];
let prevPreview = "";
let previewAsserted = true;
let pageRef: Page | null = null;
let frameRef: FrameLocator | null = null;

export function createHelpers(page: Page): TestHelpers {
  pageRef = page;

  async function load(sample: string): Promise<void> {
    await page.goto(`http://localhost:5599/?s=${sample}`);
    // Wait for iframe to load and get frame reference
    const iframe = page.frameLocator("iframe");
    frameRef = iframe;
    // Wait for content inside iframe
    await iframe.getByTestId("flight-entry").first().waitFor({ timeout: 10000 });
    await page.waitForTimeout(100);
    prevRowTexts = [];
    prevStatuses = [];
    prevPreview = await getPreviewText();
    previewAsserted = true;
  }

  async function getPreviewText(): Promise<string> {
    if (!frameRef) throw new Error("frameRef not initialized");
    return (await frameRef.getByTestId("preview-container").innerText()).trim();
  }

  function getStepButton() {
    if (!frameRef) throw new Error("frameRef not initialized");
    return frameRef.getByRole("button", { name: "Step forward" });
  }

  async function doStep(): Promise<string | null> {
    if (!frameRef || !pageRef) throw new Error("refs not initialized");
    const btn = getStepButton();
    if (await btn.isDisabled()) return null;
    await btn.click();
    await pageRef.waitForTimeout(50);

    const rows = await getRows();
    const texts = rows.map((r) => r.text);
    const statuses = rows.map((r) => r.status);

    for (let i = 0; i < Math.min(prevRowTexts.length, texts.length); i++) {
      expect(texts[i], `row ${i} content changed`).toBe(prevRowTexts[i]);
    }

    for (let i = 0; i < Math.min(prevStatuses.length, statuses.length); i++) {
      const prev = prevStatuses[i];
      const curr = statuses[i];
      if (prev === "done") {
        expect(curr, `row ${i}: done should stay done`).toBe("done");
      } else if (prev === "next") {
        expect(curr, `row ${i}: next should become done`).toBe("done");
      }
    }

    const prevNextIdx = prevStatuses.indexOf("next");
    if (prevNextIdx !== -1 && prevNextIdx < statuses.length) {
      expect(statuses[prevNextIdx], `previous "next" row should be "done"`).toBe("done");
    }

    prevRowTexts = texts;
    prevStatuses = statuses;

    return await tree();
  }

  async function step(): Promise<string | null> {
    // Check for unasserted preview changes before stepping
    const currentPreview = await getPreviewText();
    if (currentPreview !== prevPreview && !previewAsserted) {
      expect.fail(
        `preview changed without assertion. Was: "${prevPreview}" Now: "${currentPreview}"`,
      );
    }
    previewAsserted = false;
    return await doStep();
  }

  async function waitForStepButton(): Promise<void> {
    if (!frameRef || !pageRef) throw new Error("refs not initialized");
    const btn = getStepButton();
    // Wait for button to be enabled
    await expect
      .poll(
        async () => {
          return !(await btn.isDisabled());
        },
        { timeout: 10000 },
      )
      .toBe(true);
    await pageRef.waitForTimeout(50);
  }

  async function stepAll(): Promise<string | null> {
    // Check for unasserted preview changes before stepping
    const currentPreview = await getPreviewText();
    if (currentPreview !== prevPreview && !previewAsserted) {
      expect.fail(
        `preview changed without assertion. Was: "${prevPreview}" Now: "${currentPreview}"`,
      );
    }

    // Wait for steps to be available
    await waitForStepButton();

    // Step once first to get initial state after stepping
    let lastTree = await doStep();
    if (lastTree === null) {
      previewAsserted = false;
      return await tree();
    }
    let lastPreview = await getPreviewText();

    // Keep stepping while tree and preview stay the same
    while (true) {
      const nextTree = await doStep();
      if (nextTree === null) break;

      const nextPreview = await getPreviewText();

      // If tree or preview changed from previous step, return new state
      if (nextTree !== lastTree || nextPreview !== lastPreview) {
        previewAsserted = false;
        return nextTree;
      }

      lastTree = nextTree;
      lastPreview = nextPreview;
    }

    previewAsserted = false;
    return await tree();
  }

  async function preview(waitFor?: string): Promise<string> {
    if (waitFor) {
      // Wait for preview to contain the marker
      await expect.poll(() => getPreviewText(), { timeout: 10000 }).toContain(waitFor);
    }
    const current = await getPreviewText();
    if (current !== prevPreview) {
      prevPreview = current;
      previewAsserted = true;
    }
    return current;
  }

  async function stepInfo(): Promise<string> {
    if (!frameRef) throw new Error("frameRef not initialized");
    return (await frameRef.getByTestId("step-info").innerText()).trim();
  }

  async function getRows(): Promise<RowData[]> {
    if (!frameRef) throw new Error("frameRef not initialized");
    // Get all flight lines and determine status by aria-current and position
    return frameRef.getByTestId("flight-line").evaluateAll((els) => {
      const result: { text: string | null; status: "done" | "next" | "pending" }[] = [];
      let foundCurrent = false;

      for (const el of els as HTMLElement[]) {
        const text = el.textContent;
        const isCurrent = el.getAttribute("aria-current") === "step";

        let status: "done" | "next" | "pending";
        if (isCurrent) {
          status = "next";
          foundCurrent = true;
        } else if (foundCurrent) {
          status = "pending";
        } else {
          status = "done";
        }

        // Filter out certain protocol lines
        if (
          text !== null &&
          !text.startsWith(":N") &&
          !/^\w+:D/.test(text) &&
          !/^\w+:\{.*"name"/.test(text) &&
          !/^\w+:\[\[/.test(text)
        ) {
          result.push({ text, status });
        }
      }

      return result;
    });
  }

  async function tree(): Promise<string | null> {
    if (!frameRef) throw new Error("frameRef not initialized");
    // Find the tree in the entry containing the current line, or the last entry's tree
    const treeText = await frameRef.getByTestId("flight-entry").evaluateAll((entries) => {
      const currentLine = document.querySelector('[aria-current="step"]');
      if (currentLine) {
        const entry = currentLine.closest('[data-testid="flight-entry"]');
        const tree = entry?.querySelector('[data-testid="flight-tree"]') as HTMLElement | null;
        return tree?.innerText?.trim() || null;
      }
      // No current line - get the last entry's tree
      if (entries.length === 0) return null;
      const lastEntry = entries[entries.length - 1] as HTMLElement | undefined;
      if (!lastEntry) return null;
      const tree = lastEntry.querySelector('[data-testid="flight-tree"]') as HTMLElement | null;
      return tree?.innerText?.trim() || null;
    });
    return treeText;
  }

  async function checkNoRemainingSteps(): Promise<void> {
    if (!frameRef || !pageRef) throw new Error("refs not initialized");
    const initialTree = await tree();
    const initialPreview = await getPreviewText();

    // Consume remaining steps, but fail if tree or preview changes
    while (true) {
      const btn = getStepButton();
      if (await btn.isDisabled()) break;

      await btn.click();
      await pageRef.waitForTimeout(50);

      const currentTree = await tree();
      const currentPreview = await getPreviewText();

      if (currentTree !== initialTree) {
        expect.fail(
          `Unasserted tree change at end of test.\nWas: ${initialTree}\nNow: ${currentTree}`,
        );
      }
      if (currentPreview !== initialPreview) {
        expect.fail(
          `Unasserted preview change at end of test.\nWas: "${initialPreview}"\nNow: "${currentPreview}"`,
        );
      }
    }
  }

  function frame(): FrameLocator {
    if (!frameRef) throw new Error("frameRef not initialized");
    return frameRef;
  }

  async function waitFor(predicate: () => boolean, options: WaitForOptions = {}): Promise<void> {
    if (!frameRef || !pageRef) throw new Error("refs not initialized");
    const timeout = options.timeout ?? 10000;
    const interval = 50;
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const result = await frameRef.locator("body").evaluate(predicate);
      if (result) return;
      await pageRef.waitForTimeout(interval);
    }
    throw new Error(`waitFor timed out after ${timeout}ms`);
  }

  return {
    load,
    step,
    stepAll,
    stepInfo,
    getRows,
    preview,
    tree,
    checkNoRemainingSteps,
    frame,
    waitFor,
  };
}
