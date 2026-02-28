"use strict";
const { app, BrowserWindow, shell, ipcMain } = require("electron");
const { spawn } = require("child_process");
const path = require("path");
const net = require("net");
const fs = require("fs");
const os = require("os");

// Prevent multiple instances — second launch focuses the existing window instead
if (!app.requestSingleInstanceLock()) {
    app.quit();
    process.exit(0);
}

const isPacked = app.isPackaged;

// In dev:    __dirname = <project>/electron → root = <project>
// In packed: __dirname = <app>/Resources/app.asar/electron → root = app.asar
const root = path.join(__dirname, "..");

// Files in asarUnpack live at app.asar.unpacked/ on disk.
const filesRoot = isPacked
    ? root.replace("app.asar", "app.asar.unpacked")
    : root;

const nuxtEntry = path.join(filesRoot, ".output", "server", "index.mjs");

let nuxtPort = null;
let nuxtProc = null;
let win = null;

// ── Logging ──────────────────────────────────────────────────────────
const logPath = path.join(app.getPath("userData"), "locode.log");
const logStream = fs.createWriteStream(logPath, { flags: "w" }); // overwrite each launch

function log(msg) {
    const line = `[${new Date().toISOString()}] ${msg}`;
    logStream.write(line + "\n");
    console.log(line);
}

log(`LoCode starting — packed=${isPacked}`);
log(`root       = ${root}`);
log(`filesRoot  = ${filesRoot}`);
log(`nuxtEntry  = ${nuxtEntry}`);
log(`nuxt exists = ${fs.existsSync(nuxtEntry)}`);

// ── Child processes ──────────────────────────────────────────────────
function startNuxt() {
    log("[nuxt] spawning...");
    nuxtProc = spawn(
        process.execPath, // the Electron binary, used as Node.js via ELECTRON_RUN_AS_NODE
        [nuxtEntry],
        {
            cwd: filesRoot,
            env: {
                ...process.env,
                ELECTRON_RUN_AS_NODE: "1",
                PORT: nuxtPort,
                HOST: "127.0.0.1",
                NODE_ENV: "production",
            },
            stdio: ["ignore", "pipe", "pipe"],
        }
    );
    nuxtProc.stdout.on("data", (d) => log(`[nuxt:out] ${d.toString().trimEnd()}`));
    nuxtProc.stderr.on("data", (d) => log(`[nuxt:err] ${d.toString().trimEnd()}`));
    nuxtProc.on("error", (err) => log(`[nuxt:error] ${err.message}`));
    nuxtProc.on("exit", (code) => log(`[nuxt:exit] code=${code}`));
}

/** Poll until TCP port is accepting connections, then resolve. */
function waitForPort(port, retries = 40, delay = 250) {
    return new Promise((resolve, reject) => {
        let attempts = 0;
        const tryConnect = () => {
            const sock = net.createConnection({ port: Number(port), host: "127.0.0.1" });
            sock.once("connect", () => { sock.destroy(); resolve(); });
            sock.once("error", () => {
                sock.destroy();
                if (++attempts >= retries) return reject(new Error(`Port ${port} not ready`));
                setTimeout(tryConnect, delay);
            });
        };
        tryConnect();
    });
}

function createWindow() {
    win = new BrowserWindow({
        width: 1280,
        height: 800,
        minWidth: 600,
        minHeight: 400,
        title: "LoCode",
        backgroundColor: "#0d1117",
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, "preload.cjs"),
        },
    });

    // Log page load events for debugging
    win.webContents.on("did-fail-load", (e, code, desc, url) => {
        log(`[window] did-fail-load: code=${code} desc=${desc} url=${url}`);
    });
    win.webContents.on("did-finish-load", () => {
        log("[window] did-finish-load");
    });
    win.webContents.on("console-message", (e, level, msg, line, sourceId) => {
        log(`[window:console] [${level}] ${msg}`);
    });

    win.loadURL(`http://127.0.0.1:${nuxtPort}`);

    // Open external links in the system browser, not in the Electron window
    win.webContents.setWindowOpenHandler(({ url }) => {
        shell.openExternal(url);
        return { action: "deny" };
    });

    win.on("closed", () => { win = null; });
}

