"use strict";
const { app, BrowserWindow, shell, ipcMain, Menu, nativeImage } = require("electron");
const { spawn, execSync, execFileSync, spawnSync } = require("child_process");
const path = require("path");
const net = require("net");
const fs = require("fs");
const os = require("os");

// ── Single instance lock ─────────────────────────────────────────────
if (!app.requestSingleInstanceLock()) {
    app.quit();
    process.exit(0);
}

const isPacked = app.isPackaged;

// ── CLI argument: `locode /path/to/dir` opens with that directory ────
function parseDirArg(argv, cwd) {
    const skip = isPacked ? 1 : 2;
    for (let i = skip; i < argv.length; i++) {
        const arg = argv[i];
        if (arg.startsWith("-")) continue;
        const resolved = cwd ? path.resolve(cwd, arg) : path.resolve(arg);
        try { if (fs.statSync(resolved).isDirectory()) return resolved; } catch {}
    }
    return null;
}

const cliRoot = parseDirArg(process.argv);

// ── Paths ────────────────────────────────────────────────────────────
const root = path.join(__dirname, "..");
const filesRoot = isPacked ? root.replace("app.asar", "app.asar.unpacked") : root;
const nuxtEntry = path.join(filesRoot, ".output", "server", "index.mjs");
const iconPath = path.join(__dirname, "icon.png");

let nuxtPort = null;
let nuxtProc = null;

// ── Logging ──────────────────────────────────────────────────────────
const logPath = path.join(app.getPath("userData"), "locode.log");
const logStream = fs.createWriteStream(logPath, { flags: "w" });

function log(msg) {
    logStream.write(`[${new Date().toISOString()}] ${msg}\n`);
}

log(`LoCode starting — packed=${isPacked} root=${root} nuxtExists=${fs.existsSync(nuxtEntry)}`);

// ── Multi-window session tracking ────────────────────────────────────
const windows = new Map(); // BrowserWindow → rootPath
const sessionsFile = path.join(app.getPath("userData"), "sessions.json");

function loadSessions() {
    try {
        const data = JSON.parse(fs.readFileSync(sessionsFile, "utf-8"));
        if (Array.isArray(data)) return data;
    } catch {}
    return [];
}

function saveSessions() {
    const roots = Array.from(windows.values()).map(r => r || "");
    try {
        fs.writeFileSync(sessionsFile, JSON.stringify(roots), "utf-8");
    } catch (err) {
        log(`[session] save error: ${err.message}`);
    }
}

// Find the BrowserWindow that sent an IPC event
function getWindowFromEvent(event) {
    for (const win of windows.keys()) {
        if (!win.isDestroyed() && win.webContents === event.sender) return win;
    }
    return null;
}

const terminalOwner = new Map(); // terminal id → BrowserWindow

// ── Child processes ──────────────────────────────────────────────────
function startNuxt() {
    log("[nuxt] spawning...");
    nuxtProc = spawn(process.execPath, [nuxtEntry], {
        cwd: filesRoot,
        env: {
            ...process.env,
            ELECTRON_RUN_AS_NODE: "1",
            PORT: nuxtPort,
            HOST: "127.0.0.1",
            NODE_ENV: "production",
        },
        stdio: ["ignore", "pipe", "pipe"],
    });
    nuxtProc.stdout.on("data", (d) => log(`[nuxt:out] ${d.toString().trimEnd()}`));
    nuxtProc.stderr.on("data", (d) => log(`[nuxt:err] ${d.toString().trimEnd()}`));
    nuxtProc.on("error", (err) => log(`[nuxt:error] ${err.message}`));
    nuxtProc.on("exit", (code) => log(`[nuxt:exit] code=${code}`));
}

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

// ── Window management ────────────────────────────────────────────────
let isQuitting = false;

function createWindow(rootPath) {
    const win = new BrowserWindow({
        width: 1280, height: 800, minWidth: 600, minHeight: 400,
        title: "LoCode", icon: iconPath, backgroundColor: "#0d1117",
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, "preload.cjs"),
        },
    });

    windows.set(win, rootPath || "");
    log(`[window] created (root=${rootPath || "<none>"}, total=${windows.size})`);

    win.webContents.on("did-fail-load", (_e, code, desc, url) => {
        log(`[window] did-fail-load: code=${code} desc=${desc} url=${url}`);
    });

    const url = rootPath
        ? `http://127.0.0.1:${nuxtPort}?root=${encodeURIComponent(rootPath)}`
        : `http://127.0.0.1:${nuxtPort}`;
    win.loadURL(url);

    win.webContents.setWindowOpenHandler(({ url }) => {
        shell.openExternal(url);
        return { action: "deny" };
    });

    win.on("closed", () => {
        windows.delete(win);
        if (!isQuitting) saveSessions();
    });

    return win;
}

