"use strict";
const { app, BrowserWindow, shell, ipcMain, Menu, nativeImage } = require("electron");
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

// ── CLI argument: `locode /path/to/dir` opens with that directory ────
function parseDirArg(argv) {
    // In dev: ['electron', '.', '/path'] → skip 2; packed: ['/app', '/path'] → skip 1
    const skip = isPacked ? 1 : 2;
    for (let i = skip; i < argv.length; i++) {
        const arg = argv[i];
        if (arg.startsWith("-")) continue; // skip flags
        const resolved = path.resolve(arg);
        try {
            if (fs.statSync(resolved).isDirectory()) return resolved;
        } catch {}
    }
    return null;
}

const cliRoot = parseDirArg(process.argv);

// In dev:    __dirname = <project>/electron → root = <project>
// In packed: __dirname = <app>/Resources/app.asar/electron → root = app.asar
const root = path.join(__dirname, "..");

// Files in asarUnpack live at app.asar.unpacked/ on disk.
const filesRoot = isPacked
    ? root.replace("app.asar", "app.asar.unpacked")
    : root;

const nuxtEntry = path.join(filesRoot, ".output", "server", "index.mjs");
const iconPath = path.join(__dirname, "icon.png");

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
        icon: iconPath,
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
    win.webContents.on("console-message", (e) => {
        log(`[window:console] [${e.level}] ${e.message}`);
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

// Second launch: create a new window with the dir arg, or focus existing window
app.on("second-instance", (_event, argv) => {
    log(`[second-instance] argv=${JSON.stringify(argv)}`);
    const dirArg = parseDirArg(argv);
    log(`[second-instance] dirArg=${dirArg}`);
    if (dirArg) {
        // Open a new window with the requested directory
        const win = createWindow(dirArg);
        win.once("ready-to-show", () => win.focus());
    } else {
        // No dir arg — just focus the most recent window
        const wins = BrowserWindow.getAllWindows();
        if (wins.length > 0) {
            const w = wins[0];
            if (w.isMinimized()) w.restore();
            w.focus();
        } else {
            createWindow();
        }
    }
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

        // Detect WSL paths (\\wsl.localhost\... or \\wsl$\...)
        const isWslPath = process.platform === "win32" && /^\\\\wsl[.$\\]/i.test(termCwd);

        let termShell, shellArgs, spawnCwd;
        if (isWslPath) {
            const m = termCwd.match(/^\\\\wsl(?:\.localhost|\$)\\([^\\]+)(.*)$/i);
            const distro = m?.[1] || "";
            const linuxPath = m?.[2]?.replace(/\\/g, "/") || "/";
            termShell = "wsl.exe";
            shellArgs = ["-d", distro, "--cd", linuxPath];
            spawnCwd = undefined; // wsl --cd handles it
        } else {
            termShell = getShell();
            // Spawn a login shell on macOS — Terminal.app and iTerm2 do the same.
            shellArgs = process.platform === "darwin" ? ["-l"] : [];
            spawnCwd = fs.existsSync(termCwd) ? termCwd : home;
        }

        log(`[pty] spawn id=${id} shell=${termShell} args=${shellArgs} cols=${cols} rows=${rows} cwd=${spawnCwd || termCwd}`);
        const term = pty.spawn(termShell, shellArgs, {
            name: "xterm-256color",
            cols: cols || 80,
            rows: rows || 24,
            cwd: spawnCwd,
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

// ── CLI command installer ────────────────────────────────────────────
// Installs the `locode` shell command so users can run `locode .` from terminal.
// macOS: uses osascript for admin privileges (prompts password once)
// Windows: creates locode.cmd and adds to user PATH via registry

function getExpectedMacScript() {
    // Use the Electron binary directly so second-instance receives argv
    return [
        '#!/bin/sh',
        '# LoCode CLI — opens a project in LoCode',
        'DIR=""',
        'if [ -n "$1" ] && [ -d "$1" ]; then',
        '    DIR="$(cd "$1" && pwd)"',
        'fi',
        'if [ -n "$DIR" ]; then',
        `    "${process.execPath}" "$DIR" &`,
        'else',
        `    "${process.execPath}" &`,
        'fi',
    ].join("\n") + "\n";
}

const cliDeclinedFile = path.join(app.getPath("userData"), ".cli-declined");

async function installCLI() {
    if (!isPacked) return;

    const platform = process.platform;

    if (platform === "darwin") {
        const target = "/usr/local/bin/locode";
        const script = getExpectedMacScript();

        // Check if already installed with correct content — skip if up to date
        const alreadyInstalled = fs.existsSync(target);
        try {
            if (alreadyInstalled && fs.readFileSync(target, "utf-8") === script) {
                return;
            }
        } catch {}

        // Already installed but outdated → silently update (user already agreed before)
        if (alreadyInstalled) {
            // fall through to install — no prompt needed
        } else {
            // Never installed — respect previous decline
            if (fs.existsSync(cliDeclinedFile)) return;
        }

        try {
            // Write script to a temp file, then sudo-copy it (avoids shell escaping)
            const tmpFile = path.join(app.getPath("temp"), "locode-cli-install.sh");
            fs.writeFileSync(tmpFile, script, { mode: 0o755 });

            const copyCmd = `do shell script "mkdir -p /usr/local/bin && cp '${tmpFile}' ${target} && chmod 755 ${target}" with administrator privileges`;

            if (alreadyInstalled) {
                // Silent update — user already agreed, just need admin password
                require("child_process").execFileSync("osascript", ["-e", copyCmd], { stdio: "ignore" });
            } else {
                // First install — explain what will happen, then ask for admin privileges
                const osa = [
                    'osascript',
                    '-e', `display dialog "LoCode wants to install the locode command in ${target} so you can open projects from the terminal (e.g. locode .)" buttons {"Cancel", "Install"} default button "Install" with title "LoCode CLI" with icon caution`,
                    '-e', copyCmd,
                ];
                require("child_process").execFileSync(osa[0], osa.slice(1), { stdio: "ignore" });
            }
            try { fs.unlinkSync(tmpFile); } catch {}
            log("[cli] installed /usr/local/bin/locode");
        } catch (err) {
            if (!alreadyInstalled) {
                // User cancelled first install — remember so we don't ask again
                try { fs.writeFileSync(cliDeclinedFile, new Date().toISOString()); } catch {}
            }
            log(`[cli] macOS install ${alreadyInstalled ? "update" : "declined or"} failed: ${err.message}`);
        }
    } else if (platform === "win32") {
        const { execSync } = require("child_process");
        const appDir = path.dirname(process.execPath);
        const exePath = process.execPath;

        // ── Write locode.cmd next to the exe ──
        const cmdFile = path.join(appDir, "locode.cmd");
        const cmdScript = `@echo off\r\nsetlocal\r\nset "DIR="\r\nif not "%~1"=="" if exist "%~1\\*" set "DIR=%~f1"\r\nif defined DIR (\r\n    start "" /d "%SYSTEMROOT%" "${exePath}" "%DIR%" >nul 2>&1\r\n) else (\r\n    start "" /d "%SYSTEMROOT%" "${exePath}" %* >nul 2>&1\r\n)\r\nexit /b 0\r\n`;
        try {
            if (!fs.existsSync(cmdFile) || fs.readFileSync(cmdFile, "utf-8") !== cmdScript) {
                fs.writeFileSync(cmdFile, cmdScript);
                log(`[cli] wrote ${cmdFile}`);
            }
        } catch (err) {
            log(`[cli] failed to write locode.cmd: ${err.message}`);
        }

        // ── Add app directory to user PATH ──
        try {
            let currentPath = "";
            try {
                currentPath = execSync('reg query "HKCU\\Environment" /v Path', { encoding: "utf-8" }).split("REG_EXPAND_SZ")[1]?.trim() || "";
            } catch {
                // Path key doesn't exist yet — we'll create it
            }
            if (!currentPath.includes(appDir)) {
                const newPath = currentPath ? `${currentPath};${appDir}` : appDir;
                execSync(`reg add "HKCU\\Environment" /v Path /t REG_EXPAND_SZ /d "${newPath}" /f`, { stdio: "ignore" });
                log(`[cli] added ${appDir} to user PATH`);
            }
        } catch (err) {
            log(`[cli] PATH update failed: ${err.message}`);
        }

        // ── WSL: install `locode` command in all WSL distros ──
        try {
            const { spawnSync } = require("child_process");
            const distros = execSync('wsl -l -q', { encoding: "utf-16le", timeout: 10000 })
                .split(/\r?\n/).map(s => s.replace(/\0/g, '').trim()).filter(Boolean);
            if (distros.length === 0) throw new Error("no WSL distros");

            const wslExePath = execSync(`wsl -e wslpath -u "${exePath}"`, { encoding: "utf-8", timeout: 10000 }).trim();
            const wslScript = [
                '#!/bin/sh',
                'DIR=""',
                'if [ -n "$1" ] && [ -d "$1" ]; then',
                '    DIR="$(wslpath -w "$(cd "$1" && pwd)")"',
                'fi',
                'if [ -n "$DIR" ]; then',
                `    "${wslExePath}" "$DIR" >/dev/null 2>&1 &`,
                'else',
                `    "${wslExePath}" >/dev/null 2>&1 &`,
                'fi',
            ].join("\n") + "\n";

            // Per-distro prefs: { "Ubuntu": "accepted", "Fedora": "declined" }
            const wslPrefsFile = path.join(app.getPath("userData"), "wsl-cli-prefs.json");
            let wslPrefs = {};
            try { wslPrefs = JSON.parse(fs.readFileSync(wslPrefsFile, "utf-8")); } catch {}

            // If binary exists in a distro, mark as accepted (user approved before)
            for (const d of distros) {
                try { execSync(`wsl -d ${d} -e test -f /usr/local/bin/locode`, { timeout: 5000 }); wslPrefs[d] = "accepted"; }
                catch {} // not installed — keep current pref
            }

            // Which distros need install or update?
            const needInstall = distros.filter(d => {
                try { return execSync(`wsl -d ${d} -e cat /usr/local/bin/locode`, { encoding: "utf-8", timeout: 5000 }) !== wslScript; }
                catch { return true; }
            });

            // Split: updates (previously accepted), new prompts (unknown), skip (declined)
            const toUpdate = needInstall.filter(d => wslPrefs[d] === "accepted");
            const toAsk = needInstall.filter(d => !wslPrefs[d]); // no pref yet
            // declined distros: silently skipped

            if (toUpdate.length === 0 && toAsk.length === 0) {
                log("[cli] WSL: all distros up to date or declined");
            } else {
                // Write tmp files for all distros we'll touch
                for (const d of [...toUpdate, ...toAsk]) {
                    spawnSync('wsl', ['-d', d, '-e', 'sh', '-c', 'cat > /tmp/.locode-cli-tmp'], { input: wslScript, timeout: 5000 });
                }

                // cd to a safe directory — CMD can't run in UNC paths (\\wsl.localhost\...)
                const batLines = ['@echo off', 'cd /d %SYSTEMROOT%', 'title LoCode WSL Install'];

                if (toAsk.length > 0) {
                    batLines.push(
                        'echo.',
                        'echo  LoCode wants to install the "locode" command in your WSL distros',
                        'echo  so you can open projects from WSL (e.g. locode .)',
                        'echo.',
                    );
                }

                // New distros: Y/n prompt, retry on wrong password
                for (const d of toAsk) {
                    const label = d.replace(/[^a-zA-Z0-9]/g, '_');
                    batLines.push(
                        `set /p REPLY="  Install in ${d}? [Y/n] "`,
                        `if /i "%REPLY%"=="n" goto skip_${label}`,
                        `if /i "%REPLY%"=="no" goto skip_${label}`,
                        `:retry_${label}`,
                        `wsl -d ${d} -- sudo sh -c "mv /tmp/.locode-cli-tmp /usr/local/bin/locode && chmod 755 /usr/local/bin/locode"`,
                        `if errorlevel 1 goto retry_${label}`,
                        `:skip_${label}`,
                    );
                }

                // Previously accepted distros: silent update (just sudo, no prompt)
                for (const d of toUpdate) {
                    const label = d.replace(/[^a-zA-Z0-9]/g, '_');
                    batLines.push(
                        `:retry_${label}`,
                        `wsl -d ${d} -- sudo sh -c "mv /tmp/.locode-cli-tmp /usr/local/bin/locode && chmod 755 /usr/local/bin/locode"`,
                        `if errorlevel 1 goto retry_${label}`,
                    );
                }

                batLines.push('exit');
                const batFile = path.join(app.getPath("temp"), "locode-wsl-install.bat");
                fs.writeFileSync(batFile, batLines.join('\r\n') + '\r\n');
                await require("electron").shell.openPath(batFile);

                // Pessimistic: mark new distros as declined
                // Next launch, if binary exists → flipped to "accepted"
                for (const d of toAsk) wslPrefs[d] = "declined";
                try { fs.writeFileSync(wslPrefsFile, JSON.stringify(wslPrefs)); } catch {}

                log(`[cli] WSL install: ask=${toAsk.join(',')}, update=${toUpdate.join(',')}`);
            }
        } catch (err) {
            log(`[cli] WSL install skipped: ${err.message}`);
        }
    }
    // Linux: no auto-install (AppImage is portable)
}

app.whenReady().then(async () => {
    await installCLI();
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

    // macOS dock: right-click menu with "New Window" + dock icon
    if (isMac && app.dock) {
        app.dock.setMenu(Menu.buildFromTemplate([
            { label: "New Window", click: () => createWindow() },
        ]));
        app.dock.setIcon(nativeImage.createFromPath(iconPath));
    }

    nuxtPort = await getFreePort();
    log(`[main] Assigned port: nuxt=${nuxtPort}`);

    startNuxt();

    try {
        await waitForPort(nuxtPort);
        log("[main] Nuxt server is ready, creating window(s)");

        // CLI argument takes priority over session restore
        if (cliRoot) {
            log(`[main] Opening directory from CLI arg: ${cliRoot}`);
            createWindow(cliRoot);
        } else {
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
