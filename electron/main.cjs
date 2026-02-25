"use strict";
const { app, BrowserWindow, shell } = require("electron");
const { spawn } = require("child_process");
const path = require("path");
const net = require("net");
const fs = require("fs");

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
// External binaries (Deno) can't read from inside the asar archive,
// so we need the real filesystem path for spawned scripts.
const filesRoot = isPacked
    ? root.replace("app.asar", "app.asar.unpacked")
    : root;

// Deno binary is an extraResource — lives outside the app folder in both modes
const denoBin = isPacked
    ? path.join(process.resourcesPath, "deno-bin", process.platform === "win32" ? "deno.exe" : "deno")
    : path.join(root, "node_modules", "deno", process.platform === "win32" ? "deno.exe" : "deno");

const backendScript = path.join(filesRoot, "backend", "server.ts");
const nuxtEntry = path.join(filesRoot, ".output", "server", "index.mjs");

let denoPort = null;
let nuxtPort = null;

let denoProc = null;
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
log(`denoBin    = ${denoBin}`);
log(`backend    = ${backendScript}`);
log(`nuxtEntry  = ${nuxtEntry}`);
log(`deno exists  = ${fs.existsSync(denoBin)}`);
log(`backend exists = ${fs.existsSync(backendScript)}`);
log(`nuxt exists    = ${fs.existsSync(nuxtEntry)}`);

// ── Child processes ──────────────────────────────────────────────────
function startDeno() {
    log("[deno] spawning...");
    denoProc = spawn(
        denoBin,
        ["run", "--allow-all", backendScript],
        {
            cwd: filesRoot,
            env: { ...process.env, DENO_PORT: denoPort },
            stdio: ["ignore", "pipe", "pipe"],
        }
    );
    denoProc.stdout.on("data", (d) => log(`[deno:out] ${d.toString().trimEnd()}`));
    denoProc.stderr.on("data", (d) => log(`[deno:err] ${d.toString().trimEnd()}`));
    denoProc.on("error", (err) => log(`[deno:error] ${err.message}`));
    denoProc.on("exit", (code) => log(`[deno:exit] code=${code}`));
}

function startNuxt() {
    log("[nuxt] spawning...");
    nuxtProc = spawn(
        process.execPath, // the Electron binary, used as Node.js via ELECTRON_RUN_AS_NODE
        [nuxtEntry],
        {
            cwd: filesRoot,
            env: {
                ...process.env,
                ELECTRON_RUN_AS_NODE: "1", // run as plain Node.js, not as Electron app
                PORT: nuxtPort,
                HOST: "127.0.0.1",
                NODE_ENV: "production",
                DENO_URL: "http://localhost",
                DENO_PORT: denoPort,
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
    // A second instance tried to launch — focus the existing window instead
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

app.whenReady().then(async () => {
    // Let the OS assign guaranteed-free ports
    nuxtPort = await getFreePort();
    denoPort = await getFreePort();
    log(`[main] Assigned ports: nuxt=${nuxtPort}, deno=${denoPort}`);

    startDeno();
    startNuxt();

    try {
        await waitForPort(nuxtPort);
        log("[main] Nuxt server is ready, creating window");
        createWindow();
    } catch (err) {
        log(`[main] Nuxt server did not start: ${err.message}`);
        // Read the log so far and show it in an error window
        logStream.end();
        const logContent = fs.readFileSync(logPath, "utf-8");
        showError(logContent);
    }

    app.on("activate", () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on("will-quit", () => {
    try { denoProc?.kill(); } catch {}
    try { nuxtProc?.kill(); } catch {}
});

app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
});
