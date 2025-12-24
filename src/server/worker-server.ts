// Server Worker - RSC server simulation

import "../shared/webpack-shim.ts";
import { polyfillReady } from "../shared/polyfill.ts";

import {
  renderToReadableStream,
  registerServerReference,
  createClientModuleProxy,
  decodeReply,
} from "react-server-dom-webpack/server";
import React from "react";
import type { ClientManifest } from "../shared/compiler.ts";

declare const self: DedicatedWorkerGlobalScope;

// --- Types ---

export type EncodedArgs = {
  type: "formdata" | "string";
  data: string;
};

export type Response =
  | { type: "ready" }
  | { type: "next"; requestId: string; value: Uint8Array }
  | { type: "done"; requestId: string }
  | { type: "throw"; requestId: string; error: string; stack?: string };

// --- State ---

type ServerModule = {
  default?: React.ComponentType | React.ReactNode;
  [key: string]: unknown;
};

let deployed: { manifest: ClientManifest; module: ServerModule } | null = null;

// --- Response helpers ---

async function sendStream(
  requestId: string,
  getStream: () => ReadableStream<Uint8Array> | Promise<ReadableStream<Uint8Array>>,
): Promise<void> {
  try {
    const stream = await getStream();
    const reader = stream.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      self.postMessage({ type: "next", requestId, value });
    }
    self.postMessage({ type: "done", requestId });
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    const msg: Response = { type: "throw", requestId, error: error.message };
    if (error.stack) {
      msg.stack = error.stack;
    }
    self.postMessage(msg);
  }
}

// --- RPC handlers ---

function deploy(
  compiledCode: string,
  manifest: ClientManifest,
  actionNames: string[],
): ReadableStream<Uint8Array> {
  const clientModule = createClientModuleProxy("client");
  const modules: Record<string, unknown> = {
    react: React,
    "./client": clientModule,
  };

  let code = compiledCode;
  if (actionNames.length > 0) {
    code +=
      "\n" +
      actionNames
        .map(
          (name) =>
            `__registerServerReference(${name}, "${name}", "${name}"); exports.${name} = ${name};`,
        )
        .join("\n");
  }

  const module: { exports: ServerModule } = { exports: {} };
  const require = (id: string): unknown => {
    if (!modules[id]) throw new Error(`Module "${id}" not found`);
    return modules[id];
  };

  new Function("module", "exports", "require", "React", "__registerServerReference", code)(
    module,
    module.exports,
    require,
    React,
    registerServerReference,
  );

  deployed = { manifest, module: module.exports };
  return new ReadableStream({ start: (c) => c.close() });
}
export type Deploy = typeof deploy;

const renderOptions = {
  onError: () => "Switch to dev mode (top right) to see the full error.",
};

function render(): ReadableStream<Uint8Array> {
  if (!deployed) throw new Error("No code deployed");
  const App = deployed.module.default as React.ComponentType;
  return renderToReadableStream(React.createElement(App), deployed.manifest, renderOptions);
}
export type Render = typeof render;

async function callAction(
  actionId: string,
  encodedArgs: EncodedArgs,
): Promise<ReadableStream<Uint8Array>> {
  if (!deployed) throw new Error("No code deployed");
  if (!Object.hasOwn(deployed.module, actionId)) {
    throw new Error(`Action "${actionId}" not found`);
  }
  const actionFn = deployed.module[actionId] as Function;

  let body: FormData | string;
  if (encodedArgs.type === "formdata") {
    body = new FormData();
    for (const [key, value] of new URLSearchParams(encodedArgs.data)) {
      body.append(key, value);
    }
  } else {
    body = encodedArgs.data;
  }

  let decoded;
  try {
    decoded = await decodeReply(body, {});
  } catch (e: any) {
    let message;
    message =
      "React couldn't parse the request payload. " +
      "Try triggering a real action first and copying its payload format.";
    if (e?.message !== "Connection closed.") {
      message += "\n\n" + e.toString();
    }
    throw new Error(message);
  }
  const args = Array.isArray(decoded) ? decoded : [decoded];
  const result = await actionFn(...args);

  return renderToReadableStream(result, deployed.manifest, renderOptions);
}
export type CallAction = typeof callAction;

// --- Message dispatch ---

self.onmessage = (
  event: MessageEvent<
    { requestId: string } & (
      | { method: "deploy"; args: Parameters<Deploy> }
      | { method: "render"; args: Parameters<Render> }
      | { method: "action"; args: Parameters<CallAction> }
    )
  >,
) => {
  const req = event.data;
  switch (req.method) {
    case "deploy":
      sendStream(req.requestId, () => deploy(...req.args));
      break;
    case "render":
      sendStream(req.requestId, () => render(...req.args));
      break;
    case "action":
      sendStream(req.requestId, () => callAction(...req.args));
      break;
  }
};

polyfillReady.then(() => {
  self.postMessage({ type: "ready" });
});
