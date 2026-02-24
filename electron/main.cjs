"use strict";
const { app, BrowserWindow, shell } = require("electron");
const { spawn } = require("child_process");
const path = require("path");
const net = require("net");

const isPacked = app.isPackaged;
const root = isPacked ? process.resourcesPath : path.join(__dirname, "..");

// Deno binary: shipped via the `deno` npm package
const denoBin = isPacked
    ? path.join(process.resourcesPath, "deno-bin", process.platform === "win32" ? "deno.exe" : "deno")
    : path.join(root, "node_modules", "deno", "bin", process.platform === "win32" ? "deno.exe" : "deno");

const backendScript = path.join(root, "backend", "server.ts");
const nuxtEntry = path.join(root, ".output", "server", "index.mjs");

const DENO_PORT = "8080";
const NUXT_PORT = "3000";

let denoProc = null;
let nuxtProc = null;
let win = null;

function startDeno() {
    denoProc = spawn(
        denoBin,
        ["run", "--allow-all", "--unstable-pty", backendScript],
        {
            env: { ...process.env, DENO_PORT },
            stdio: "inherit",
        }
    );
    denoProc.on("error", (err) => console.error("[deno]", err.message));
}

function startNuxt() {
    nuxtProc = spawn(
        process.execPath, // the Node.js that shipped with Electron
        [nuxtEntry],
        {
            env: {
                ...process.env,
                PORT: NUXT_PORT,
                HOST: "127.0.0.1",
                NODE_ENV: "production",
                DENO_URL: "http://localhost",
                DENO_PORT,
            },
            stdio: "inherit",
        }
    );
    nuxtProc.on("error", (err) => console.error("[nuxt]", err.message));
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

    win.loadURL(`http://127.0.0.1:${NUXT_PORT}`);

    // Open external links in the system browser, not in the Electron window
    win.webContents.setWindowOpenHandler(({ url }) => {
        shell.openExternal(url);
        return { action: "deny" };
    });

    win.on("closed", () => { win = null; });
}

app.whenReady().then(async () => {
    startDeno();
    startNuxt();

    try {
        // Wait for the Nuxt server to be ready before showing the window
        await waitForPort(NUXT_PORT);
    } catch (err) {
        console.error("Nuxt server did not start in time:", err.message);
    }

    createWindow();

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
