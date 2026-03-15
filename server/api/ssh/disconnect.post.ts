export default defineEventHandler((event) => {
    const sessionId = getSessionId(event);
    sshDisconnect(sessionId);
    return { ok: true };
});
