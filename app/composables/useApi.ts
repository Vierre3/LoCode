/**
 * Centralized API helper supporting 3 modes:
 *
 * 1. LOCAL (default): requests go to /api/local/* (Node.js fs on this machine)
 * 2. SSH: requests go to /api/ssh/* (ssh2 SFTP on remote host)
 *    Terminal WebSocket → /_ssh-terminal (ssh2 shell channel)
 * 3. LEGACY (old Deno remote): requests go to /api/* with X-Backend-Url header
 *    Terminal WebSocket → direct to remote Deno /_terminal
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

function getStoredBackendUrl(): string {
    if (!import.meta.client) return "";
    return localStorage.getItem("locode:backendUrl") || "";
}

export function useApi() {
    /**
     * Fetch wrapper that routes to the correct backend based on mode.
     */
    function apiFetch(path: string, options: RequestInit = {}): Promise<Response> {
        const sshTarget = getStoredSSHTarget();
        if (sshTarget) {
            // SSH mode: route through Nitro's SSH endpoints
            return fetch(`/api/ssh${path}`, { ...options });
        }

        const backendUrl = getStoredBackendUrl();
        if (backendUrl) {
            // Legacy remote mode: proxy with X-Backend-Url header
            const headers: Record<string, string> = {
                ...(options.headers as Record<string, string> || {}),
                "X-Backend-Url": backendUrl,
            };
            return fetch(`/api${path}`, { ...options, headers });
        }

        // Local mode: Node.js fs routes
        return fetch(`/api/local${path}`, { ...options });
    }

    /**
     * Returns the WebSocket URL for the terminal.
     */
    function getWsUrl(): string {
        if (!import.meta.client) return "";

        const sshTarget = getStoredSSHTarget();
        if (sshTarget) {
            // SSH mode: terminal goes through Nitro's SSH shell handler
            const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
            return `${protocol}//${window.location.host}/_ssh-terminal`;
        }

        const backendUrl = getStoredBackendUrl();
        if (backendUrl) {
            // Legacy remote: connect directly to remote Deno
            return backendUrl.replace(/^http/, "ws") + "/_terminal";
        }

        // Local mode: node-pty via Nitro
        const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
        return `${protocol}//${window.location.host}/_terminal`;
    }

    /**
     * Returns the current connection mode.
     */
    function getMode(): "local" | "ssh" | "legacy" {
        if (getStoredSSHTarget()) return "ssh";
        if (getStoredBackendUrl()) return "legacy";
        return "local";
    }

    return { apiFetch, getWsUrl, getMode, getStoredSSHTarget, getStoredBackendUrl };
}
