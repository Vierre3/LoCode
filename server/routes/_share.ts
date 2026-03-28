import { defineWebSocketHandler } from "h3";
import { getShare, registerControlPeer, unregisterControlPeer } from "~/server/utils/share";

/**
 * Control WebSocket for share sessions.
 * Both host and guests connect here for real-time lifecycle events.
 *
 * Auth message: { type: "auth", shareId, role: "host"|"guest", userId: guestId|"host" }
 * Server pushes: share-closed, settings-changed, guest-joined, guest-left, folder-changed
 */
export default defineWebSocketHandler({
    open(_peer) {},

    message(peer, msg) {
        let data: any;
        try {
            data = JSON.parse(typeof msg === "string" ? msg : msg.text());
        } catch { return; }

        if (data.type === "auth") {
            const { shareId, role, userId } = data;
            if (typeof shareId !== "string" || !getShare(shareId)) return;
            if (role !== "host" && role !== "guest") return;
            registerControlPeer(peer, shareId, role, userId || "host");
            peer.send(JSON.stringify({ type: "auth-ok" }));
        }
    },

    close(peer) { unregisterControlPeer(peer); },
    error(peer) { unregisterControlPeer(peer); },
});
