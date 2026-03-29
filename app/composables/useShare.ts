/**
 * Share session composable.
 *
 * Manages collaborative session state for both host and guest roles.
 * - Host: creates share, manages guests, optionally relays desktop SSH
 * - Guest: joins share via link, reads/writes through /api/share/* proxy
 *
 * Singleton state (shared across components via Vue reactivity).
 */

export interface ShareGuest {
    id: string;
    name: string;
}

// --- Singleton reactive state ---
const shareId = ref<string | null>(null);
const guestId = ref<string | null>(null);
const role = ref<"host" | "guest" | null>(null);
const hostName = ref("");
const allowTerminal = ref(false);
const rootPath = ref("");
const guests = ref<ShareGuest[]>([]);
const connected = ref(false);
const sharedTerminals = ref<{id: string, name: string}[]>([]);

// Control WebSocket (presence + lifecycle events)
let controlWs: WebSocket | null = null;
// Relay WebSocket (desktop host only — forwards guest requests)
let relayWs: WebSocket | null = null;
// Buffered messages waiting for relay WS to be ready
let relayMsgQueue: any[] = [];
// Remote server URL (desktop host sharing via Railway)
let remoteServerUrl: string | null = null;

export function useShare() {
    const isHost = computed(() => role.value === "host");
    const isGuest = computed(() => role.value === "guest");
    const isSharing = computed(() => !!shareId.value);

    // --- Host: create share ---
    async function createShare(opts: {
        rootPath: string;
        backendMode: "local" | "ssh";
        hostSessionId?: string;
        allowTerminal: boolean;
        hostName: string;
        serverUrl?: string; // Remote server URL for desktop hosts (e.g. Railway)
    }): Promise<{ shareId: string; shareUrl: string }> {
        // Desktop host → create on remote server; web host → create locally
        const baseUrl = opts.serverUrl || "";
        const res = await fetch(`${baseUrl}/api/share/create`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                rootPath: opts.rootPath,
                backendMode: opts.backendMode,
                hostSessionId: opts.serverUrl ? undefined : opts.hostSessionId, // no SSH session on remote
                allowTerminal: opts.allowTerminal,
                hostName: opts.hostName,
            }),
        });
        if (!res.ok) throw new Error(await res.text());
        const data = await res.json();

        shareId.value = data.shareId;
        role.value = "host";
        hostName.value = opts.hostName;
        allowTerminal.value = opts.allowTerminal;
        rootPath.value = opts.rootPath;
        guests.value = [];
        connected.value = true;
        remoteServerUrl = opts.serverUrl || null;

        connectControlWs(data.shareId, "host", "host");

        // Connect relay WS whenever session is relay mode:
        // - remote server URL (desktop sharing via Railway) — hostSessionId forced to undefined
        // - local sharing with no SSH session (desktop local mode) — hostSessionId not set
        if (opts.serverUrl || !opts.hostSessionId) {
            connectRelayWs(data.shareId);
        }

        return { shareId: data.shareId, shareUrl: data.shareUrl };
    }

    // --- Guest: join share ---
    async function joinShare(id: string, name?: string): Promise<void> {
        const res = await fetch("/api/share/join", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ shareId: id, name }),
        });
        if (!res.ok) throw new Error(await res.text());
        const data = await res.json();

        shareId.value = id;
        guestId.value = data.guestId;
        role.value = "guest";
        hostName.value = data.hostName;
        allowTerminal.value = data.allowTerminal;
        rootPath.value = data.rootPath;
        guests.value = data.guests || [];
        connected.value = true;
        sharedTerminals.value = data.activeTerminals || [];

        connectControlWs(id, "guest", data.guestId);
    }

    // --- API base URL (remote server for desktop host, local for web) ---
    function apiBase(): string {
        return remoteServerUrl || "";
    }

    // --- Host: close share ---
    async function closeShare(): Promise<void> {
        if (!shareId.value) return;
        try {
            await fetch(`${apiBase()}/api/share/close`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ shareId: shareId.value }),
            });
        } catch {}
        cleanup();
    }

    // --- Guest: leave share ---
    async function leaveShare(): Promise<void> {
        if (!shareId.value || !guestId.value) return;
        try {
            await fetch(`${apiBase()}/api/share/leave`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ shareId: shareId.value, guestId: guestId.value }),
            });
        } catch {}
        cleanup();
    }

    // --- Host: update settings ---
    async function updateSettings(settings: { allowTerminal?: boolean }): Promise<void> {
        if (!shareId.value) return;
        await fetch(`${apiBase()}/api/share/settings`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ shareId: shareId.value, ...settings }),
        });
        if (settings.allowTerminal !== undefined) {
            allowTerminal.value = settings.allowTerminal;
        }
    }

    // --- Add a terminal to sharedTerminals (called by creator after terminal-ready) ---
    function addSharedTerminal(id: string, name: string): void {
        if (!sharedTerminals.value.find((t: any) => t.id === id)) {
            sharedTerminals.value = [...sharedTerminals.value, { id, name }];
        }
    }

    // --- Host: refresh info ---
    async function refreshInfo(): Promise<void> {
        if (!shareId.value) return;
        try {
            const res = await fetch(`${apiBase()}/api/share/info?shareId=${shareId.value}`);
            if (!res.ok) return;
            const data = await res.json();
            guests.value = data.guests || [];
            allowTerminal.value = data.allowTerminal;
        } catch {}
    }

    // --- WebSocket URL helper ---
    function wsBase(): string {
        if (remoteServerUrl) {
            // Convert https://host → wss://host, http://host → ws://host
            return remoteServerUrl.replace(/^http/, "ws");
        }
        const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
        return `${protocol}//${window.location.host}`;
    }

    // --- Control WebSocket ---
    function connectControlWs(sid: string, r: "host" | "guest", userId: string) {
        if (!import.meta.client) return;
        const url = `${wsBase()}/_share`;
        controlWs = new WebSocket(url);

        controlWs.onopen = () => {
            controlWs?.send(JSON.stringify({ type: "auth", shareId: sid, role: r, userId }));
        };

        controlWs.onmessage = (ev) => {
            try {
                const msg = JSON.parse(ev.data);
                handleControlMessage(msg);
            } catch {}
        };

        controlWs.onclose = () => {
            controlWs = null;
        };
    }

    function handleControlMessage(msg: any) {
        switch (msg.type) {
            case "auth-ok":
                break;
            case "guest-joined":
                if (msg.guest) {
                    guests.value = [...guests.value, msg.guest];
                }
                break;
            case "guest-left":
                guests.value = guests.value.filter(g => g.id !== msg.guestId);
                break;
            case "settings-changed":
                if (msg.allowTerminal !== undefined) {
                    allowTerminal.value = msg.allowTerminal;
                }
                break;
            case "terminal-added": {
                // Skip if we are the creator — TerminalPanel.onShareCreated will add it via addSharedTerminal
                const myId = guestId.value || "host";
                if (msg.terminal && msg.creatorId !== myId && !sharedTerminals.value.find((t: any) => t.id === msg.terminal.id)) {
                    sharedTerminals.value = [...sharedTerminals.value, msg.terminal];
                }
                break;
            }
            case "terminal-removed":
                sharedTerminals.value = sharedTerminals.value.filter((t: any) => t.id !== msg.terminalId);
                break;
            case "share-closed":
                // Host closed the share — guest gets kicked
                if (role.value === "guest") {
                    cleanup();
                    onShareClosed?.();
                }
                break;
        }
    }

    // --- Relay WebSocket (desktop host only) ---
    function connectRelayWs(sid: string) {
        if (!import.meta.client) return;
        const url = `${wsBase()}/_share-relay`;
        relayWs = new WebSocket(url);

        relayWs.onopen = () => {
            relayWs?.send(JSON.stringify({ type: "auth", shareId: sid }));
        };

        relayWs.onmessage = (ev) => {
            try {
                const msg = JSON.parse(ev.data);
                if (msg.type === "auth-ok") {
                    // Flush any messages that were queued before the relay was ready
                    const queued = relayMsgQueue.splice(0);
                    for (const m of queued) {
                        relayWs?.send(JSON.stringify(m));
                    }
                }
                handleRelayMessage(msg);
            } catch {}
        };

        relayWs.onclose = () => {
            relayWs = null;
        };
    }

    async function handleRelayMessage(msg: any) {
        if (msg.type === "auth-ok") return;

        if (msg.type === "request") {
            // Desktop host handles relay request locally
            const { apiFetch } = useApi();
            try {
                let res: Response;
                const { id, action, ...params } = msg;
                if (action === "read") {
                    res = await apiFetch(`/read?path=${encodeURIComponent(params.path)}`);
                } else if (action === "list") {
                    res = await apiFetch(`/list?path=${encodeURIComponent(params.path)}`);
                } else if (action === "stat") {
                    res = await apiFetch(`/stat?path=${encodeURIComponent(params.path)}`);
                } else if (action === "write") {
                    res = await apiFetch("/write", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ path: params.path, content: params.content }),
                    });
                } else {
                    relayWs?.send(JSON.stringify({ type: "response", id, status: 400, body: "Unknown action" }));
                    return;
                }

                const body = res.headers.get("content-type")?.includes("json")
                    ? await res.json()
                    : await res.text();
                relayWs?.send(JSON.stringify({ type: "response", id, status: res.status, body }));
            } catch (err: any) {
                relayWs?.send(JSON.stringify({ type: "response", id: msg.id, status: 500, body: err.message }));
            }
        }

        // Terminal relay messages from server
        if (msg.type === "terminal-create") {
            onRelayTerminalCreate?.(msg);
        }
        if (msg.type === "terminal-input") {
            onRelayTerminalInput?.(msg);
        }
        if (msg.type === "terminal-resize") {
            onRelayTerminalResize?.(msg);
        }
        if (msg.type === "terminal-close") {
            onRelayTerminalClose?.(msg);
        }
    }

    function sendRelayMessage(msg: any) {
        if (relayWs?.readyState === WebSocket.OPEN) {
            relayWs.send(JSON.stringify(msg));
        } else {
            // Buffer until relay WS is connected and authenticated
            relayMsgQueue.push(msg);
        }
    }

    // --- Shared terminal WebSocket URL ---
    function getShareTerminalWsUrl(): string {
        if (!import.meta.client) return "";
        return `${wsBase()}/_share-terminal`;
    }

    // --- Cleanup ---
    function cleanup() {
        shareId.value = null;
        guestId.value = null;
        role.value = null;
        hostName.value = "";
        allowTerminal.value = false;
        rootPath.value = "";
        guests.value = [];
        connected.value = false;
        sharedTerminals.value = [];

        if (controlWs) { controlWs.close(); controlWs = null; }
        if (relayWs) { relayWs.close(); relayWs = null; }
        relayMsgQueue = [];
        remoteServerUrl = null;
    }

    return {
        // State
        shareId: readonly(shareId),
        guestId: readonly(guestId),
        role: readonly(role),
        hostName: readonly(hostName),
        allowTerminal: readonly(allowTerminal),
        shareRootPath: readonly(rootPath),
        guests: readonly(guests),
        connected: readonly(connected),
        sharedTerminals: readonly(sharedTerminals),

        // Computed
        isHost,
        isGuest,
        isSharing,

        // Actions
        createShare,
        joinShare,
        closeShare,
        leaveShare,
        updateSettings,
        refreshInfo,
        getShareTerminalWsUrl,
        addSharedTerminal,
        sendRelayMessage,
        cleanup,
    };
}

// --- Event callbacks (set by index.vue or other consumers) ---
// Use module-internal variables + setter functions.
// Direct assignment to ES module namespace objects is read-only in production builds,
// so we expose setters that mutate the internal bindings.
let onShareClosed: (() => void) | null = null;
let onRelayTerminalCreate: ((msg: any) => void) | null = null;
let onRelayTerminalInput: ((msg: any) => void) | null = null;
let onRelayTerminalResize: ((msg: any) => void) | null = null;
let onRelayTerminalClose: ((msg: any) => void) | null = null;

export function setOnShareClosed(cb: (() => void) | null) { onShareClosed = cb; }
export function setOnRelayTerminalCreate(cb: ((msg: any) => void) | null) { onRelayTerminalCreate = cb; }
export function setOnRelayTerminalInput(cb: ((msg: any) => void) | null) { onRelayTerminalInput = cb; }
export function setOnRelayTerminalResize(cb: ((msg: any) => void) | null) { onRelayTerminalResize = cb; }
export function setOnRelayTerminalClose(cb: ((msg: any) => void) | null) { onRelayTerminalClose = cb; }
