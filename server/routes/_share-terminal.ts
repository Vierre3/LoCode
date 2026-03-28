import { defineWebSocketHandler } from "h3";
import { getShare, registerTerminalPeer, unregisterTerminalPeer, broadcastToTerminalPeers, removeTerminal } from "../utils/share";
import { createTerminalConnection } from "../utils/ssh";
import type { Client } from "ssh2";

// Track peer → subscribed terminals for cleanup
const peerTerminals = new Map<string, Set<string>>();
// Track peer → auth info
const peerAuth = new Map<string, { shareId: string; guestId: string | null }>();

// Direct mode terminals (web host): PTY lives on this server
interface DirectTerminal {
    shareId: string;
    sshConn: Client;
    stream: any;
}
const directTerminals = new Map<string, DirectTerminal>();

/**
 * Shared terminal WebSocket.
 * Guests and web hosts connect here.
 * For relay mode: terminal I/O is forwarded through the relay WS to the desktop host.
 * For direct mode: terminal PTY lives on this server (SSH shell channel).
 */
export default defineWebSocketHandler({
    open(_peer) {},

    message(peer, msg) {
        let data: any;
        try {
            data = JSON.parse(typeof msg === "string" ? msg : msg.text());
        } catch { return; }

        if (data.type === "auth") {
            const { shareId, guestId } = data;
            if (typeof shareId !== "string" || !getShare(shareId)) return;
            peerAuth.set(peer.id, { shareId, guestId: guestId || null });
            peer.send(JSON.stringify({ type: "auth-ok" }));
            return;
        }

        const auth = peerAuth.get(peer.id);
        if (!auth) return;
        const session = getShare(auth.shareId);
        if (!session) return;

        if (data.type === "create") {
            if (!session.allowTerminal && auth.guestId) return; // guest without permission
            const terminalId = `st-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

            // Subscribe the creator
            registerTerminalPeer(terminalId, peer);
            let subs = peerTerminals.get(peer.id);
            if (!subs) { subs = new Set(); peerTerminals.set(peer.id, subs); }
            subs.add(terminalId);

            if (session.mode === "relay") {
                // Forward terminal creation to desktop host via relay WS
                if (!session.hostRelayPeer) {
                    peer.send(JSON.stringify({ type: "output", terminalId, data: "\r\n\x1b[31m[Host relay not connected]\x1b[0m\r\n" }));
                    return;
                }
                session.hostRelayPeer.send(JSON.stringify({
                    type: "terminal-create",
                    terminalId,
                    cwd: data.cwd || session.rootPath,
                    cols: data.cols || 80,
                    rows: data.rows || 24,
                }));
                peer.send(JSON.stringify({ type: "terminal-ready", terminalId }));
            } else {
                // Direct mode: create SSH shell channel on this server
                createDirectTerminal(auth.shareId, session, terminalId, data, peer);
            }
        } else if (data.type === "subscribe") {
            const { terminalId } = data;
            if (typeof terminalId !== "string") return;
            registerTerminalPeer(terminalId, peer);
            let subs = peerTerminals.get(peer.id);
            if (!subs) { subs = new Set(); peerTerminals.set(peer.id, subs); }
            subs.add(terminalId);
        } else if (data.type === "input") {
            const { terminalId, data: inputData } = data;
            if (typeof terminalId !== "string" || typeof inputData !== "string") return;

            if (session.mode === "relay" && session.hostRelayPeer) {
                // Forward input to desktop host
                session.hostRelayPeer.send(JSON.stringify({ type: "terminal-input", terminalId, data: inputData }));
            } else {
                // Direct mode: write to SSH stream
                const dt = directTerminals.get(terminalId);
                if (dt && dt.stream) dt.stream.write(inputData);
            }
        } else if (data.type === "resize") {
            const { terminalId, cols, rows } = data;
            if (typeof terminalId !== "string") return;

            if (session.mode === "relay" && session.hostRelayPeer) {
                session.hostRelayPeer.send(JSON.stringify({ type: "terminal-resize", terminalId, cols, rows }));
            } else {
                const dt = directTerminals.get(terminalId);
                if (dt && dt.stream && typeof cols === "number" && typeof rows === "number") {
                    dt.stream.setWindow(rows, cols, rows * 16, cols * 8);
                }
            }
        }
    },

    close(peer) { cleanupPeer(peer); },
    error(peer) { cleanupPeer(peer); },
});

function cleanupPeer(peer: any): void {
    const subs = peerTerminals.get(peer.id);
    if (subs) {
        for (const terminalId of subs) {
            unregisterTerminalPeer(terminalId, peer);
        }
        peerTerminals.delete(peer.id);
    }
    peerAuth.delete(peer.id);
}

async function createDirectTerminal(shareId: string, session: any, terminalId: string, data: any, peer: any): Promise<void> {
    if (!session.hostSessionId) {
        peer.send(JSON.stringify({ type: "output", terminalId, data: "\r\n\x1b[31m[No SSH session]\x1b[0m\r\n" }));
        return;
    }

    try {
        const conn = await createTerminalConnection(session.hostSessionId);
        conn.shell({ term: "xterm-256color", cols: data.cols || 80, rows: data.rows || 24 }, (err: any, stream: any) => {
            if (err) {
                peer.send(JSON.stringify({ type: "output", terminalId, data: `\r\n\x1b[31m[Shell error: ${err.message}]\x1b[0m\r\n` }));
                conn.end();
                return;
            }

            directTerminals.set(terminalId, { shareId, sshConn: conn, stream });

            // Mute initial MOTD
            let muted = true;
            stream.write("clear\n");

            stream.on("data", (chunk: Buffer) => {
                const str = chunk.toString("utf-8");
                if (muted) {
                    if (str.includes("\x1b[2J")) muted = false;
                    else return;
                }
                broadcastToTerminalPeers(terminalId, { type: "output", terminalId, data: str });
            });

            stream.on("close", () => {
                broadcastToTerminalPeers(terminalId, { type: "exit", terminalId, code: 0 });
                directTerminals.delete(terminalId);
                removeTerminal(terminalId);
                conn.end();
            });

            peer.send(JSON.stringify({ type: "terminal-ready", terminalId }));
        });
    } catch (err: any) {
        peer.send(JSON.stringify({ type: "output", terminalId, data: `\r\n\x1b[31m[Connection error: ${err.message}]\x1b[0m\r\n` }));
    }
}
