import { Client, type SFTPWrapper, type ConnectConfig } from "ssh2";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

// Callback to clean up SSH terminal channels on connection drop
let onConnectionLost: (() => void) | null = null;
export function setOnConnectionLost(cb: () => void) { onConnectionLost = cb; }

let client: Client | null = null;
let sftp: SFTPWrapper | null = null;
let remoteHome = "/home";
let connectedHost = "";
let lastConnectOpts: { host: string; port: number; username: string; password?: string } | null = null;
let reconnecting = false;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

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
}): Promise<{ home: string }> {
    // Close existing connection
    if (client) {
        try { client.end(); } catch {}
        client = null;
        sftp = null;
    }

    return new Promise((resolve, reject) => {
        const conn = new Client();

        const config: ConnectConfig = {
            host: opts.host,
            port: opts.port || 22,
            username: opts.username,
            // Try SSH agent first (SSH_AUTH_SOCK)
            agent: process.env.SSH_AUTH_SOCK,
        };

        // Add private key if available
        const privateKey = findPrivateKey();
        if (privateKey) {
            config.privateKey = privateKey;
        }

        // Add password if provided (used as fallback)
        if (opts.password) {
            config.password = opts.password;
        }

        // Timeout after 10 seconds
        config.readyTimeout = 10000;

        conn.on("ready", () => {
            client = conn;
            connectedHost = opts.host;
            lastConnectOpts = { host: opts.host, port: opts.port || 22, username: opts.username, password: opts.password };
            reconnecting = false;

            // Discover remote home directory
            conn.exec("echo $HOME", (err, stream) => {
                if (err) {
                    remoteHome = `/home/${opts.username}`;
                    setupSftp(conn, resolve, reject);
                    return;
                }
                let output = "";
                stream.on("data", (data: Buffer) => { output += data.toString(); });
                stream.on("close", () => {
                    remoteHome = output.trim() || `/home/${opts.username}`;
                    setupSftp(conn, resolve, reject);
                });
            });
        });

        conn.on("error", (err) => {
            client = null;
            sftp = null;
            reject(new Error(`SSH connection failed: ${err.message}`));
        });

        // Auto-reconnect on unexpected close
        conn.on("close", () => {
            if (client === conn) {
                client = null;
                sftp = null;
                onConnectionLost?.();
                scheduleReconnect();
            }
        });

        conn.on("end", () => {
            if (client === conn) {
                client = null;
                sftp = null;
                onConnectionLost?.();
                scheduleReconnect();
            }
        });

        conn.connect(config);
    });
}

function scheduleReconnect() {
    // Only auto-reconnect if we had a successful connection before and weren't explicitly disconnected
    if (!lastConnectOpts || reconnecting || reconnectTimer) return;
    reconnecting = true;
    console.log("[SSH] Connection lost, will attempt reconnect in 5s...");
    reconnectTimer = setTimeout(async () => {
        reconnectTimer = null;
        if (client) { reconnecting = false; return; } // Already reconnected
        if (!lastConnectOpts) { reconnecting = false; return; }
        try {
            console.log("[SSH] Attempting reconnect...");
            await sshConnect(lastConnectOpts);
            console.log("[SSH] Reconnected successfully");
        } catch (err: any) {
            console.log("[SSH] Reconnect failed:", err.message);
            // Will retry on next scheduleReconnect triggered by close/end
            reconnecting = false;
            scheduleReconnect();
        }
    }, 5000);
}

function setupSftp(
    conn: Client,
    resolve: (value: { home: string }) => void,
    reject: (reason: Error) => void,
) {
    conn.sftp((err, sftpSession) => {
        if (err) {
            reject(new Error(`SFTP session failed: ${err.message}`));
            return;
        }
        sftp = sftpSession;
        resolve({ home: remoteHome });
    });
}

export function sshDisconnect() {
    // Clear reconnect state — explicit disconnect should not auto-reconnect
    lastConnectOpts = null;
    reconnecting = false;
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
    if (client) {
        try { client.end(); } catch {}
        client = null;
        sftp = null;
        connectedHost = "";
        remoteHome = "/home";
    }
}

export function getSftp(): SFTPWrapper | null {
    return sftp;
}

export function getSSHClient(): Client | null {
    return client;
}

export function isSSHConnected(): boolean {
    return client !== null;
}

export function getRemoteHome(): string {
    return remoteHome;
}

export function getConnectedHost(): string {
    return connectedHost;
}

export function isSSHReconnecting(): boolean {
    return reconnecting;
}

/**
 * Create a dedicated SSH connection for a terminal session.
 * Each terminal gets its own connection to avoid the MaxSessions limit
 * on the shared SFTP connection.
 */
export function createTerminalConnection(): Promise<Client> {
    if (!lastConnectOpts) {
        return Promise.reject(new Error("SSH not connected"));
    }
    const opts = lastConnectOpts;
    return new Promise((resolve, reject) => {
        const conn = new Client();
        const config: ConnectConfig = {
            host: opts.host,
            port: opts.port || 22,
            username: opts.username,
            agent: process.env.SSH_AUTH_SOCK,
            readyTimeout: 10000,
        };
        const privateKey = findPrivateKey();
        if (privateKey) config.privateKey = privateKey;
        if (opts.password) config.password = opts.password;

        conn.on("ready", () => resolve(conn));
        conn.on("error", (err) => reject(new Error(`SSH terminal connection failed: ${err.message}`)));
        conn.connect(config);
    });
}
