<template>
    <div ref="termContainer" class="h-full w-full terminal-wrapper"></div>
</template>

<script setup lang="ts">
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";

const props = defineProps<{
    cwd: string;
    active: boolean;
    focused: boolean;
}>();

const termContainer = ref<HTMLDivElement | null>(null);
let term: Terminal | null = null;
let fitAddon: FitAddon | null = null;
let ws: WebSocket | null = null;
let resizeObserver: ResizeObserver | null = null;

const isMobile = window.matchMedia("(max-width: 767px)").matches;

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
    term.loadAddon(new WebLinksAddon());
    term.open(termContainer.value);

    // Fit after a small delay to ensure container has dimensions
    await nextTick();
    fitAddon.fit();

    // WebSocket connection
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    ws = new WebSocket(`${protocol}//${window.location.host}/_terminal`);

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
        if (term) {
            term.write("\r\n\x1b[90m[Connection closed]\x1b[0m\r\n");
        }
    };

    // Let Ctrl+J and Ctrl+S bubble up to the window handler
    term.attachCustomKeyEventHandler((event) => {
        if ((event.ctrlKey || event.metaKey) && (event.key === "j" || event.key === "s")) {
            return false;
        }
        return true;
    });

    // Forward terminal input to WebSocket
    term.onData((data) => {
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "input", data }));
        }
    });

    // Resize observer — skip fit when hidden (0 dimensions)
    resizeObserver = new ResizeObserver((entries) => {
        if (!fitAddon || !term) return;
        const entry = entries[0];
        if (!entry || entry.contentRect.width === 0 || entry.contentRect.height === 0) return;
        fitAddon.fit();
        if (ws && ws.readyState === WebSocket.OPEN) {
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
            fitAddon!.fit();
        });
    }
});

onBeforeUnmount(() => {
    resizeObserver?.disconnect();
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
