import { sshDisconnect } from "~/server/utils/ssh";

export default defineEventHandler(() => {
    sshDisconnect();
    return { ok: true };
});
