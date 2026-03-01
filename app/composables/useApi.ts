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
        const raw = localStorage.getItem("locode:sshTarget");
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed.host === "string" && typeof parsed.username === "string") {
            return parsed;
        }
    } catch {}
    return null;
}

export function useApi() {
    /**
     * Fetch wrapper that routes to the correct backend based on mode.
     */
    function apiFetch(path: string, options: RequestInit = {}): Promise<Response> {
        const sshTarget = getStoredSSHTarget();
        if (sshTarget) {
            return fetch(`/api/ssh${path}`, { ...options });
        }
        return fetch(`/api/local${path}`, { ...options });
    }

    /**
     * Returns the WebSocket URL for the terminal.
     */
    function getWsUrl(): string {
        if (!import.meta.client) return "";

        const sshTarget = getStoredSSHTarget();
        if (sshTarget) {
            const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
            return `${protocol}//${window.location.host}/_ssh-terminal`;
        }

        // Local mode: node-pty via Nitro
        const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
        return `${protocol}//${window.location.host}/_terminal`;
    }

    /**
     * Returns the current connection mode.
     */
    function getMode(): "local" | "ssh" {
        if (getStoredSSHTarget()) return "ssh";
        return "local";
    }

    return { apiFetch, getWsUrl, getMode };
}
