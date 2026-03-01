import { setOnConnectionLost } from "../utils/ssh";
import { cleanupAllChannels } from "../routes/_ssh-terminal";

export default defineNitroPlugin(() => {
    setOnConnectionLost(() => {
        cleanupAllChannels();
    });
});
