import { Client, type SFTPWrapper, type ConnectConfig } from "ssh2";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { randomUUID } from "node:crypto";

// --- Per-session SSH state ---
interface SSHSession {
    client: Client;
    sftp: SFTPWrapper;
    remoteHome: string;
    connectedHost: string;
    connectOpts: { host: string; port: number; username: string; password?: string };
    reconnecting: boolean;
    reconnectTimer: ReturnType<typeof setTimeout> | null;
}

const sessions = new Map<string, SSHSession>();

// Callback to clean up SSH terminal channels on connection drop
let onConnectionLost: ((sessionId: string) => void) | null = null;
export function setOnConnectionLost(cb: (sessionId: string) => void) { onConnectionLost = cb; }

function findPrivateKey(): Buffer | null {
    const sshDir = join(homedir(), ".ssh");
    for (const name of ["id_ed25519", "id_rsa", "id_ecdsa"]) {
        const keyPath = join(sshDir, name);
        if (existsSync(keyPath)) {
            try {
                return readFileSync(keyPath);
            } catch {
                continue;
            }
        }
    }
    return null;
}

export async function sshConnect(opts: {
    host: string;
    port?: number;
    username: string;
    password?: string;
}): Promise<{ home: string; sessionId: string }> {
    const sessionId = randomUUID();

    return new Promise((resolve, reject) => {
        const conn = new Client();

        const config: ConnectConfig = {
            host: opts.host,
            port: opts.port || 22,
            username: opts.username,
        };

        // Only use SSH agent if available
        if (process.env.SSH_AUTH_SOCK) {
            config.agent = process.env.SSH_AUTH_SOCK;
        }

        // Add private key if available
        const privateKey = findPrivateKey();
        if (privateKey) {
            config.privateKey = privateKey;
        }

        // Add password if provided
        if (opts.password) {
            config.password = opts.password;
            config.tryKeyboard = true;
        }

        // Keyboard-interactive handler (some servers require this instead of plain password)
        conn.on("keyboard-interactive", (_name, _instructions, _instructionsLang, _prompts, finish) => {
            finish([opts.password || ""]);
        });

        // Timeout after 10 seconds
        config.readyTimeout = 10000;

        conn.on("ready", () => {
            const connectOpts = { host: opts.host, port: opts.port || 22, username: opts.username, password: opts.password };

            // Discover remote home directory
            conn.exec("echo $HOME", (err, stream) => {
                const fallbackHome = `/home/${opts.username}`;
                if (err) {
                    setupSftp(conn, sessionId, connectOpts, opts.host, fallbackHome, resolve, reject);
                    return;
                }
                let output = "";
                stream.on("data", (data: Buffer) => { output += data.toString(); });
                stream.on("close", () => {
                    const remoteHome = output.trim() || fallbackHome;
                    setupSftp(conn, sessionId, connectOpts, opts.host, remoteHome, resolve, reject);
                });
            });
        });

        conn.on("error", (err) => {
            reject(new Error(`SSH connection failed: ${err.message}`));
        });

        // Auto-reconnect on unexpected close
        conn.on("close", () => {
            const session = sessions.get(sessionId);
            if (session && session.client === conn) {
                sessions.delete(sessionId);
                onConnectionLost?.(sessionId);
                scheduleReconnect(sessionId, session.connectOpts);
            }
        });

        conn.on("end", () => {
            const session = sessions.get(sessionId);
            if (session && session.client === conn) {
                sessions.delete(sessionId);
                onConnectionLost?.(sessionId);
                scheduleReconnect(sessionId, session.connectOpts);
            }
        });

        conn.connect(config);
    });
}

