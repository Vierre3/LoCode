import { randomUUID } from "node:crypto";
import { resolve as resolvePath } from "node:path";
import type { Peer } from "crossws";

// --- Share session state ---

export interface GuestInfo {
    id: string;
    name: string;
    connectedAt: number;
    controlPeer: Peer | null; // control WebSocket peer for pushing events
}

export interface ShareSession {
    id: string;
    mode: "direct" | "relay"; // direct = web host (SSH on this server), relay = desktop host (WS tunnel)
    hostSessionId: string | null; // SSH session ID (direct mode)
    hostRelayPeer: Peer | null; // relay WebSocket peer (relay mode)
    backendMode: "local" | "ssh"; // host's file backend type
    rootPath: string;
    allowTerminal: boolean;
    hostName: string;
    guests: Map<string, GuestInfo>;
    activeTerminals: Map<string, string>; // terminalId → name
    createdAt: number;
}

const shares = new Map<string, ShareSession>();

// --- Pending relay requests (for relay mode) ---
interface PendingRelay {
    resolve: (value: any) => void;
    reject: (reason: any) => void;
    timer: ReturnType<typeof setTimeout>;
}
const pendingRelays = new Map<string, PendingRelay>();
const RELAY_TIMEOUT = 30_000; // 30s timeout for relay requests

// --- Control WebSocket peers ---
const controlPeers = new Map<string, { peer: Peer; shareId: string; role: "host" | "guest"; userId: string }>();

// --- CRUD ---

export function createShare(opts: {
    rootPath: string;
    backendMode: "local" | "ssh";
    hostSessionId?: string;
    allowTerminal: boolean;
    hostName: string;
}): ShareSession {
    const id = randomUUID();
    const session: ShareSession = {
        id,
        mode: opts.hostSessionId ? "direct" : "relay",
        hostSessionId: opts.hostSessionId || null,
        hostRelayPeer: null,
        backendMode: opts.backendMode,
        rootPath: opts.rootPath,
        allowTerminal: opts.allowTerminal,
        hostName: opts.hostName,
        guests: new Map(),
        activeTerminals: new Map(),
        createdAt: Date.now(),
    };
    shares.set(id, session);
    return session;
}

export function joinShare(shareId: string, name?: string): { session: ShareSession; guest: GuestInfo } | null {
    const session = shares.get(shareId);
    if (!session) return null;
    const guestNum = session.guests.size + 1;
    const guest: GuestInfo = {
        id: randomUUID(),
        name: name?.trim() || `Guest ${guestNum}`,
        connectedAt: Date.now(),
        controlPeer: null,
    };
    session.guests.set(guest.id, guest);
    // Broadcast guest-joined to all control peers
    broadcastControl(shareId, { type: "guest-joined", guest: { id: guest.id, name: guest.name } });
    return { session, guest };
}

export function leaveShare(shareId: string, guestId: string): boolean {
    const session = shares.get(shareId);
    if (!session) return false;
    const guest = session.guests.get(guestId);
    if (!guest) return false;
    session.guests.delete(guestId);
    broadcastControl(shareId, { type: "guest-left", guestId });
    return true;
}

export function closeShare(shareId: string): boolean {
    const session = shares.get(shareId);
    if (!session) return false;
    broadcastControl(shareId, { type: "share-closed" });
    // Cancel any pending relay requests
    for (const [reqId, pending] of pendingRelays) {
        pending.reject(new Error("Share closed"));
        clearTimeout(pending.timer);
        pendingRelays.delete(reqId);
    }
    // Clean up control peers
    for (const [peerId, info] of controlPeers) {
        if (info.shareId === shareId) controlPeers.delete(peerId);
    }
    shares.delete(shareId);
    return true;
}

export function getShare(shareId: string): ShareSession | undefined {
    return shares.get(shareId);
}

export function getShareByHostSession(hostSessionId: string): ShareSession | undefined {
    for (const session of shares.values()) {
        if (session.mode === "direct" && session.hostSessionId === hostSessionId) return session;
    }
    return undefined;
}

