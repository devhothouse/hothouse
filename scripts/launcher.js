#!/usr/bin/env node
"use strict";

// =========================================================
// HOTHOUSE LAUNCHER (Roadmap A4 / Appendix B)
// ---------------------------------------------------------
// Plain Node, zero dependencies. Double-clicked via `Launch Hothouse.bat`
// (Windows) or `launch-hothouse.sh` (macOS/Linux).
//
// First run: installs dependencies, creates the local database, and builds the
// app. Then it starts the production server AS A CHILD PROCESS bound to
// 127.0.0.1, opens the browser, and keeps running until the user closes the
// window or presses Ctrl+C — which stops the server too. No separate stop
// step. Optional `launch-settings.json`: { "openIncognito": false, "port": 3000 }
// =========================================================

// =========================================================
// MAIN FLOW
// =========================================================

let serverProcess = null;
let shuttingDown = false;

// Stops the child server (and its whole process tree on Windows), then exits.
// Every exit path funnels through here so no node process is ever left behind.
function shutdown(exitCode) {
  if (shuttingDown) return;
  shuttingDown = true;
  try {
    if (serverProcess && serverProcess.pid) {
      if (IS_WINDOWS) {
        spawn("taskkill", ["/pid", String(serverProcess.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
      } else {
        serverProcess.kill("SIGTERM");
      }
    }
  } catch {
    // Best effort — the process 'exit' fallback below also tears the child down.
  }
  setTimeout(() => process.exit(exitCode == null ? 0 : exitCode), 600).unref();
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
process.on("SIGHUP", () => shutdown(0));
process.on("exit", () => {
  try {
    if (serverProcess && serverProcess.pid && !serverProcess.killed) {
      if (IS_WINDOWS) {
        execSync(`taskkill /pid ${serverProcess.pid} /T /F`, { stdio: "ignore" });
      } else {
        serverProcess.kill("SIGTERM");
      }
    }
  } catch {
    // Child already gone.
  }
});

const { spawn, execSync } = require("child_process");
const http = require("http");
const net = require("net");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const IS_WINDOWS = process.platform === "win32";
const PKG = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
const NEXT_BIN = path.join(ROOT, "node_modules", "next", "dist", "bin", "next");
const PRISMA_DB = path.join(ROOT, "prisma", "dev.db");
const BUILD_MARKER = path.join(ROOT, ".next", "hothouse-build-version.txt");
const ENV_FILE = path.join(ROOT, ".env");
const NPM = IS_WINDOWS ? "npm.cmd" : "npm";
const NPX = IS_WINDOWS ? "npx.cmd" : "npx";

function log(msg) {
  console.log(msg);
}

function hr() {
  log("------------------------------------------------------------");
}

// Plain-English failure + optional follow-up hint, then exit.
function fail(title, hint) {
  log("");
  log("  " + title);
  if (hint) log("  " + hint);
  log("");
  process.exit(1);
}

// Optional per-machine preferences. Missing file = defaults (documented in the
// README): normal (non-private) browser window on port 3000.
function readLaunchSettings() {
  const defaults = { openIncognito: false, port: 3000 };
  try {
    const file = path.join(ROOT, "launch-settings.json");
    if (!fs.existsSync(file)) return defaults;
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    return {
      openIncognito: parsed.openIncognito === true,
      port: Number.isInteger(parsed.port) && parsed.port > 0 && parsed.port < 65536 ? parsed.port : 3000,
    };
  } catch {
    log("  (Could not read launch-settings.json — using default launch settings.)");
    return defaults;
  }
}

// True when something already listens on the port.
function portResponding(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: "127.0.0.1", port, timeout: 1500 });
    socket.on("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.on("timeout", () => {
      socket.destroy();
      resolve(false);
    });
    socket.on("error", () => resolve(false));
  });
}

// Polls the app until it answers an HTTP request (any response counts).
function waitForServer(port, timeoutMs) {
  const started = Date.now();
  return new Promise((resolve) => {
    let settled = false;
    const finish = (ok) => {
      if (settled) return;
      settled = true;
      resolve(ok);
    };
    const attempt = () => {
      if (settled) return;
      if (Date.now() - started > timeoutMs) {
        finish(false);
        return;
      }
      const req = http.get({ host: "127.0.0.1", port, path: "/", timeout: 3000 }, (res) => {
        res.resume();
        finish(true);
      });
      req.on("timeout", () => req.destroy());
      req.on("error", () => setTimeout(attempt, 1000));
    };
    attempt();
  });
}

// Runs a command with its output streamed to this console. Resolves true on
// success, false on failure (caller prints the friendly explanation).
function runStep(command, args, useShell) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd: ROOT, stdio: "inherit", shell: !!useShell });
    child.on("exit", (code) => resolve(code === 0));
    child.on("error", () => resolve(false));
  });
}

// Opens the default browser (or Chrome in a private window when configured).
// Fire-and-forget: a failure to open the browser never stops the app — the
// user can always type the address manually.
function openBrowser(url, incognito) {
  try {
    if (IS_WINDOWS) {
      if (incognito) {
        // Matches start_app.bat's `start chrome -incognito` convention; falls
        // back to the default (normal) browser when Chrome is unavailable.
        const child = spawn("cmd", ["/c", "start", "chrome", "-incognito", url], { stdio: "ignore", detached: true, windowsHide: true });
        child.on("exit", (code) => {
          if (code !== 0) {
            spawn("cmd", ["/c", "start", "", url], { stdio: "ignore", detached: true, windowsHide: true });
          }
        });
        child.unref();
      } else {
        const child = spawn("cmd", ["/c", "start", "", url], { stdio: "ignore", detached: true, windowsHide: true });
        child.unref();
      }
    } else if (process.platform === "darwin") {
      const args = incognito ? ["-na", "Google Chrome", "--args", "--incognito", url] : [url];
      const child = spawn("open", args, { stdio: "ignore", detached: true });
      child.unref();
    } else {
      const child = spawn("xdg-open", [url], { stdio: "ignore", detached: true });
      child.unref();
    }
  } catch {
    // Non-fatal: the URL is printed in the banner below.
  }
}

