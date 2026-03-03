/**
 * Centralized API helper supporting 2 modes:
 *
 * 1. LOCAL (default): requests go to /api/local/* (Node.js fs on this machine)
 * 2. SSH: requests go to /api/ssh/* (ssh2 SFTP on remote host)
 *    Terminal WebSocket → /_ssh-terminal (ssh2 shell channel)
 */

function getStoredSSHTarget(): { host: string; port: number; username: string } | null {
    if (!import.meta.client) return null;
    try {
        // sessionStorage = per-window (not shared across Electron windows)
        const raw = sessionStorage.getItem("locode:sshTarget");
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed.host === "string" && typeof parsed.username === "string") {
            return parsed;
        }
    } catch {}
    return null;
}

export function useApi() {
    function apiFetch(path: string, options: RequestInit = {}): Promise<Response> {
        const prefix = getStoredSSHTarget() ? "/api/ssh" : "/api/local";
        return fetch(`${prefix}${path}`, { ...options });
    }

    function getWsUrl(): string {
        if (!import.meta.client) return "";
        const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
        const endpoint = getStoredSSHTarget() ? "_ssh-terminal" : "_terminal";
        return `${protocol}//${window.location.host}/${endpoint}`;
    }

    function getMode(): "local" | "ssh" {
        return getStoredSSHTarget() ? "ssh" : "local";
    }

    return { apiFetch, getWsUrl, getMode };
}
