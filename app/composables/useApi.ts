/**
 * Centralized API helper supporting 2 modes:
 *
 * 1. LOCAL (default in desktop): requests go to /api/local/* (Node.js fs on this machine)
 * 2. SSH: requests go to /api/ssh/* (ssh2 SFTP on remote host)
 *    Terminal WebSocket → /_ssh-terminal (ssh2 shell channel)
 *
 * In web mode (LOCODE_MODE=web), local APIs are disabled — SSH is always used.
 *
 * Each SSH session has a unique session ID (stored in sessionStorage) that is sent
 * with every request via the X-SSH-Session header.
 */

function getStoredSSHTarget(): { host: string; port: number; username: string } | null {
    if (!import.meta.client) return null;
    try {
        const raw = sessionStorage.getItem("locode:sshTarget");
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed.host === "string" && typeof parsed.username === "string") {
            return parsed;
        }
    } catch {}
    return null;
}

function getSessionId(): string {
    if (!import.meta.client) return "";
    return sessionStorage.getItem("locode:sshSessionId") || "";
}

export function setSessionId(id: string) {
    if (!import.meta.client) return;
    sessionStorage.setItem("locode:sshSessionId", id);
}

export function clearSessionId() {
    if (!import.meta.client) return;
    sessionStorage.removeItem("locode:sshSessionId");
}

function isWebMode(): boolean {
    try {
        return useRuntimeConfig().public.mode === 'web';
    } catch {
        return false;
    }
}

export function useApi() {
    const webMode = isWebMode();

    function apiFetch(path: string, options: RequestInit = {}): Promise<Response> {
        // Guest mode: route through /api/share/* proxy
        if (import.meta.client) {
            const { isGuest, shareId, guestId } = useShare();
            if (isGuest.value && shareId.value) {
                const headers = new Headers(options.headers);
                headers.set("X-Share-Session", shareId.value);
                if (guestId.value) headers.set("X-Guest-Id", guestId.value);
                return fetch(`/api/share${path}`, { ...options, headers });
            }
        }

        const useSSH = webMode || !!getStoredSSHTarget();
        const prefix = useSSH ? "/api/ssh" : "/api/local";

        // Add session ID header for SSH requests
        if (useSSH) {
            const sessionId = getSessionId();
            if (sessionId) {
                const headers = new Headers(options.headers);
                headers.set("X-SSH-Session", sessionId);
                options = { ...options, headers };
            }
        }

        return fetch(`${prefix}${path}`, { ...options });
    }

    function getWsUrl(): string {
        if (!import.meta.client) return "";
        const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";

        // Guest/host in share mode: use shared terminal WS
        const { isSharing } = useShare();
        if (isSharing.value) {
            return `${protocol}//${window.location.host}/_share-terminal`;
        }

        const useSSH = webMode || !!getStoredSSHTarget();
        const endpoint = useSSH ? "_ssh-terminal" : "_terminal";
        return `${protocol}//${window.location.host}/${endpoint}`;
    }

    function getMode(): "local" | "ssh" {
        if (webMode) return "ssh";
        return getStoredSSHTarget() ? "ssh" : "local";
    }

    return { apiFetch, getWsUrl, getMode, isWebMode: webMode, getSessionId };
}
