import type * as t from "@babel/types";

// Babel is lazy-loaded and preloaded via <link rel="modulepreload"> in HTML
let babelPromise: Promise<typeof import("@babel/standalone")> | null = null;

function getBabel(): Promise<typeof import("@babel/standalone")> {
  if (!babelPromise) {
    babelPromise = import("@babel/standalone");
  }
  return babelPromise;
}

async function transform(
  code: string,
  options: Parameters<typeof import("@babel/standalone").transform>[1],
): Promise<ReturnType<typeof import("@babel/standalone").transform>> {
  const babel = await getBabel();
  return babel.transform(code, options);
}

type BabelProgram = t.Program & {
  directives?: Array<{ value?: { value?: string } }>;
};

type BabelBlockStatement = t.BlockStatement & {
  directives?: Array<{ value?: { value?: string } }>;
};

type BabelNode =
  | t.FunctionDeclaration
  | t.ExportNamedDeclaration
  | t.ExportDefaultDeclaration
  | t.VariableDeclaration
  | t.ExpressionStatement;

type TransformResult = {
  ast?: {
    program: BabelProgram;
  };
  code?: string;
};

export async function parseExports(code: string): Promise<string[]> {
  const exports: string[] = [];
  const result = (await transform(code, {
    presets: ["react"],
    ast: true,
  })) as TransformResult;

  const ast = result.ast;
  if (!ast) return exports;

  for (const node of ast.program.body as BabelNode[]) {
    if (node.type === "ExportNamedDeclaration") {
      const exportNode = node as t.ExportNamedDeclaration;
      if (exportNode.declaration) {
        if (exportNode.declaration.type === "FunctionDeclaration") {
          const funcDecl = exportNode.declaration as t.FunctionDeclaration;
          if (funcDecl.id) {
            exports.push(funcDecl.id.name);
          }
        } else if (exportNode.declaration.type === "VariableDeclaration") {
          const varDecl = exportNode.declaration as t.VariableDeclaration;
          for (const decl of varDecl.declarations) {
            if (decl.id.type === "Identifier") {
              exports.push(decl.id.name);
            }
          }
        }
      }
    } else if (node.type === "ExportDefaultDeclaration") {
      exports.push("default");
    }
  }
  return exports;
}

function hasDirective(
  block: BabelProgram | BabelBlockStatement | t.BlockStatement | null | undefined,
  directive: string,
): boolean {
  if (!block) return false;

  // Check directives array (preferred way)
  const blockWithDirectives = block as { directives?: Array<{ value?: { value?: string } }> };
  if (blockWithDirectives.directives && blockWithDirectives.directives.length > 0) {
    if (
      blockWithDirectives.directives.some(
        (d: { value?: { value?: string } }) => d.value?.value === directive,
      )
    ) {
      return true;
    }
  }

  // Fallback for some parsers - check body for string expression statements
  const blockWithBody = block as { body?: BabelNode[] };
  if (blockWithBody.body) {
    for (const node of blockWithBody.body) {
      if (node.type !== "ExpressionStatement") break;
      const exprStmt = node as t.ExpressionStatement & { directive?: string };
      if (exprStmt.directive === directive) return true;
      if (
        exprStmt.expression.type === "StringLiteral" &&
        (exprStmt.expression as t.StringLiteral).value === directive
      ) {
        return true;
      }
    }
  }
  return false;
}

function hasUseServerDirective(body: t.BlockStatement | null | undefined): boolean {
  if (!body || body.type !== "BlockStatement") return false;
  return hasDirective(body, "use server");
}

export async function parseServerActions(code: string): Promise<string[]> {
  const result = (await transform(code, {
    presets: ["react"],
    ast: true,
  })) as TransformResult;

  const ast = result.ast;
  if (!ast) return [];

  // 'use client' is not supported - this REPL only handles server code
  if (hasDirective(ast.program, "use client")) {
    throw new Error('"use client" is not supported. This environment only handles server code.');
  }

  const hasModuleUseServer = hasDirective(ast.program, "use server");

  const actions: string[] = [];

  function checkNoUseClient(
    body: t.BlockStatement | t.Expression | null | undefined,
    name: string | undefined,
  ): void {
    if (body && body.type === "BlockStatement" && hasDirective(body, "use client")) {
      throw new Error(
        `"use client" is not supported${name ? ` (found in "${name}")` : ""}. This environment only handles server code.`,
      );
    }
  }

  function collectExportedFunction(
    node: t.FunctionDeclaration | t.FunctionExpression | t.ArrowFunctionExpression,
    name: string,
  ): void {
    const body = node.body;
    if (body.type === "BlockStatement") {
      checkNoUseClient(body, name);
    }
    if (hasModuleUseServer) {
      // Module-level 'use server': all exported functions are actions
      actions.push(name);
    } else if (body.type === "BlockStatement" && hasUseServerDirective(body)) {
      // Function-level 'use server'
      actions.push(name);
    }
  }

  for (const node of ast.program.body as BabelNode[]) {
    if (node.type === "FunctionDeclaration") {
      const funcDecl = node as t.FunctionDeclaration;
      if (funcDecl.id) {
        checkNoUseClient(funcDecl.body, funcDecl.id.name);
        if (!hasModuleUseServer && hasUseServerDirective(funcDecl.body)) {
          actions.push(funcDecl.id.name);
        }
      }
    } else if (node.type === "ExportNamedDeclaration") {
      const exportNode = node as t.ExportNamedDeclaration;
      if (exportNode.declaration) {
        if (exportNode.declaration.type === "FunctionDeclaration") {
          const funcDecl = exportNode.declaration as t.FunctionDeclaration;
          if (funcDecl.id) {
            collectExportedFunction(funcDecl, funcDecl.id.name);
          }
        } else if (exportNode.declaration.type === "VariableDeclaration") {
          const varDecl = exportNode.declaration as t.VariableDeclaration;
          for (const decl of varDecl.declarations) {
            if (decl.id.type === "Identifier" && decl.init) {
              if (
                decl.init.type === "ArrowFunctionExpression" ||
                decl.init.type === "FunctionExpression"
              ) {
                collectExportedFunction(
                  decl.init as t.ArrowFunctionExpression | t.FunctionExpression,
                  decl.id.name,
                );
              }
            }
          }
        }
      }
    } else if (node.type === "VariableDeclaration") {
      const varDecl = node as t.VariableDeclaration;
      for (const decl of varDecl.declarations) {
        if (decl.id.type === "Identifier" && decl.init) {
          if (
            decl.init.type === "ArrowFunctionExpression" ||
            decl.init.type === "FunctionExpression"
          ) {
            const funcInit = decl.init as t.ArrowFunctionExpression | t.FunctionExpression;
            const body = funcInit.body;
            if (body.type === "BlockStatement") {
              checkNoUseClient(body, decl.id.name);
              if (!hasModuleUseServer && hasUseServerDirective(body)) {
                actions.push(decl.id.name);
              }
            }
          }
        }
      }
    }
  }

  return actions;
}

