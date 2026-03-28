import { defineWebSocketHandler } from "h3";
import {
    getShare, setHostRelayPeer, clearHostRelayPeer, resolveRelayResponse,
    broadcastToTerminalPeers, removeTerminal,
} from "../utils/share";

// Track which peer is associated with which shareId for cleanup
const peerShareMap = new Map<string, string>();

/**
 * Relay WebSocket for desktop hosts.
 * The desktop app connects here to act as a relay for guest API requests.
 *
 * Host sends: { type: "auth", shareId }
 * Server sends: { type: "request", id, action, path, content? }
 * Host responds: { type: "response", id, status, body }
 * Terminal relay also goes through here.
 */
export default defineWebSocketHandler({
    open(_peer) {},

    message(peer, msg) {
        let data: any;
        try {
            data = JSON.parse(typeof msg === "string" ? msg : msg.text());
        } catch { return; }

        if (data.type === "auth") {
            const { shareId } = data;
            if (typeof shareId !== "string") return;
            const session = getShare(shareId);
            if (!session || session.mode !== "relay") return;

            if (setHostRelayPeer(shareId, peer)) {
                peerShareMap.set(peer.id, shareId);
                peer.send(JSON.stringify({ type: "auth-ok" }));
            }
        } else if (data.type === "response") {
            const { id, status, body } = data;
            if (typeof id === "string") {
                resolveRelayResponse(id, typeof status === "number" ? status : 200, body);
            }
        } else if (data.type === "terminal-output") {
            const shareId = peerShareMap.get(peer.id);
            if (shareId && data.terminalId) {
                broadcastToTerminalPeers(data.terminalId, { type: "output", terminalId: data.terminalId, data: data.data });
            }
        } else if (data.type === "terminal-exit") {
            const shareId = peerShareMap.get(peer.id);
            if (shareId && data.terminalId) {
                broadcastToTerminalPeers(data.terminalId, { type: "exit", terminalId: data.terminalId, code: data.code ?? 0 });
                removeTerminal(data.terminalId);
            }
        }
    },

    close(peer) {
        const shareId = peerShareMap.get(peer.id);
        if (shareId) {
            clearHostRelayPeer(shareId);
            peerShareMap.delete(peer.id);
        }
    },
    error(peer) {
        const shareId = peerShareMap.get(peer.id);
        if (shareId) {
            clearHostRelayPeer(shareId);
            peerShareMap.delete(peer.id);
        }
    },
});
