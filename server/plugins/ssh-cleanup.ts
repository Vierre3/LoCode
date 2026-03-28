import { setOnConnectionLost } from "../utils/ssh";
import { cleanupSessionChannels } from "../routes/_ssh-terminal";
import { getShareByHostSession, closeShare } from "../utils/share";

export default defineNitroPlugin(() => {
    setOnConnectionLost((sessionId: string) => {
        cleanupSessionChannels(sessionId);
        // If a share session uses this SSH connection, close it
        const share = getShareByHostSession(sessionId);
        if (share) closeShare(share.id);
    });
});
