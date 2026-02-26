import { Client, type SFTPWrapper, type ConnectConfig } from "ssh2";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

let client: Client | null = null;
let sftp: SFTPWrapper | null = null;
let remoteHome = "/home";
let connectedHost = "";

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

        conn.connect(config);
    });
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
