export default defineEventHandler(() => {
    sshDisconnect();
    return { ok: true };
});