async function main() {
  const settings = readLaunchSettings();

  // ---- Preflight: Node version --------------------------------------------
  const nodeMajor = parseInt(process.versions.node.split(".")[0], 10);
  if (!(nodeMajor >= 20)) {
    fail(
      `Hothouse needs Node.js 20 or newer, but this computer is running Node ${process.versions.node}.`,
      "Please install the current version from https://nodejs.org/ and then start Hothouse again."
    );
  }

  // ---- Preflight: port ------------------------------------------------------
  if (await portResponding(settings.port)) {
    fail(
      `Something is already running on port ${settings.port}, so Hothouse cannot start.`,
      "If Hothouse is already open in another window, just use that window. Otherwise close the other program (or run stop_app.bat) and try again. You can also set a different port in launch-settings.json."
    );
  }

  // ---- One-time setup -------------------------------------------------------
  const firstRun =
    !fs.existsSync(path.join(ROOT, "node_modules")) ||
    !fs.existsSync(PRISMA_DB) ||
    !fs.existsSync(path.join(ROOT, ".next", "BUILD_ID"));
  if (firstRun) {
    hr();
    log("  First-time setup: this one-time step can take a few minutes.");
    log("  Starting Hothouse will be much faster from now on.");
    hr();
  }

  // 1. .env (defines the local database location; present in this workspace,
  //    recreated automatically for clean installs).
  if (!fs.existsSync(ENV_FILE)) {
    fs.writeFileSync(ENV_FILE, 'DATABASE_URL="file:./dev.db"\n', "utf8");
    log("  Created .env with the local database location.");
  }

  // 2. Dependencies
  if (!fs.existsSync(path.join(ROOT, "node_modules"))) {
    log("");
    log("  Installing dependencies (npm install)...");
    if (!(await runStep(NPM, ["install"], IS_WINDOWS))) {
      fail(
        "Installing the app's dependencies failed.",
        "Please check your internet connection and start Hothouse again. If it keeps failing, run 'npm install' inside this folder to see the full error."
      );
    }
  }

  // 3. Local SQLite database
  if (!fs.existsSync(PRISMA_DB)) {
    log("");
    log("  Setting up the local database...");
    if (!(await runStep(NPX, ["prisma", "db", "push"], IS_WINDOWS))) {
      fail(
        "Setting up the database failed.",
        "Please try starting Hothouse again. If it keeps failing, run 'npx prisma db push' inside this folder to see the full error."
      );
    }
  }

  // 4. Production build (also rebuilt automatically after app updates —
  // tracked via a small version marker inside .next).
  let markerVersion = null;
  try {
    markerVersion = fs.readFileSync(BUILD_MARKER, "utf8").trim();
  } catch {}
  if (!fs.existsSync(path.join(ROOT, ".next", "BUILD_ID")) || markerVersion !== PKG.version) {
    log("");
    log("  Building the app (one-time, a few minutes)...");
    if (!(await runStep(NPX, ["next", "build"], IS_WINDOWS))) {
      fail(
        "Building the app failed.",
        "Please try starting Hothouse again. If it keeps failing, run 'npm run build' inside this folder to see the full error."
      );
    }
    try {
      fs.writeFileSync(BUILD_MARKER, PKG.version, "utf8");
    } catch {}
  }

  if (!fs.existsSync(NEXT_BIN)) {
    fail(
      "Hothouse's server files could not be found.",
      "Delete the 'node_modules' folder and start the launcher again to reinstall everything."
    );
  }

  // ---- Start the production server as a child process ------------------------
  serverProcess = spawn(process.execPath, [NEXT_BIN, "start", "-H", "127.0.0.1", "-p", String(settings.port)], {
    cwd: ROOT,
    stdio: "inherit",
  });
  serverProcess.on("error", (err) => {
    fail("The Hothouse server could not be started: " + err.message);
  });
  serverProcess.on("exit", (code) => {
    if (!shuttingDown) {
      log("");
      log("  The Hothouse server stopped" + (code ? ` (exit code ${code}).` : ".") + " You can close this window.");
      process.exit(code == null ? 0 : code);
    }
  });

  // ---- Wait for the app, then open the browser -------------------------------
  log("");
  log("  Starting Hothouse... (this usually takes a few seconds)");
  const ready = await waitForServer(settings.port, 180000);
  if (!ready) {
    log("");
    log("  Hothouse did not start in time. The server output above may show why.");
    log("  Try starting again; if it keeps failing, run 'npm run build' and 'npm start' inside this folder to see the full error.");
    shutdown(1);
    return;
  }

  const url = `http://127.0.0.1:${settings.port}`;
  openBrowser(url, settings.openIncognito);

  log("");
  hr();
  log(`  Hothouse is running:  ${url}`);
  log("");
  log("  You can close the browser tab anytime.");
  log("  KEEP THIS WINDOW OPEN while using Hothouse.");
  log("  Close this window (or press Ctrl+C) to stop Hothouse.");
  hr();
  log("");
}

main().catch((err) => {
  fail("Something went wrong while starting Hothouse: " + (err && err.message ? err.message : String(err)));
});