export function updateShareSettings(shareId: string, settings: { allowTerminal?: boolean }): boolean {
    const session = shares.get(shareId);
    if (!session) return false;
    if (settings.allowTerminal !== undefined) session.allowTerminal = settings.allowTerminal;
    broadcastControl(shareId, { type: "settings-changed", allowTerminal: session.allowTerminal });
    return true;
}

export function updateShareRootPath(shareId: string, rootPath: string): void {
    const session = shares.get(shareId);
    if (!session) return;
    session.rootPath = rootPath;
}

export function addActiveTerminal(shareId: string, terminalId: string, name: string, creatorId?: string): void {
    const session = shares.get(shareId);
    if (!session) return;
    session.activeTerminals.set(terminalId, name);
    broadcastControl(shareId, { type: "terminal-added", terminal: { id: terminalId, name }, creatorId });
}

export function removeActiveTerminal(shareId: string, terminalId: string): void {
    const session = shares.get(shareId);
    if (!session) return;
    session.activeTerminals.delete(terminalId);
    broadcastControl(shareId, { type: "terminal-removed", terminalId });
}

export function getAllShares(): ShareSession[] {
    return Array.from(shares.values());
}

// --- Control WebSocket management ---

export function registerControlPeer(peer: Peer, shareId: string, role: "host" | "guest", userId: string): void {
    controlPeers.set(peer.id, { peer, shareId, role, userId });
    const session = shares.get(shareId);
    if (!session) return;
    if (role === "guest") {
        const guest = session.guests.get(userId);
        if (guest) guest.controlPeer = peer;
    }
}

export function unregisterControlPeer(peer: Peer): void {
    const info = controlPeers.get(peer.id);
    if (!info) return;
    controlPeers.delete(peer.id);
    const session = shares.get(info.shareId);
    if (!session) return;
    if (info.role === "guest") {
        const guest = session.guests.get(info.userId);
        if (guest) guest.controlPeer = null;
    } else if (info.role === "host") {
        // Host disconnected control WS → close the share
        closeShare(info.shareId);
    }
}

function broadcastControl(shareId: string, message: any): void {
    const data = JSON.stringify(message);
    for (const info of controlPeers.values()) {
        if (info.shareId === shareId) {
            try { info.peer.send(data); } catch {}
        }
    }
}

// --- Relay management (for desktop host mode) ---

export function setHostRelayPeer(shareId: string, peer: Peer): boolean {
    const session = shares.get(shareId);
    if (!session || session.mode !== "relay") return false;
    session.hostRelayPeer = peer;
    return true;
}

export function clearHostRelayPeer(shareId: string): void {
    const session = shares.get(shareId);
    if (session) session.hostRelayPeer = null;
}

/**
 * Send a relay request to the desktop host and await the response.
 * Used by /api/share/* routes when session.mode === "relay".
 */
export function relayRequest(shareId: string, action: string, params: Record<string, any>): Promise<any> {
    const session = shares.get(shareId);
    if (!session || session.mode !== "relay" || !session.hostRelayPeer) {
        return Promise.reject(new Error("Relay not connected"));
    }

    const reqId = randomUUID();
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            pendingRelays.delete(reqId);
            reject(new Error("Relay request timed out"));
        }, RELAY_TIMEOUT);

        pendingRelays.set(reqId, { resolve, reject, timer });

        try {
            session.hostRelayPeer!.send(JSON.stringify({
                type: "request",
                id: reqId,
                action,
                ...params,
            }));
        } catch (err) {
            pendingRelays.delete(reqId);
            clearTimeout(timer);
            reject(err);
        }
    });
}

/**
 * Called when the desktop host sends a relay response.
 */
export function resolveRelayResponse(reqId: string, status: number, body: any): void {
    const pending = pendingRelays.get(reqId);
    if (!pending) return;
    pendingRelays.delete(reqId);
    clearTimeout(pending.timer);
    if (status >= 400) {
        pending.reject(new Error(typeof body === "string" ? body : "Relay error"));
    } else {
        pending.resolve(body);
    }
}

// --- Shared terminal peer registry ---
// Centralized here to avoid circular imports between _share-terminal.ts and _share-relay.ts

const MAX_TERMINAL_BUFFER = 50 * 1024; // 50KB rolling replay buffer per terminal

