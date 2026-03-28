import { randomUUID } from "node:crypto";
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

interface SharedTerminalEntry {
    peers: Set<Peer>;
}
const sharedTerminals = new Map<string, SharedTerminalEntry>();

export function registerTerminalPeer(terminalId: string, peer: Peer): void {
    let entry = sharedTerminals.get(terminalId);
    if (!entry) {
        entry = { peers: new Set() };
        sharedTerminals.set(terminalId, entry);
    }
    entry.peers.add(peer);
}

export function unregisterTerminalPeer(terminalId: string, peer: Peer): void {
    const entry = sharedTerminals.get(terminalId);
    if (entry) {
        entry.peers.delete(peer);
        if (entry.peers.size === 0) sharedTerminals.delete(terminalId);
    }
}

export function broadcastToTerminalPeers(terminalId: string, message: any): void {
    const entry = sharedTerminals.get(terminalId);
    if (!entry) return;
    const msg = JSON.stringify(message);
    for (const peer of entry.peers) {
        try { peer.send(msg); } catch {}
    }
}

export function removeTerminal(terminalId: string): void {
    sharedTerminals.delete(terminalId);
}

// --- Path security ---

export function isPathWithinRoot(filePath: string, rootPath: string): boolean {
    const { resolve } = require("node:path");
    const resolved = resolve(filePath);
    const root = resolve(rootPath);
    return resolved === root || resolved.startsWith(root + "/") || resolved.startsWith(root + "\\");
}