export async function parseClientModule(code: string): Promise<string[]> {
  const result = (await transform(code, {
    presets: ["react"],
    ast: true,
  })) as TransformResult;

  const ast = result.ast;
  if (!ast) return [];

  // Require 'use client' at module level
  if (!hasDirective(ast.program, "use client")) {
    throw new Error('Client code must start with "use client" directive.');
  }

  if (hasDirective(ast.program, "use server")) {
    throw new Error('"use server" is not supported in client code.');
  }

  function checkFunction(
    body: t.BlockStatement | t.Expression | null | undefined,
    name?: string,
  ): void {
    if (!body || body.type !== "BlockStatement") return;
    if (hasDirective(body, "use client")) {
      throw new Error(
        `"use client" must be at module level, not inside functions${name ? ` (found in "${name}")` : ""}.`,
      );
    }
    if (hasDirective(body, "use server")) {
      throw new Error(
        `"use server" is not supported in client code${name ? ` (found in "${name}")` : ""}.`,
      );
    }
  }

  const exports: string[] = [];

  for (const node of ast.program.body as BabelNode[]) {
    if (node.type === "FunctionDeclaration") {
      const funcDecl = node as t.FunctionDeclaration;
      if (funcDecl.id) {
        checkFunction(funcDecl.body, funcDecl.id.name);
      }
    } else if (node.type === "ExportNamedDeclaration") {
      const exportNode = node as t.ExportNamedDeclaration;
      if (exportNode.declaration) {
        if (exportNode.declaration.type === "FunctionDeclaration") {
          const funcDecl = exportNode.declaration as t.FunctionDeclaration;
          checkFunction(funcDecl.body, funcDecl.id?.name);
          if (funcDecl.id) {
            exports.push(funcDecl.id.name);
          }
        } else if (exportNode.declaration.type === "VariableDeclaration") {
          const varDecl = exportNode.declaration as t.VariableDeclaration;
          for (const decl of varDecl.declarations) {
            if (
              decl.init?.type === "ArrowFunctionExpression" ||
              decl.init?.type === "FunctionExpression"
            ) {
              const funcInit = decl.init as t.ArrowFunctionExpression | t.FunctionExpression;
              const name = decl.id.type === "Identifier" ? decl.id.name : undefined;
              checkFunction(funcInit.body, name);
            }
            if (decl.id.type === "Identifier") {
              exports.push(decl.id.name);
            }
          }
        }
      }
    } else if (node.type === "ExportDefaultDeclaration") {
      exports.push("default");
    } else if (node.type === "VariableDeclaration") {
      const varDecl = node as t.VariableDeclaration;
      for (const decl of varDecl.declarations) {
        if (
          decl.init?.type === "ArrowFunctionExpression" ||
          decl.init?.type === "FunctionExpression"
        ) {
          const funcInit = decl.init as t.ArrowFunctionExpression | t.FunctionExpression;
          const name = decl.id.type === "Identifier" ? decl.id.name : undefined;
          checkFunction(funcInit.body, name);
        }
      }
    }
  }

  return exports;
}

export async function compileToCommonJS(code: string): Promise<string> {
  const result = (await transform(code, {
    presets: ["react"],
    sourceType: "module",
    plugins: [["transform-modules-commonjs", { loose: true }]],
  })) as TransformResult;
  return result.code ?? "";
}

export interface ManifestEntry {
  id: string;
  chunks: string[];
  name: string;
}

export type ClientManifest = Record<string, ManifestEntry>;

export function buildManifest(moduleId: string, exportNames: string[]): ClientManifest {
  const manifest: ClientManifest = {
    [moduleId]: {
      id: moduleId,
      chunks: [],
      name: "*",
    },
  };
  for (const name of exportNames) {
    manifest[`${moduleId}#${name}`] = {
      id: moduleId,
      chunks: [],
      name,
    };
  }
  return manifest;
}
