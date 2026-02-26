export default defineEventHandler(() => {
    return {
        connected: isSSHConnected(),
        host: getConnectedHost() || null,
        home: isSSHConnected() ? getRemoteHome() : null,
    };
});
