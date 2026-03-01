export default defineEventHandler(() => {
    return {
        connected: isSSHConnected(),
        reconnecting: isSSHReconnecting(),
        host: getConnectedHost() || null,
        home: isSSHConnected() ? getRemoteHome() : null,
    };
});