interface SharedTerminalEntry {
    peers: Set<Peer>;
    outputBuffer: string; // rolling buffer for late subscribers
    peerDimensions: Map<string, { cols: number; rows: number }>; // peerId → last known dimensions
    currentDimensions: { cols: number; rows: number }; // current PTY dimensions
}
const sharedTerminals = new Map<string, SharedTerminalEntry>();

export function registerTerminalPeer(terminalId: string, peer: Peer, dims?: { cols: number; rows: number }): void {
    let entry = sharedTerminals.get(terminalId);
    if (!entry) {
        entry = { peers: new Set(), outputBuffer: "", peerDimensions: new Map(), currentDimensions: { cols: 80, rows: 24 } };
        sharedTerminals.set(terminalId, entry);
    }
    if (dims) {
        entry.peerDimensions.set(peer.id, dims);
    }
    // Replay buffered output to late subscriber
    if (entry.outputBuffer.length > 0) {
        try { peer.send(JSON.stringify({ type: "output", terminalId, data: entry.outputBuffer })); } catch {}
    }
    entry.peers.add(peer);
}

export function unregisterTerminalPeer(terminalId: string, peer: Peer): void {
    const entry = sharedTerminals.get(terminalId);
    if (entry) {
        entry.peers.delete(peer);
        entry.peerDimensions.delete(peer.id);
        if (entry.peers.size === 0) sharedTerminals.delete(terminalId);
    }
}

export function broadcastToTerminalPeers(terminalId: string, message: any): void {
    const entry = sharedTerminals.get(terminalId);
    if (!entry) return;
    // Accumulate output in rolling replay buffer for late subscribers
    if (message.type === "output" && typeof message.data === "string") {
        entry.outputBuffer += message.data;
        if (entry.outputBuffer.length > MAX_TERMINAL_BUFFER) {
            entry.outputBuffer = entry.outputBuffer.slice(entry.outputBuffer.length - MAX_TERMINAL_BUFFER);
        }
    }
    const msg = JSON.stringify(message);
    for (const peer of entry.peers) {
        try { peer.send(msg); } catch {}
    }
}

export function removeTerminal(terminalId: string): void {
    sharedTerminals.delete(terminalId);
}

/**
 * Update a peer's dimensions and compute the minimum across all peers.
 * Returns the new min dimensions if they differ from the current PTY dimensions, or null if unchanged.
 */
export function updateTerminalPeerDimensions(terminalId: string, peerId: string, cols: number, rows: number): { cols: number; rows: number } | null {
    const entry = sharedTerminals.get(terminalId);
    if (!entry) return null;
    entry.peerDimensions.set(peerId, { cols, rows });
    const min = computeMinDimensions(entry);
    if (min.cols === entry.currentDimensions.cols && min.rows === entry.currentDimensions.rows) return null;
    entry.currentDimensions = min;
    return min;
}

/**
 * Recalculate min dimensions after a peer disconnects.
 */
export function recalcTerminalDimensions(terminalId: string): { cols: number; rows: number } | null {
    const entry = sharedTerminals.get(terminalId);
    if (!entry || entry.peerDimensions.size === 0) return null;
    const min = computeMinDimensions(entry);
    if (min.cols === entry.currentDimensions.cols && min.rows === entry.currentDimensions.rows) return null;
    entry.currentDimensions = min;
    return min;
}

function computeMinDimensions(entry: SharedTerminalEntry): { cols: number; rows: number } {
    let minCols = Infinity;
    let minRows = Infinity;
    for (const dims of entry.peerDimensions.values()) {
        if (dims.cols < minCols) minCols = dims.cols;
        if (dims.rows < minRows) minRows = dims.rows;
    }
    return { cols: minCols === Infinity ? 80 : minCols, rows: minRows === Infinity ? 24 : minRows };
}

export function setTerminalDimensions(terminalId: string, cols: number, rows: number): void {
    const entry = sharedTerminals.get(terminalId);
    if (entry) entry.currentDimensions = { cols, rows };
}

// --- Path security ---

export function isPathWithinRoot(filePath: string, rootPath: string): boolean {
    const resolved = resolvePath(filePath);
    const root = resolvePath(rootPath);
    return resolved === root || resolved.startsWith(root + "/") || resolved.startsWith(root + "\\");
}