function showError(message) {
    win = new BrowserWindow({
        width: 700,
        height: 500,
        title: "LoCode — Error",
        backgroundColor: "#0d1117",
    });
    const html = `<html><body style="background:#0d1117;color:#f0f0f0;font-family:monospace;padding:2em">
        <h2 style="color:#ff6b6b">LoCode failed to start</h2>
        <pre style="white-space:pre-wrap;font-size:13px">${message.replace(/</g, "&lt;")}</pre>
        <p style="color:#888;margin-top:2em">Log file: ${logPath.replace(/</g, "&lt;")}</p>
        </body></html>`;
    win.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(html));
    win.on("closed", () => { win = null; });
}

app.on("second-instance", () => {
    if (win) {
        if (win.isMinimized()) win.restore();
        win.focus();
    }
});

/** Ask the OS for a free port by binding to port 0, then release it. */
function getFreePort() {
    return new Promise((resolve, reject) => {
        const srv = net.createServer();
        srv.once("error", reject);
        srv.listen({ port: 0, host: "127.0.0.1" }, () => {
            const port = String(srv.address().port);
            srv.close(() => resolve(port));
        });
    });
}

// ── Terminal PTY (runs in main process — avoids ELECTRON_RUN_AS_NODE issues) ──
const terminals = new Map();

function getShell() {
    return process.env.SHELL
        || (process.platform === "darwin" ? "/bin/zsh"
            : process.platform === "win32" ? "powershell.exe" : "/bin/bash");
}

ipcMain.handle("term:create", (_event, { id, cols, rows, cwd }) => {
    try {
        // Lazy-load node-pty in the main process
        const pty = require("node-pty");
        const home = os.homedir();
        const termCwd = cwd || home;
        const termShell = getShell();

        // Spawn a login shell on macOS — Terminal.app and iTerm2 do the same.
        // Without -l, /etc/zprofile isn't sourced → LANG/LC_ALL may be missing,
        // causing zsh to miscount multi-byte characters (┌─✓❯) in the prompt.
        const shellArgs = process.platform === "darwin" ? ["-l"] : [];

        log(`[pty] spawn id=${id} shell=${termShell} args=${shellArgs} cols=${cols} rows=${rows} cwd=${termCwd}`);
        const term = pty.spawn(termShell, shellArgs, {
            name: "xterm-256color",
            cols: cols || 80,
            rows: rows || 24,
            cwd: fs.existsSync(termCwd) ? termCwd : home,
            env: {
                ...process.env,
                TERM: "xterm-256color",
                COLORTERM: "truecolor",
                HOME: home,
                LANG: process.env.LANG || "en_US.UTF-8",
            },
        });

        terminals.set(id, term);

        term.onData((data) => {
            if (win && !win.isDestroyed()) {
                win.webContents.send("term:data", { id, data });
            }
        });

        term.onExit(({ exitCode }) => {
            if (win && !win.isDestroyed()) {
                win.webContents.send("term:exit", { id, code: exitCode });
            }
            terminals.delete(id);
        });

        return { ok: true };
    } catch (err) {
        log(`[pty] error: ${err.message}`);
        return { ok: false, error: err.message };
    }
});

ipcMain.on("term:input", (_event, { id, data }) => {
    terminals.get(id)?.write(data);
});

ipcMain.on("term:resize", (_event, { id, cols, rows }) => {
    try { terminals.get(id)?.resize(cols, rows); } catch {}
});

ipcMain.on("term:kill", (_event, { id }) => {
    try { terminals.get(id)?.kill(); } catch {}
    terminals.delete(id);
});

app.whenReady().then(async () => {
    nuxtPort = await getFreePort();
    log(`[main] Assigned port: nuxt=${nuxtPort}`);

    startNuxt();

    try {
        await waitForPort(nuxtPort);
        log("[main] Nuxt server is ready, creating window");
        createWindow();
    } catch (err) {
        log(`[main] Nuxt server did not start: ${err.message}`);
        logStream.end();
        const logContent = fs.readFileSync(logPath, "utf-8");
        showError(logContent);
    }

    app.on("activate", () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on("will-quit", () => {
    for (const term of terminals.values()) {
        try { term.kill(); } catch {}
    }
    terminals.clear();
    try { nuxtProc?.kill(); } catch {}
});

app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
});
