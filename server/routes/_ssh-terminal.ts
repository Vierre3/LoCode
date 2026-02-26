import { defineWebSocketHandler } from "h3";

const channels = new Map<string, any>();

export default defineWebSocketHandler({
    open(_peer) {
        // Wait for "create" message before opening shell
    },

    message(peer, msg) {
        let data: any;
        try {
            data = JSON.parse(typeof msg === "string" ? msg : msg.text());
        } catch {
            return;
        }

        if (data.type === "create") {
            if (channels.has(peer.id)) return;

            const client = getSSHClient();
            if (!client) {
                try {
                    peer.send(JSON.stringify({ type: "output", data: "\r\n\x1b[31m[SSH not connected]\x1b[0m\r\n" }));
                } catch {}
                return;
            }

            const cols = data.cols || 80;
            const rows = data.rows || 24;

            client.shell(
                {
                    term: "xterm-256color",
                    cols,
                    rows,
                },
                (err: Error | undefined, stream: any) => {
                    if (err) {
                        try {
                            peer.send(JSON.stringify({ type: "output", data: `\r\n\x1b[31m[SSH shell error: ${err.message}]\x1b[0m\r\n` }));
                        } catch {}
                        return;
                    }

                    channels.set(peer.id, stream);

                    stream.on("data", (chunk: Buffer) => {
                        try {
                            peer.send(JSON.stringify({ type: "output", data: chunk.toString() }));
                        } catch {
                            // Peer disconnected
                        }
                    });

                    stream.on("close", () => {
                        try {
                            peer.send(JSON.stringify({ type: "exit", code: 0 }));
                        } catch {
                            // Peer disconnected
                        }
                        channels.delete(peer.id);
                    });

                    // Set initial cwd if provided
                    if (data.cwd) {
                        stream.write(`cd ${JSON.stringify(data.cwd)} && clear\n`);
                    }
                },
            );
        } else if (data.type === "input") {
            const channel = channels.get(peer.id);
            if (channel && typeof data.data === "string") {
                channel.write(data.data);
            }
        } else if (data.type === "resize") {
            const channel = channels.get(peer.id);
            if (channel && typeof data.cols === "number" && typeof data.rows === "number") {
                channel.setWindow(data.rows, data.cols, data.rows * 16, data.cols * 8);
            }
        }
    },

    close(peer) {
        const channel = channels.get(peer.id);
        if (channel) {
            channel.close();
            channels.delete(peer.id);
        }
    },

    error(peer) {
        const channel = channels.get(peer.id);
        if (channel) {
            channel.close();
            channels.delete(peer.id);
        }
    },
});
