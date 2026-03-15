import type { H3Event } from "h3";

/** Extract SSH session ID from request header */
export function getSessionId(event: H3Event): string {
    const id = getRequestHeader(event, "x-ssh-session");
    if (!id) {
        throw createError({ statusCode: 400, statusMessage: "Missing X-SSH-Session header" });
    }
    return id;
}
