import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

function rolldownWorkerPlugin() {
  let mode = "production";
  return {
    name: "rolldown-worker",
    enforce: "pre",
    configResolved(config) {
      mode = config.mode;
    },
    resolveId(id, importer) {
      if (id.includes("?rolldown-worker")) {
        return "\0worker:" + resolve(dirname(importer), id.replace("?rolldown-worker", ""));
      }
    },
    load: {
      filter: {
        id: {
          include: /^\0worker:/,
        },
      },
      async handler(id) {
        const isProd = mode === "production";
        const { rolldown } = await import("rolldown");
        // Use 'production' or 'development' condition to match React's export conditions
        const conditions = isProd
          ? ["react-server", "production", "browser", "import", "default"]
          : ["react-server", "development", "browser", "import", "default"];
        const bundle = await rolldown({
          input: id.slice("\0worker:".length),
          platform: "browser",
          resolve: { conditionNames: conditions },
          transform: {
            define: {
              "process.env.NODE_ENV": JSON.stringify(isProd ? "production" : "development"),
            },
          },
        });
        const { output } = await bundle.generate({ format: "iife", minify: isProd });
        for (const dep of output[0].moduleIds) {
          if (dep.startsWith("/")) this.addWatchFile(dep);
        }
        await bundle.close();
        return `
  export default URL.createObjectURL(new Blob([${JSON.stringify(output[0].code)}], { type: 'application/javascript' }));
  if (import.meta.hot) import.meta.hot.accept(() => location.reload());`;
      },
    },
  };
}

function serveEmbedPlugin() {
  return {
    name: "serve-embed",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url === "/embed.js") {
          req.url = "/src/embed.ts";
        }
        next();
      });
    },
  };
}

function preloadChunksPlugin() {
  return {
    name: "preload-chunks",
    transformIndexHtml(html, { bundle, filename }) {
      if (!bundle) return; // dev mode
      const tags = [];

      // Preload codemirror and babel chunks
      for (const name of ["codemirror", "babel"]) {
        const chunk = Object.keys(bundle).find((k) => k.includes(name));
        if (chunk) {
          tags.push({
            tag: "link",
            attrs: { rel: "modulepreload", href: "/" + chunk },
            injectTo: "head",
          });
        }
      }

      // From index.html, prefetch embed resources for the iframe
      if (filename.endsWith("index.html")) {
        const embedChunk = Object.keys(bundle).find(
          (k) => k.startsWith("assets/embed") && k.endsWith(".js"),
        );
        if (embedChunk) {
          tags.push({
            tag: "link",
            attrs: { rel: "preload", href: "/" + embedChunk, as: "script", crossorigin: true },
            injectTo: "head",
          });
        }
      }

      return tags;
    },
  };
}

export default defineConfig(({ mode }) => ({
  plugins: [react(), rolldownWorkerPlugin(), serveEmbedPlugin(), preloadChunksPlugin()],
  server: { port: 3333 },
  define: {
    "process.env.NODE_ENV": JSON.stringify(mode === "development" ? "development" : "production"),
  },
  resolve: {
    conditions:
      mode === "development"
        ? ["development", "browser", "import", "default"]
        : ["production", "browser", "import", "default"],
  },
  build: {
    rolldownOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        embed: resolve(__dirname, "embed.html"),
        "embed-js": resolve(__dirname, "src/embed.ts"),
      },
      output: {
        entryFileNames: (chunkInfo) => {
          if (chunkInfo.name === "embed-js") {
            return "embed.js";
          }
          return "assets/[name]-[hash].js";
        },
      },
      preserveEntrySignatures: "exports-only",
    },
  },
}));
