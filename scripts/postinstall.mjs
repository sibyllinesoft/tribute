#!/usr/bin/env node
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const projectRoot = process.cwd();
const binDir = join(projectRoot, "node_modules", ".bin");
const shimPath = join(binDir, "vitest");
try {
  mkdirSync(binDir, { recursive: true });
  if (!existsSync(shimPath)) {
    const shim = "#!/usr/bin/env bash\nDIR=\"$(cd \"$(dirname \"$0\")\" && pwd)\"\nnode \"$DIR/../vitest/vitest.mjs\" \"$@\"\n";
    writeFileSync(shimPath, shim, { mode: 0o755 });
  }
  if (process.platform === "win32") {
    const cmdPath = join(binDir, "vitest.cmd");
    if (!existsSync(cmdPath)) {
      writeFileSync(cmdPath, "@echo off\r\nnode %~dp0\\..\\vitest\\vitest.mjs %*\r\n");
    }
  }
} catch (error) {
  console.warn("postinstall: unable to create vitest shim", error);
}
