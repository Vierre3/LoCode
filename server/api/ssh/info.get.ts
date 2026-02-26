import { isSSHConnected, getConnectedHost, getRemoteHome } from "~/server/utils/ssh";

export default defineEventHandler(() => {
    return {
        connected: isSSHConnected(),
        host: getConnectedHost() || null,
        home: isSSHConnected() ? getRemoteHome() : null,
    };
});
