<template>
    <Teleport to="body">
        <Transition name="modal">
            <div v-if="show" class="dialog-backdrop" @click="$emit('close')">
                <div class="dialog" @click.stop>
                    <button class="dialog-close" @click="$emit('close')">&times;</button>
                    <p class="dialog-title">Settings</p>

                    <!-- SSH Connection -->
                    <div class="section">
                        <p class="section-label">SSH Connection</p>

                        <form @submit.prevent="onSubmit">
                            <div class="ssh-row">
                                <div class="field" style="flex: 2">
                                    <label class="field-label">Host</label>
                                    <input
                                        v-model="sshHost"
                                        class="field-input"
                                        type="text"
                                        placeholder="192.168.0.1"
                                        spellcheck="false"
                                    />
                                </div>
                                <div class="field" style="flex: 0 0 70px">
                                    <label class="field-label">Port</label>
                                    <input
                                        v-model.number="sshPort"
                                        class="field-input"
                                        type="number"
                                        placeholder="22"
                                    />
                                </div>
                            </div>

                            <div class="ssh-row">
                                <div class="field" style="flex: 1">
                                    <label class="field-label">Username</label>
                                    <input
                                        v-model="sshUsername"
                                        class="field-input"
                                        type="text"
                                        placeholder="toto"
                                        spellcheck="false"
                                    />
                                </div>
                                <div class="field" style="flex: 1">
                                    <label class="field-label">Password <span class="optional">(optional)</span></label>
                                    <input
                                        v-model="sshPassword"
                                        class="field-input"
                                        type="password"
                                        placeholder="Uses SSH keys by default"
                                    />
                                </div>
                            </div>

                            <p class="field-hint">
                                Enter an SSH address to browse files and run terminals on the remote machine.
                                Authentication uses your SSH keys (~/.ssh/id_ed25519, id_rsa) or SSH agent automatically.
                                Password is only needed if key auth fails.
                            </p>

                            <div class="ssh-actions">
                                <button
                                    v-if="!connected"
                                    type="submit"
                                    class="dialog-btn connect"
                                    :disabled="!sshHost || !sshUsername || connecting"
                                >
                                    {{ connecting ? "Connecting..." : "Connect" }}
                                </button>
                                <button
                                    v-else
                                    type="button"
                                    class="dialog-btn disconnect"
                                    @click="disconnect"
                                >
                                    Disconnect
                                </button>
                                <span v-if="connected" class="status-badge connected">Connected to {{ connectedHost }}</span>
                                <span v-if="error" class="status-badge error">{{ error }}</span>
                            </div>
                        </form>
                    </div>
                </div>
            </div>
        </Transition>
    </Teleport>
</template>

<script setup lang="ts">
const props = defineProps<{ show: boolean }>();
const emit = defineEmits<{ (e: "close"): void; (e: "saved"): void; (e: "connected"): void; (e: "disconnected"): void }>();

const sshHost = ref("");
const sshPort = ref(22);
const sshUsername = ref("");
const sshPassword = ref("");

const connecting = ref(false);
const connected = ref(false);
const connectedHost = ref("");
const error = ref("");

watch(() => props.show, async (visible) => {
    if (!visible) return;
    error.value = "";

    if (import.meta.client) {
        // Load SSH target
        try {
            const raw = localStorage.getItem("locode:sshTarget");
            if (raw) {
                const parsed = JSON.parse(raw);
                sshHost.value = parsed.host || "";
                sshPort.value = parsed.port || 22;
                sshUsername.value = parsed.username || "";
            }
        } catch {}

        // Check SSH connection status
        try {
            const res = await fetch("/api/ssh/info");
            const info = await res.json();
            connected.value = info.connected;
            connectedHost.value = info.host || "";
        } catch {
            connected.value = false;
        }
    }
});

function onSubmit() {
    if (!connected.value && sshHost.value && sshUsername.value && !connecting.value) {
        connect();
    }
}

async function connect() {
    error.value = "";
    connecting.value = true;

    try {
        const res = await fetch("/api/ssh/connect", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                host: sshHost.value,
                port: sshPort.value || 22,
                username: sshUsername.value,
                password: sshPassword.value || undefined,
            }),
        });

        if (!res.ok) {
            const text = await res.text();
            error.value = text || "Connection failed";
            return;
        }

        const data = await res.json();
        connected.value = true;
        connectedHost.value = sshHost.value;

        // Persist SSH target (no password)
        if (import.meta.client) {
            localStorage.setItem("locode:sshTarget", JSON.stringify({
                host: sshHost.value,
                port: sshPort.value || 22,
                username: sshUsername.value,
            }));
        }
        emit("saved");
        emit("connected");
        emit("close");
    } catch (err: any) {
        error.value = err.message || "Connection failed";
    } finally {
        connecting.value = false;
    }
}

async function disconnect() {
    try {
        await fetch("/api/ssh/disconnect", { method: "POST" });
    } catch {}
    connected.value = false;
    connectedHost.value = "";
    if (import.meta.client) {
        localStorage.removeItem("locode:sshTarget");
    }
    emit("saved");
    emit("disconnected");
    emit("close");
}
</script>