function scheduleReconnect(
    sessionId: string,
    connectOpts: { host: string; port: number; username: string; password?: string },
) {
    // Don't reconnect if session was explicitly disconnected (already removed)
    console.log(`[SSH:${sessionId.slice(0, 8)}] Connection lost, will attempt reconnect in 5s...`);
    setTimeout(async () => {
        // If session was re-created in the meantime, skip
        if (sessions.has(sessionId)) return;
        try {
            console.log(`[SSH:${sessionId.slice(0, 8)}] Attempting reconnect...`);
            // Reconnect creates a new session — the old sessionId is gone
            // The client would need to reconnect manually
            // For now, just log it
            console.log(`[SSH:${sessionId.slice(0, 8)}] Client must reconnect manually`);
        } catch (err: any) {
            console.log(`[SSH:${sessionId.slice(0, 8)}] Reconnect failed:`, err.message);
        }
    }, 5000);
}

function setupSftp(
    conn: Client,
    sessionId: string,
    connectOpts: { host: string; port: number; username: string; password?: string },
    host: string,
    remoteHome: string,
    resolve: (value: { home: string; sessionId: string }) => void,
    reject: (reason: Error) => void,
) {
    conn.sftp((err, sftpSession) => {
        if (err) {
            reject(new Error(`SFTP session failed: ${err.message}`));
            return;
        }
        sessions.set(sessionId, {
            client: conn,
            sftp: sftpSession,
            remoteHome,
            connectedHost: host,
            connectOpts,
            reconnecting: false,
            reconnectTimer: null,
        });
        resolve({ home: remoteHome, sessionId });
    });
}

export function sshDisconnect(sessionId: string) {
    const session = sessions.get(sessionId);
    if (!session) return;
    sessions.delete(sessionId);
    try { session.client.end(); } catch {}
    if (session.reconnectTimer) clearTimeout(session.reconnectTimer);
}

export function getSession(sessionId: string): SSHSession | undefined {
    return sessions.get(sessionId);
}

export function getSftp(sessionId: string): SFTPWrapper | null {
    return sessions.get(sessionId)?.sftp ?? null;
}

export function getSSHClient(sessionId: string): Client | null {
    return sessions.get(sessionId)?.client ?? null;
}

export function isSSHConnected(sessionId: string): boolean {
    return sessions.has(sessionId);
}

export function getRemoteHome(sessionId: string): string {
    return sessions.get(sessionId)?.remoteHome ?? "/home";
}

export function getConnectedHost(sessionId: string): string {
    return sessions.get(sessionId)?.connectedHost ?? "";
}

export function isSSHReconnecting(sessionId: string): boolean {
    return sessions.get(sessionId)?.reconnecting ?? false;
}

/**
 * Create a dedicated SSH connection for a terminal session.
 * Uses the same credentials as the given session.
 */
export function createTerminalConnection(sessionId: string): Promise<Client> {
    const session = sessions.get(sessionId);
    if (!session) {
        return Promise.reject(new Error("SSH not connected"));
    }
    const opts = session.connectOpts;
    return new Promise((resolve, reject) => {
        const conn = new Client();
        const config: ConnectConfig = {
            host: opts.host,
            port: opts.port || 22,
            username: opts.username,
            readyTimeout: 10000,
        };
        if (process.env.SSH_AUTH_SOCK) {
            config.agent = process.env.SSH_AUTH_SOCK;
        }
        const privateKey = findPrivateKey();
        if (privateKey) config.privateKey = privateKey;
        if (opts.password) {
            config.password = opts.password;
            config.tryKeyboard = true;
        }
        conn.on("keyboard-interactive", (_name, _instructions, _instructionsLang, _prompts, finish) => {
            finish([opts.password || ""]);
        });

        conn.on("ready", () => resolve(conn));
        conn.on("error", (err) => reject(new Error(`SSH terminal connection failed: ${err.message}`)));
        conn.connect(config);
    });
}

/** Clean up all sessions (used on server shutdown) */
export function cleanupAllSessions() {
    for (const [id, session] of sessions) {
        try { session.client.end(); } catch {}
        if (session.reconnectTimer) clearTimeout(session.reconnectTimer);
    }
    sessions.clear();
}
