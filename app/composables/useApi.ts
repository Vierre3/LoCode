/**
 * Centralized API helper that supports both local mode (through Nuxt proxy)
 * and remote SSH mode (proxied to a user-configured Deno backend URL).
 *
 * In local mode:  requests go to /api/* on this Nuxt server
 * In remote mode: requests still go to /api/*, but the proxy reads the
 *                 X-Backend-Url header and forwards to the remote Deno instance
 *
 * Terminal WebSocket bypasses the proxy entirely in remote mode and connects
 * directly to the remote Deno backend's /_terminal endpoint.
 */

function getStoredBackendUrl(): string {
    if (!import.meta.client) return "";
    return localStorage.getItem("locode:backendUrl") || "";
}

export function useApi() {
    /**
     * Drop-in replacement for fetch() for all /api/* calls.
     * Automatically includes X-Backend-Url when a remote backend is configured.
     */
    function apiFetch(path: string, options: RequestInit = {}): Promise<Response> {
        const backendUrl = getStoredBackendUrl();
        const headers: Record<string, string> = {
            ...(options.headers as Record<string, string> || {}),
        };
        if (backendUrl) {
            headers["X-Backend-Url"] = backendUrl;
        }
        return fetch(`/api${path}`, { ...options, headers });
    }

    /**
     * Returns the WebSocket URL for the terminal.
     * - Local mode: connects to Nitro /_terminal (node-pty, local shell)
     * - Remote mode: connects directly to remote Deno /_terminal (Deno PTY, remote shell)
     */
    function getWsUrl(): string {
        if (!import.meta.client) return "";
        const backendUrl = getStoredBackendUrl();
        if (backendUrl) {
            return backendUrl.replace(/^http/, "ws") + "/_terminal";
        }
        const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
        return `${protocol}//${window.location.host}/_terminal`;
    }

    return { apiFetch, getWsUrl, getStoredBackendUrl };
}
