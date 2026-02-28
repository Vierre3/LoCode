"use strict";
const { app, BrowserWindow, shell, ipcMain, Menu } = require("electron");
const { spawn } = require("child_process");
const path = require("path");
const net = require("net");
const fs = require("fs");
const os = require("os");

// Single instance: second launch creates a new window in the existing process
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

// ── Multi-window session tracking ────────────────────────────────────
// Map<BrowserWindow, rootPath string>
const windows = new Map();
const sessionsFile = path.join(app.getPath("userData"), "sessions.json");

function loadSessions() {
    try {
        if (fs.existsSync(sessionsFile)) {
            const data = JSON.parse(fs.readFileSync(sessionsFile, "utf-8"));
            if (Array.isArray(data)) return data;
        }
    } catch {}
    return [];
}

function saveSessions() {
    const roots = [];
    for (const rootVal of windows.values()) {
        roots.push(rootVal || "");
    }
    try {
        fs.writeFileSync(sessionsFile, JSON.stringify(roots), "utf-8");
        log(`[session] saved ${roots.length} session(s)`);
    } catch (err) {
        log(`[session] save error: ${err.message}`);
    }
}

// Track which window owns which terminal (for IPC routing)
const terminalOwner = new Map(); // terminal id → BrowserWindow

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

let isQuitting = false;

function createWindow(rootPath) {
    const win = new BrowserWindow({
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

    windows.set(win, rootPath || "");
    log(`[window] created (root=${rootPath || "<none>"}, total=${windows.size})`);

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

    const url = rootPath
        ? `http://127.0.0.1:${nuxtPort}?root=${encodeURIComponent(rootPath)}`
        : `http://127.0.0.1:${nuxtPort}`;
    win.loadURL(url);

    // Open external links in the system browser, not in the Electron window
    win.webContents.setWindowOpenHandler(({ url }) => {
        shell.openExternal(url);
        return { action: "deny" };
    });

    win.on("closed", () => {
        windows.delete(win);
        log(`[window] closed (remaining=${windows.size})`);
        // Save sessions on each individual close (unless app is quitting — handled in will-quit)
        if (!isQuitting) saveSessions();
    });

    return win;
}

function showError(message) {
    const win = new BrowserWindow({
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
}

// Second launch: create a new window in the existing process
app.on("second-instance", () => {
    createWindow();
});

// ── Session root tracking (renderer notifies main when rootPath changes) ──
ipcMain.on("session:setRoot", (event, rootPath) => {
    for (const [win, _] of windows) {
        if (!win.isDestroyed() && win.webContents === event.sender) {
            windows.set(win, rootPath || "");
            log(`[session] window root updated: ${rootPath}`);
            saveSessions();
            break;
        }
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

        // Find the window that created this terminal
        let ownerWin = null;
        for (const [w] of windows) {
            if (!w.isDestroyed() && w.webContents === _event.sender) {
                ownerWin = w;
                break;
            }
        }
        terminalOwner.set(id, ownerWin);

        term.onData((data) => {
            const w = terminalOwner.get(id);
            if (w && !w.isDestroyed()) {
                w.webContents.send("term:data", { id, data });
            }
        });

        term.onExit(({ exitCode }) => {
            const w = terminalOwner.get(id);
            if (w && !w.isDestroyed()) {
                w.webContents.send("term:exit", { id, code: exitCode });
            }
            terminals.delete(id);
            terminalOwner.delete(id);
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
    terminalOwner.delete(id);
});

app.whenReady().then(async () => {
    // ── Application menu (enables "New Window" in dock right-click on macOS) ──
    const isMac = process.platform === "darwin";
    const template = [
        ...(isMac ? [{ role: "appMenu" }] : []),
        {
            label: "File",
            submenu: [
                { label: "New Window", accelerator: "CmdOrCtrl+Shift+N", click: () => createWindow() },
                { type: "separator" },
                isMac ? { role: "close" } : { role: "quit" },
            ],
        },
        { role: "editMenu" },
        {
            label: "View",
            submenu: [
                { role: "reload" },
                { role: "forceReload" },
                { role: "toggleDevTools" },
                { type: "separator" },
                { role: "resetZoom" },
                { role: "zoomIn" },
                { role: "zoomOut" },
                { type: "separator" },
                { role: "togglefullscreen" },
            ],
        },
        { role: "windowMenu" },
    ];
    Menu.setApplicationMenu(Menu.buildFromTemplate(template));

    nuxtPort = await getFreePort();
    log(`[main] Assigned port: nuxt=${nuxtPort}`);

    startNuxt();

    try {
        await waitForPort(nuxtPort);
        log("[main] Nuxt server is ready, creating window(s)");

        // Restore previous sessions or create a single default window
        const savedSessions = loadSessions();
        if (savedSessions.length > 0) {
            log(`[session] restoring ${savedSessions.length} session(s)`);
            for (const rootVal of savedSessions) {
                createWindow(rootVal || undefined);
            }
        } else {
            createWindow();
        }
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

// before-quit fires BEFORE windows start closing — save sessions while the map is still populated
app.on("before-quit", () => {
    isQuitting = true;
    saveSessions();
});

app.on("will-quit", () => {
    for (const term of terminals.values()) {
        try { term.kill(); } catch {}
    }
    terminals.clear();
    terminalOwner.clear();
    try { nuxtProc?.kill(); } catch {}
});

app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
});
