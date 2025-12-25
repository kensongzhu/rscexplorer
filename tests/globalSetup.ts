import { spawn, type ChildProcess } from "child_process";

let server: ChildProcess | null = null;

async function waitForServer(url: string, timeout = 30000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // Server not ready yet
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("Test server start timeout");
}

export async function setup(): Promise<void> {
  server = spawn("npx", ["vite", "--port", "5599", "--strictPort"], {
    stdio: "inherit",
    shell: true,
    detached: true,
  });

  server.on("close", (code) => {
    if (code === 1) {
      console.error("\n\x1b[31mTest server failed to start (port 5599 in use?)\x1b[0m\n");
      process.exit(1);
    }
  });

  await waitForServer("http://localhost:5599");
}

export async function teardown(): Promise<void> {
  if (server && server.pid) {
    // Kill the entire process group (negative PID) to ensure
    // child processes spawned by the shell are also terminated
    try {
      process.kill(-server.pid, "SIGTERM");
    } catch {
      // Process may already be dead
    }
  }
}