function showError(message) {
    const win = new BrowserWindow({ width: 700, height: 500, title: "LoCode — Error", backgroundColor: "#0d1117" });
    const html = `<html><body style="background:#0d1117;color:#f0f0f0;font-family:monospace;padding:2em">
        <h2 style="color:#ff6b6b">LoCode failed to start</h2>
        <pre style="white-space:pre-wrap;font-size:13px">${message.replace(/</g, "&lt;")}</pre>
        <p style="color:#888;margin-top:2em">Log file: ${logPath.replace(/</g, "&lt;")}</p>
        </body></html>`;
    win.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(html));
}

// ── IPC: second instance & session tracking ──────────────────────────
app.on("second-instance", (_event, argv, workingDirectory) => {
    const dirArg = parseDirArg(argv, workingDirectory);
    log(`[second-instance] dirArg=${dirArg}`);
    if (dirArg) {
        const win = createWindow(dirArg);
        win.once("ready-to-show", () => win.focus());
    } else {
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

ipcMain.on("session:setRoot", (event, rootPath) => {
    const win = getWindowFromEvent(event);
    if (win) {
        windows.set(win, rootPath || "");
        saveSessions();
    }
});

// ── Terminal PTY ─────────────────────────────────────────────────────
const terminals = new Map();
const WSL_PATH_RE = /^\\\\wsl[.$\\]/i;
const WSL_PARSE_RE = /^\\\\wsl(?:\.localhost|\$)\\([^\\]+)(.*)$/i;

function getShell() {
    return process.env.SHELL
        || (process.platform === "darwin" ? "/bin/zsh"
            : process.platform === "win32" ? "powershell.exe" : "/bin/bash");
}

function parseWslPath(uncPath) {
    const m = uncPath.match(WSL_PARSE_RE);
    return { distro: m?.[1] || "", linuxPath: m?.[2]?.replace(/\\/g, "/") || "/" };
}

ipcMain.handle("term:create", (event, { id, cols, rows, cwd }) => {
    try {
        const pty = require("node-pty");
        const home = os.homedir();
        const termCwd = cwd || home;
        const isWsl = process.platform === "win32" && WSL_PATH_RE.test(termCwd);

        let termShell, shellArgs, spawnCwd;
        if (isWsl) {
            const { distro, linuxPath } = parseWslPath(termCwd);
            termShell = "wsl.exe";
            shellArgs = ["-d", distro, "--cd", linuxPath];
            spawnCwd = undefined;
        } else {
            termShell = getShell();
            shellArgs = process.platform === "darwin" ? ["-l"] : [];
            spawnCwd = fs.existsSync(termCwd) ? termCwd : home;
        }

        log(`[pty] spawn id=${id} shell=${termShell} cwd=${spawnCwd || termCwd}`);
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
        const ownerWin = getWindowFromEvent(event);
        terminalOwner.set(id, ownerWin);

        term.onData((data) => {
            const w = terminalOwner.get(id);
            if (w && !w.isDestroyed()) w.webContents.send("term:data", { id, data });
        });

        term.onExit(({ exitCode }) => {
            const w = terminalOwner.get(id);
            if (w && !w.isDestroyed()) w.webContents.send("term:exit", { id, code: exitCode });
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
const cliDeclinedFile = path.join(app.getPath("userData"), ".cli-declined");

function buildShellScript(execCmd) {
    return [
        '#!/bin/sh',
        'DIR=""',
        'if [ -n "$1" ] && [ -d "$1" ]; then',
        '    DIR="$(cd "$1" && pwd)"',
        'fi',
        'if [ -n "$DIR" ]; then',
        `    ${execCmd} "$DIR" &`,
        'else',
        `    ${execCmd} &`,
        'fi',
    ].join("\n") + "\n";
}

async function installCLI() {
    if (!isPacked) return;
    const platform = process.platform;

    if (platform === "darwin") {
        const target = "/usr/local/bin/locode";
        const script = buildShellScript(`"${process.execPath}"`);
        const alreadyInstalled = fs.existsSync(target);

        try {
            if (alreadyInstalled && fs.readFileSync(target, "utf-8") === script) return;
        } catch {}

        if (!alreadyInstalled && fs.existsSync(cliDeclinedFile)) return;

        try {
            const tmpFile = path.join(app.getPath("temp"), "locode-cli-install.sh");
            fs.writeFileSync(tmpFile, script, { mode: 0o755 });
            const copyCmd = `do shell script "mkdir -p /usr/local/bin && cp '${tmpFile}' ${target} && chmod 755 ${target}" with administrator privileges`;

            if (alreadyInstalled) {
                execFileSync("osascript", ["-e", copyCmd], { stdio: "ignore" });
            } else {
                execFileSync("osascript", [
                    "-e", `display dialog "LoCode wants to install the locode command in ${target} so you can open projects from the terminal (e.g. locode .)" buttons {"Cancel", "Install"} default button "Install" with title "LoCode CLI" with icon caution`,
                    "-e", copyCmd,
                ], { stdio: "ignore" });
            }
            try { fs.unlinkSync(tmpFile); } catch {}
            log("[cli] installed /usr/local/bin/locode");
        } catch (err) {
            if (!alreadyInstalled) {
                try { fs.writeFileSync(cliDeclinedFile, ""); } catch {}
            }
            log(`[cli] macOS install failed: ${err.message}`);
        }
    } else if (platform === "win32") {
        const { execSync } = require("child_process");
        const appDir = path.dirname(process.execPath);
        const exePath = process.execPath;

        // ── Compile locode.exe CLI stub (avoids .cmd carriage-return) ──
        const cliDir = path.join(appDir, "cli");
        const cliExe = path.join(cliDir, "locode.exe");
        const csFile = path.join(cliDir, "locode.cs");
        const csSource = [
            'using System;',
            'using System.Diagnostics;',
            'class P {',
            '    static void Main(string[] a) {',
            '        var p = new ProcessStartInfo();',
            `        p.FileName = @"${exePath.replace(/"/g, '""')}";`,
            '        p.Arguments = a.Length > 0 ? string.Join(" ", a) : "";',
            '        p.UseShellExecute = false;',
            '        p.WorkingDirectory = Environment.CurrentDirectory;',
            '        Process.Start(p);',
            '    }',
            '}',
        ].join('\r\n');

        let cliOk = false;
        try {
            if (!fs.existsSync(cliDir)) fs.mkdirSync(cliDir);
            let needCompile = !fs.existsSync(cliExe);
            if (!needCompile) {
                try { if (fs.readFileSync(csFile, "utf-8") !== csSource) needCompile = true; }
                catch { needCompile = true; }
            }
            if (needCompile) {
                fs.writeFileSync(csFile, csSource);
                const csc = ["C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe",
                              "C:\\Windows\\Microsoft.NET\\Framework\\v4.0.30319\\csc.exe"]
                    .find(p => fs.existsSync(p));
                if (!csc) throw new Error("csc.exe not found");
                execSync(`"${csc}" /nologo /out:"${cliExe}" /target:exe "${csFile}"`, { stdio: "ignore", timeout: 15000 });
                log(`[cli] compiled ${cliExe}`);
            }
            cliOk = true;
        } catch (err) {
            log(`[cli] exe compilation failed, falling back to cmd: ${err.message}`);
            const cmdFile = path.join(appDir, "locode.cmd");
            const cmdScript = `@start "" "${exePath}" %*`;
            try {
                if (!fs.existsSync(cmdFile) || fs.readFileSync(cmdFile, "utf-8") !== cmdScript) {
                    fs.writeFileSync(cmdFile, cmdScript);
                }
            } catch {}
        }

        // ── Add CLI directory to user PATH ──
        const pathDir = cliOk ? cliDir : appDir;
        try {
            let currentPath = "";
            try {
                currentPath = execSync('reg query "HKCU\\Environment" /v Path', { encoding: "utf-8" })
                    .split("REG_EXPAND_SZ")[1]?.trim() || "";
            } catch {}
            if (!currentPath.includes(pathDir)) {
                const newPath = currentPath ? `${currentPath};${pathDir}` : pathDir;
                execSync(`reg add "HKCU\\Environment" /v Path /t REG_EXPAND_SZ /d "${newPath}" /f`, { stdio: "ignore" });
                log(`[cli] added ${pathDir} to user PATH`);
            }
        } catch (err) {
            log(`[cli] PATH update failed: ${err.message}`);
        }

        // ── WSL: install `locode` command in all WSL distros ──
        try {
            const distros = execSync('wsl -l -q', { encoding: "utf-16le", timeout: 10000 })
                .split(/\r?\n/).map(s => s.replace(/\0/g, '').trim()).filter(Boolean);
            if (distros.length === 0) throw new Error("no WSL distros");

            const wslExePath = execSync(`wsl -e wslpath -u "${exePath}"`, { encoding: "utf-8", timeout: 10000 }).trim();
            const wslScript = buildShellScript(`"${wslExePath}" >/dev/null 2>&1`).replace(/ &\n/g, ' &\n');
            // WSL version: wraps path with wslpath -w
            const wslScriptFull = [
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

            // If binary exists, mark as accepted (user approved before)
            for (const d of distros) {
                try { execSync(`wsl -d ${d} -e test -f /usr/local/bin/locode`, { timeout: 5000 }); wslPrefs[d] = "accepted"; }
                catch {}
            }

            // Which distros need install or update?
            const needInstall = distros.filter(d => {
                try { return execSync(`wsl -d ${d} -e cat /usr/local/bin/locode`, { encoding: "utf-8", timeout: 5000 }) !== wslScriptFull; }
                catch { return true; }
            });

            const toUpdate = needInstall.filter(d => wslPrefs[d] === "accepted");
            const toAsk = needInstall.filter(d => !wslPrefs[d]);

            if (toUpdate.length === 0 && toAsk.length === 0) {
                log("[cli] WSL: all distros up to date or declined");
            } else {
                for (const d of [...toUpdate, ...toAsk]) {
                    spawnSync('wsl', ['-d', d, '-e', 'sh', '-c', 'cat > /tmp/.locode-cli-tmp'], { input: wslScriptFull, timeout: 5000 });
                }

                const batLines = ['@echo off', 'cd /d %SYSTEMROOT%', 'title LoCode WSL Install'];
                if (toAsk.length > 0) {
                    batLines.push('echo.', 'echo  LoCode wants to install the "locode" command in your WSL distros',
                        'echo  so you can open projects from WSL (e.g. locode .)', 'echo.');
                }

                // Helper to generate bat install block for a distro
                const installBlock = (d, prompt) => {
                    const label = d.replace(/[^a-zA-Z0-9]/g, '_');
                    const lines = [];
                    if (prompt) {
                        lines.push(`set /p REPLY="  Install in ${d}? [Y/n] "`,
                            `if /i "%REPLY%"=="n" goto skip_${label}`,
                            `if /i "%REPLY%"=="no" goto skip_${label}`);
                    }
                    lines.push(`:retry_${label}`,
                        `wsl -d ${d} -- sudo sh -c "mv /tmp/.locode-cli-tmp /usr/local/bin/locode && chmod 755 /usr/local/bin/locode"`,
                        `if errorlevel 1 goto retry_${label}`);
                    if (prompt) lines.push(`:skip_${label}`);
                    return lines;
                };

                for (const d of toAsk) batLines.push(...installBlock(d, true));
                for (const d of toUpdate) batLines.push(...installBlock(d, false));

                batLines.push('exit');
                const batFile = path.join(app.getPath("temp"), "locode-wsl-install.bat");
                fs.writeFileSync(batFile, batLines.join('\r\n') + '\r\n');
                await shell.openPath(batFile);

                for (const d of toAsk) wslPrefs[d] = "declined";
                try { fs.writeFileSync(wslPrefsFile, JSON.stringify(wslPrefs)); } catch {}
                log(`[cli] WSL install: ask=${toAsk.join(',')}, update=${toUpdate.join(',')}`);
            }
        } catch (err) {
            log(`[cli] WSL install skipped: ${err.message}`);
        }

        // ── WSL: shell script in /usr/local/bin so `locode .` works inside WSL ──
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
}

// ── App lifecycle ────────────────────────────────────────────────────
app.whenReady().then(async () => {
    await installCLI();
    const isMac = process.platform === "darwin";
    Menu.setApplicationMenu(Menu.buildFromTemplate([
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
                { role: "reload" }, { role: "forceReload" }, { role: "toggleDevTools" },
                { type: "separator" },
                { role: "resetZoom" }, { role: "zoomIn" }, { role: "zoomOut" },
                { type: "separator" },
                { role: "togglefullscreen" },
            ],
        },
        { role: "windowMenu" },
    ]));

    if (isMac && app.dock) {
        app.dock.setMenu(Menu.buildFromTemplate([
            { label: "New Window", click: () => createWindow() },
        ]));
        app.dock.setIcon(nativeImage.createFromPath(iconPath));
    }

    nuxtPort = await getFreePort();
    log(`[main] port=${nuxtPort}`);
    startNuxt();

    try {
        await waitForPort(nuxtPort);
        log("[main] Nuxt ready");

        if (cliRoot) {
            createWindow(cliRoot);
        } else {
            const saved = loadSessions();
            if (saved.length > 0) {
                for (const r of saved) createWindow(r || undefined);
            } else {
                createWindow();
            }
        }
    } catch (err) {
        log(`[main] Nuxt failed: ${err.message}`);
        logStream.end();
        showError(fs.readFileSync(logPath, "utf-8"));
    }

    app.on("activate", () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

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