<style lang="css" scoped>
.dialog-backdrop {
    position: fixed;
    inset: 0;
    z-index: 100;
    background: rgba(0, 0, 0, 0.55);
    display: flex;
    align-items: center;
    justify-content: center;
}

.dialog {
    position: relative;
    background-color: rgb(30, 30, 30);
    border: 1.5px solid rgba(255, 255, 255, 0.2);
    border-radius: 12px;
    padding: 24px;
    max-width: 500px;
    width: 90%;
    box-shadow:
        0 4px 16px rgba(0, 0, 0, 0.35),
        0 20px 60px rgba(0, 0, 0, 0.55),
        inset 0 1px 0 rgba(255, 255, 255, 0.07);
}

.dialog-close {
    position: absolute;
    top: 10px;
    right: 12px;
    width: 24px;
    height: 24px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 1rem;
    color: rgba(255, 255, 255, 0.5);
    background: transparent;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    transition: color 0.15s ease, background 0.15s ease,
        transform 0.18s cubic-bezier(0.34, 1.56, 0.64, 1);
}
.dialog-close:hover {
    color: rgba(255, 255, 255, 0.9);
    background: rgba(220, 100, 100, 0.4);
    transform: scale(1.2);
}

.dialog-title {
    color: rgba(255, 255, 255, 0.9);
    font-size: 1rem;
    font-weight: 700;
    margin-bottom: 18px;
}

.section {
    margin-bottom: 0;
}

.section-label {
    font-size: 0.8rem;
    font-weight: 700;
    color: rgba(255, 255, 255, 0.7);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    margin-bottom: 10px;
}

.ssh-row {
    display: flex;
    gap: 8px;
    margin-bottom: 2px;
}

.field {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin-bottom: 8px;
}

.field-label {
    font-size: 0.75rem;
    font-weight: 600;
    color: rgba(255, 255, 255, 0.5);
}
.optional {
    font-weight: 400;
    color: rgba(255, 255, 255, 0.3);
}

.field-input {
    background: rgba(255, 255, 255, 0.07);
    border: 1.5px solid rgba(255, 255, 255, 0.15);
    border-radius: 6px;
    padding: 7px 9px;
    font-size: 0.82rem;
    font-family: ui-monospace, monospace;
    color: rgba(255, 255, 255, 0.9);
    outline: none;
    transition: border-color 0.15s ease;
}
.field-input:focus {
    border-color: rgba(100, 180, 255, 0.5);
}
.field-input::placeholder {
    color: rgba(255, 255, 255, 0.22);
}
/* Hide number input spinners */
.field-input[type="number"]::-webkit-inner-spin-button,
.field-input[type="number"]::-webkit-outer-spin-button {
    -webkit-appearance: none;
    margin: 0;
}
.field-input[type="number"] {
    appearance: textfield;
    -moz-appearance: textfield;
}

.field-hint {
    font-size: 0.72rem;
    color: rgba(255, 255, 255, 0.35);
    line-height: 1.5;
    margin-bottom: 10px;
}

.ssh-actions {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
}

.status-badge {
    font-size: 0.75rem;
    font-weight: 600;
    padding: 3px 8px;
    border-radius: 4px;
}
.status-badge.connected {
    color: #6ee7b7;
    background: rgba(110, 231, 183, 0.12);
    border: 1px solid rgba(110, 231, 183, 0.3);
}
.status-badge.error {
    color: #fca5a5;
    background: rgba(252, 165, 165, 0.12);
    border: 1px solid rgba(252, 165, 165, 0.3);
}

.dialog-btn {
    padding: 7px 14px;
    font-size: 0.82rem;
    font-weight: 700;
    border-radius: 5px;
    cursor: pointer;
    color: rgba(255, 255, 255, 0.9);
    border: 1px solid rgba(255, 255, 255, 0.15);
    transition: transform 0.18s cubic-bezier(0.34, 1.56, 0.64, 1),
        background 0.15s ease, border-color 0.15s ease;
}
.dialog-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
}
.dialog-btn:active:not(:disabled) { transform: scale(0.93); transition: transform 0.08s ease; }

.dialog-btn.connect {
    background: rgba(110, 231, 183, 0.2);
    border-color: rgba(110, 231, 183, 0.4);
}
.dialog-btn.connect:hover:not(:disabled) {
    background: rgba(110, 231, 183, 0.3);
    box-shadow: 0 0 12px rgba(110, 231, 183, 0.2);
    transform: translateY(-2px);
}

.dialog-btn.disconnect {
    background: rgba(252, 165, 165, 0.2);
    border-color: rgba(252, 165, 165, 0.4);
}
.dialog-btn.disconnect:hover {
    background: rgba(252, 165, 165, 0.3);
    box-shadow: 0 0 12px rgba(252, 165, 165, 0.2);
    transform: translateY(-2px);
}

/* Transition — no opacity animation to avoid Electron compositing bugs with box-shadow */
.modal-enter-active .dialog { animation: modal-in 0.25s ease-out; }
@keyframes modal-in {
    from { transform: translateY(12px); }
    to   { transform: translateY(0); }
}
.modal-leave-active { transition: opacity 0.15s ease; }
.modal-leave-to { opacity: 0; }
</style>
