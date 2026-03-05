<template>
    <div ref="termContainer" class="h-full w-full terminal-wrapper"></div>
</template>

<script setup lang="ts">
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";

// Electron IPC bridge (injected by preload.cjs, undefined in web mode)
const electronTerminal = (window as any).electronTerminal as {
    create: (opts: any) => Promise<{ ok: boolean; error?: string }>;
    write: (id: string, data: string) => void;
    resize: (id: string, cols: number, rows: number) => void;
    kill: (id: string) => void;
    onData: (cb: (p: { id: string; data: string }) => void) => () => void;
    onExit: (cb: (p: { id: string; code: number }) => void) => () => void;
} | undefined;

const props = defineProps<{
    cwd: string;
    active: boolean;
    focused: boolean;
}>();

const { getWsUrl, getMode } = useApi();

const termContainer = ref<HTMLDivElement | null>(null);
let term: Terminal | null = null;
let fitAddon: FitAddon | null = null;
let ws: WebSocket | null = null;
let resizeObserver: ResizeObserver | null = null;
let ipcCleanups: (() => void)[] = [];
let wsReconnectTimer: ReturnType<typeof setTimeout> | null = null;
let disposed = false;
// Use local node-pty only in Electron + local mode; SSH mode always uses WebSocket
const useLocalPty = !!electronTerminal && getMode() === "local";

