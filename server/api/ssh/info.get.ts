export default defineEventHandler((event) => {
    const sessionId = getRequestHeader(event, "x-ssh-session") || "";
    if (!sessionId) {
        return { connected: false, reconnecting: false, host: null, home: null };
    }
    return {
        connected: isSSHConnected(sessionId),
        reconnecting: isSSHReconnecting(sessionId),
        host: getConnectedHost(sessionId) || null,
        home: isSSHConnected(sessionId) ? getRemoteHome(sessionId) : null,
    };
});
