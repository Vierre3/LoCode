import { setOnConnectionLost } from "../utils/ssh";
import { cleanupSessionChannels } from "../routes/_ssh-terminal";

export default defineNitroPlugin(() => {
    setOnConnectionLost((sessionId: string) => {
        cleanupSessionChannels(sessionId);
    });
});