// Unique ID for this terminal instance (used for IPC routing)
const termId = `t-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

const isMobile = window.matchMedia("(max-width: 767px)").matches;

// FitAddon always subtracts 14px for a non-existent overview ruler.
// We don't load the OverviewRulerAddon, so those 14px are phantom — add the stolen cols back.
function doFit() {
    if (!fitAddon || !term) return;
    fitAddon.fit();
    const core = (term as any)._core;
    const cellW = core._renderService?.dimensions?.css?.cell?.width;
    if (cellW > 0) {
        const extra = Math.floor(14 / cellW);
        if (extra > 0) {
            core._renderService.clear();
            term.resize(term.cols + extra, term.rows);
        }
    }
}

function connectWs() {
    if (disposed || !term) return;
    ws = new WebSocket(getWsUrl());

    ws.onopen = () => {
        ws!.send(JSON.stringify({
            type: "create",
            cwd: props.cwd || undefined,
            cols: term!.cols,
            rows: term!.rows,
        }));
    };

    ws.onmessage = (event) => {
        try {
            const msg = JSON.parse(event.data);
            if (msg.type === "output" && term) {
                term.write(msg.data);
            } else if (msg.type === "exit" && term) {
                term.write(`\r\n\x1b[90m[Process exited with code ${msg.code}]\x1b[0m\r\n`);
            }
        } catch {
            // Ignore malformed messages
        }
    };

    ws.onclose = () => {
        if (disposed) return;
        if (term) {
            term.write("\r\n\x1b[90m[Connection lost — reconnecting...]\x1b[0m\r\n");
        }
        ws = null;
        scheduleWsReconnect();
    };

    ws.onerror = () => {
        // onclose will fire after onerror, reconnect handled there
    };
}

function scheduleWsReconnect() {
    if (disposed || wsReconnectTimer) return;
    wsReconnectTimer = setTimeout(() => {
        wsReconnectTimer = null;
        if (!disposed) connectWs();
    }, 5000);
}

onMounted(async () => {
    await nextTick();
    if (!termContainer.value) return;

    term = new Terminal({
        cursorBlink: true,
        fontSize: isMobile ? 12 : 14,
        fontFamily: "'Cascadia Code', 'Fira Code', 'JetBrains Mono', monospace",
        theme: {
            background: "#1e1e1e",
            foreground: "#d4d4d4",
            cursor: "#d4d4d4",
        },
        allowProposedApi: true,
    });

    fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.loadAddon(new WebLinksAddon((_event, uri) => {
        window.open(uri, "_blank");
    }));
    term.open(termContainer.value);

    // Wait until the container has real dimensions before fitting and spawning the PTY.
    // On first load, the terminal panel may not be laid out yet (0 height).
    await new Promise<void>((resolve) => {
        const check = () => {
            if (!termContainer.value) return resolve();
            const { offsetWidth, offsetHeight } = termContainer.value;
            if (offsetWidth > 0 && offsetHeight > 0) return resolve();
            requestAnimationFrame(check);
        };
        check();
    });

    doFit();

    // Component may have been unmounted during the dimension await
    if (!term || disposed) return;

    if (useLocalPty) {
        // ── Electron mode (local): IPC to main process (node-pty runs there) ──
        ipcCleanups.push(
            electronTerminal.onData(({ id, data }) => {
                if (id === termId && term) term.write(data);
            }),
            electronTerminal.onExit(({ id, code }) => {
                if (id === termId && term) {
                    term.write(`\r\n\x1b[90m[Process exited with code ${code}]\x1b[0m\r\n`);
                }
            }),
        );

        const result = await electronTerminal.create({
            id: termId,
            cols: term.cols,
            rows: term.rows,
            cwd: props.cwd || undefined,
        });

        if (!result.ok && term) {
            term.write(`\r\n\x1b[31m[Terminal error: ${result.error}]\x1b[0m\r\n`);
        }

        term.onData((data) => electronTerminal!.write(termId, data));
    } else {
        // ── Web mode or SSH: WebSocket to Nuxt server / SSH backend ──
        connectWs();

        term.onData((data) => {
            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: "input", data }));
            }
        });
    }

    // Let Ctrl+J, Ctrl+S, Ctrl+R bubble up to the window handler
    // Ctrl+Shift+C → copy selection to clipboard (Windows/Linux)
    term.attachCustomKeyEventHandler((event) => {
        if ((event.ctrlKey || event.metaKey) && (event.key === "j" || event.key === "s" || event.key === "r")) {
            return false;
        }
        if (event.type === "keydown" && event.ctrlKey && event.shiftKey && event.key === "C") {
            const sel = term!.getSelection();
            if (sel) navigator.clipboard.writeText(sel);
            return false;
        }
        return true;
    });

    // Resize observer — skip fit when hidden (0 dimensions)
    resizeObserver = new ResizeObserver((entries) => {
        if (!fitAddon || !term || disposed) return;
        const entry = entries[0];
        if (!entry || entry.contentRect.width === 0 || entry.contentRect.height === 0) return;
        doFit();
        if (!term) return; // doFit may have raced with unmount
        if (useLocalPty) {
            electronTerminal!.resize(termId, term.cols, term.rows);
        } else if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
        }
    });
    resizeObserver.observe(termContainer.value);

    // Auto-focus only for the explicitly focused terminal
    if (props.focused) {
        term.focus();
    }
});

defineExpose({
    focus() { term?.focus(); }
});

watch(() => props.active, (active) => {
    if (active && fitAddon && term && termContainer.value) {
        nextTick(() => {
            if (!termContainer.value || termContainer.value.offsetHeight === 0) return;
            doFit();
        });
    }
});

onBeforeUnmount(() => {
    disposed = true;
    if (wsReconnectTimer) { clearTimeout(wsReconnectTimer); wsReconnectTimer = null; }
    resizeObserver?.disconnect();
    ipcCleanups.forEach((fn) => fn());
    ipcCleanups = [];
    if (useLocalPty) {
        electronTerminal!.kill(termId);
    }
    if (ws) {
        ws.close();
        ws = null;
    }
    if (term) {
        term.dispose();
        term = null;
    }
    fitAddon = null;
});
</script>

<style lang="css" scoped>
.terminal-wrapper {
    background: #1e1e1e;
}

.terminal-wrapper :deep(.xterm) {
    padding: 4px;
    height: 100%;
}

.terminal-wrapper :deep(.xterm-viewport) {
    overflow-y: auto !important;
}
</style>
