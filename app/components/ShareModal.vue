<template>
    <Teleport to="body">
        <Transition name="modal">
            <div v-if="show" class="dialog-backdrop" @click="$emit('close')">
                <div class="dialog" @click.stop>
                    <button class="dialog-close" @click="$emit('close')">&times;</button>

                    <!-- HOST VIEW: Not sharing yet -->
                    <template v-if="!isSharing && !joinMode">
                        <p class="dialog-title">Share Session</p>

                        <div class="field">
                            <label class="field-label">Your Name <span class="optional">(optional)</span></label>
                            <input v-model="hostNameInput" class="field-input" type="text"
                                placeholder="Host" spellcheck="false" />
                        </div>

                        <div class="toggle-row">
                            <label class="toggle-label">Allow terminal access</label>
                            <button class="toggle-btn" :class="{ on: allowTerminalInput, off: !allowTerminalInput }"
                                @click="allowTerminalInput = !allowTerminalInput">
                                {{ allowTerminalInput ? 'ON' : 'OFF' }}
                            </button>
                        </div>

                        <div class="share-actions">
                            <button class="dialog-btn connect" @click="onCreateShare" :disabled="creating || !canStartSharing">
                                {{ creating ? 'Creating...' : 'Start Sharing' }}
                            </button>
                            <button class="dialog-btn secondary" @click="joinMode = true">Join a Session</button>
                        </div>

                        <span v-if="error" class="status-badge error">{{ error }}</span>
                    </template>

                    <!-- HOST VIEW: Currently sharing -->
                    <template v-else-if="isHost">
                        <p class="dialog-title">Sharing Active</p>

                        <div class="share-link-row">
                            <input class="field-input share-link" :value="shareUrl" readonly
                                @click="($event.target as HTMLInputElement).select()" />
                            <button class="dialog-btn copy" @click="copyLink" :class="{ copied }">
                                {{ copied ? 'Copied' : 'Copy' }}
                            </button>
                        </div>

                        <div class="section">
                            <p class="section-label">Connected Users ({{ guests.length + 1 }})</p>
                            <ul class="guest-list">
                                <li class="guest-item host"><span class="user-dot" /> {{ hostName }} (you)</li>
                                <li v-for="g in guests" :key="g.id" class="guest-item"><span class="user-dot" /> {{ g.name }}</li>
                            </ul>
                        </div>

                        <div class="toggle-row">
                            <label class="toggle-label">Allow terminal access</label>
                            <button class="toggle-btn" :class="{ on: allowTerminal, off: !allowTerminal }"
                                @click="onToggleTerminal">
                                {{ allowTerminal ? 'ON' : 'OFF' }}
                            </button>
                        </div>

                        <div class="share-actions">
                            <button class="dialog-btn disconnect" @click="onStopSharing">Stop Sharing</button>
                            <span class="status-badge connected">Sharing to {{ guests.length }} user{{ guests.length !== 1 ? 's' : '' }}</span>
                        </div>
                    </template>

                    <!-- GUEST VIEW: Currently connected -->
                    <template v-else-if="isGuest">
                        <p class="dialog-title">Connected to {{ hostName }}'s Session</p>

                        <div class="section">
                            <p class="section-label">Connected Users ({{ guests.length + 1 }})</p>
                            <ul class="guest-list">
                                <li class="guest-item"><span class="user-dot" /> {{ hostName }} (host)</li>
                                <li v-for="g in guests" :key="g.id" class="guest-item"
                                    :class="{ you: g.id === guestId }">
                                    <span class="user-dot" /> {{ g.name }}{{ g.id === guestId ? ' (you)' : '' }}
                                </li>
                            </ul>
                        </div>

                        <div class="share-actions">
                            <button class="dialog-btn disconnect" @click="onLeave">Leave Session</button>
                        </div>
                    </template>

                    <!-- JOIN MODE -->
                    <template v-else-if="joinMode">
                        <p class="dialog-title">Join a Session</p>

                        <div class="field">
                            <label class="field-label">Your Name <span class="optional">(optional)</span></label>
                            <input v-model="joinNameInput" class="field-input" type="text"
                                placeholder="Guest" spellcheck="false"
                                @keydown.enter="onJoin" />
                        </div>

                        <div class="field">
                            <label class="field-label">Share Link</label>
                            <input v-model="joinLinkInput" class="field-input" type="text"
                                placeholder="https://locode.example.com?share=..." spellcheck="false"
                                @keydown.enter="onJoin" />
                        </div>

                        <div class="share-actions">
                            <button class="dialog-btn connect" @click="onJoin" :disabled="joining || !joinLinkInput.trim()">
                                {{ joining ? 'Joining...' : 'Join' }}
                            </button>
                            <button class="dialog-btn secondary" @click="joinMode = false">Back</button>
                        </div>

                        <span v-if="error" class="status-badge error">{{ error }}</span>
                    </template>
                </div>
            </div>
        </Transition>
    </Teleport>
</template>

<script setup lang="ts">
const props = defineProps<{
    show: boolean;
    rootPath: string;
    backendMode: "local" | "ssh";
    hostSessionId?: string;
}>();

const emit = defineEmits<{
    close: [];
    joined: [rootPath: string];
    left: [];
    stopped: [];
}>();

const {
    isHost, isGuest, isSharing, shareId, guestId,
    hostName, allowTerminal, guests,
    createShare, joinShare, closeShare, leaveShare, updateSettings,
} = useShare();

const { isWebMode } = useApi();
const { public: { shareUrl: configShareUrl } } = useRuntimeConfig();

const hostNameInput = ref("");
const allowTerminalInput = ref(true);
const creating = ref(false);
const error = ref("");
const shareUrl = ref("");
const copied = ref(false);

// Host needs rootPath or SSH session to start sharing
const canStartSharing = computed(() => {
    return !!props.rootPath || !!props.hostSessionId;
});

const joinMode = ref(false);
const joinLinkInput = ref("");
const joinNameInput = ref("");
const joining = ref(false);

// Extract shareId from a URL or return raw input
function extractShareId(input: string): string {
    const trimmed = input.trim();
    try {
        const url = new URL(trimmed);
        return url.searchParams.get("share") || trimmed;
    } catch {
        return trimmed;
    }
}

async function onCreateShare() {
    error.value = "";
    creating.value = true;
    try {
        // In desktop mode, use the configured share server URL (from RAILWAY_PUBLIC_DOMAIN or LOCODE_SHARE_URL)
        const serverUrl = isWebMode ? undefined : (configShareUrl as string || undefined);
        if (!isWebMode && !serverUrl) {
            error.value = "Share server not configured. Set LOCODE_SHARE_URL when building the app.";
            creating.value = false;
            return;
        }

        const result = await createShare({
            rootPath: props.rootPath,
            backendMode: props.backendMode,
            hostSessionId: props.hostSessionId,
            allowTerminal: allowTerminalInput.value,
            hostName: hostNameInput.value.trim() || "Host",
            serverUrl,
        });
        shareUrl.value = result.shareUrl;
        // Auto-copy link to clipboard
        try { await navigator.clipboard.writeText(result.shareUrl); copied.value = true; setTimeout(() => copied.value = false, 1500); } catch {}
    } catch (err: any) {
        error.value = err.message || "Failed to create share";
    } finally {
        creating.value = false;
    }
}

async function onJoin() {
    const id = extractShareId(joinLinkInput.value);
    if (!id) return;
    error.value = "";
    joining.value = true;
    try {
        await joinShare(id, joinNameInput.value.trim() || undefined);
        joinMode.value = false;
        emit("joined", useShare().shareRootPath.value);
    } catch (err: any) {
        error.value = err.message || "Failed to join";
    } finally {
        joining.value = false;
    }
}

async function onStopSharing() {
    await closeShare();
    shareUrl.value = "";
    emit("stopped");
    emit("close");
}

async function onLeave() {
    await leaveShare();
    emit("left");
    emit("close");
}

async function onToggleTerminal() {
    await updateSettings({ allowTerminal: !allowTerminal.value });
}

function copyLink() {
    navigator.clipboard.writeText(shareUrl.value);
    copied.value = true;
    setTimeout(() => copied.value = false, 1500);
}

</script>

<style lang="css" scoped>
.dialog-backdrop {
    position: fixed;
    inset: 0;
    z-index: 100;
    background: rgba(0, 0, 0, 0.45);
    backdrop-filter: blur(6px);
    -webkit-backdrop-filter: blur(6px);
    display: flex;
    align-items: center;
    justify-content: center;
}

.dialog {
    position: relative;
    background-color: rgba(30, 30, 30, 0.88);
    backdrop-filter: blur(24px);
    -webkit-backdrop-filter: blur(24px);
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
    margin-bottom: 14px;
}

.section-label {
    font-size: 0.8rem;
    font-weight: 700;
    color: rgba(255, 255, 255, 0.7);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    margin-bottom: 8px;
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
    width: 100%;
    min-width: 0;
    box-sizing: border-box;
}
.field-input:focus {
    border-color: rgba(100, 180, 255, 0.5);
}
.field-input::placeholder {
    color: rgba(255, 255, 255, 0.22);
}

.share-link-row {
    display: flex;
    gap: 6px;
    margin-bottom: 16px;
}
.share-link {
    flex: 1;
    font-size: 0.78rem;
    user-select: all;
}

.toggle-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 12px;
    padding: 8px 10px;
    background: rgba(255, 255, 255, 0.04);
    border-radius: 6px;
}

.toggle-label {
    font-size: 0.82rem;
    color: rgba(255, 255, 255, 0.75);
}

.toggle-btn {
    padding: 3px 12px;
    font-size: 0.75rem;
    font-weight: 700;
    border-radius: 4px;
    cursor: pointer;
    transform: translateZ(0);
    box-shadow: 0 0 0 transparent;
    transition: transform 0.18s cubic-bezier(0.34, 1.56, 0.64, 1),
        background 0.15s ease, box-shadow 0.25s ease, border-color 0.15s ease, color 0.15s ease;
}
.toggle-btn.on {
    background: rgba(110, 231, 183, 0.2);
    border: 1px solid rgba(110, 231, 183, 0.4);
    color: rgba(110, 231, 183, 0.9);
}
.toggle-btn.on:hover {
    background: rgba(110, 231, 183, 0.3);
    box-shadow: 0 0 12px rgba(110, 231, 183, 0.2);
    transform: translateZ(0) translateY(-2px);
}
.toggle-btn.off {
    background: rgba(252, 165, 165, 0.2);
    border: 1px solid rgba(252, 165, 165, 0.4);
    color: rgba(252, 165, 165, 0.9);
}
.toggle-btn.off:hover {
    background: rgba(252, 165, 165, 0.3);
    box-shadow: 0 0 12px rgba(252, 165, 165, 0.2);
    transform: translateZ(0) translateY(-2px);
}

.guest-list {
    list-style: none;
    padding: 0;
    margin: 0;
}
.guest-item {
    padding: 4px 8px;
    font-size: 0.82rem;
    color: rgba(255, 255, 255, 0.7);
    border-radius: 4px;
    display: flex;
    align-items: center;
    gap: 6px;
}
.guest-item.host {
    color: rgba(255, 255, 255, 0.9);
    font-weight: 600;
}
.guest-item.you {
    color: rgba(255, 255, 255, 0.9);
    font-weight: 600;
}
.user-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: rgba(110, 231, 183, 0.9);
    flex-shrink: 0;
    box-shadow: 0 0 4px rgba(110, 231, 183, 0.4);
}

.share-actions {
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
    margin-top: 8px;
    display: inline-block;
}
.status-badge.connected {
    color: #6ee7b7;
    background: rgba(110, 231, 183, 0.12);
    border: 1px solid rgba(110, 231, 183, 0.3);
    margin-top: 0;
}
.status-badge.error {
    color: #fca5a5;
    background: rgba(252, 165, 165, 0.12);
    border: 1px solid rgba(252, 165, 165, 0.3);
}

/* Buttons — same style as SettingsModal dialog-btn */
.dialog-btn {
    padding: 7px 14px;
    font-size: 0.82rem;
    font-weight: 700;
    border-radius: 5px;
    cursor: pointer;
    color: rgba(255, 255, 255, 0.9);
    border: 1px solid rgba(255, 255, 255, 0.15);
    transform: translateZ(0);
    box-shadow: 0 0 0 transparent;
    transition: transform 0.18s cubic-bezier(0.34, 1.56, 0.64, 1),
        background 0.15s ease, box-shadow 0.25s ease, border-color 0.15s ease;
}
.dialog-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
}
.dialog-btn:active:not(:disabled) { transform: translateZ(0) scale(0.93); transition: transform 0.08s ease; }

.dialog-btn.connect {
    background: rgba(110, 231, 183, 0.2);
    border-color: rgba(110, 231, 183, 0.4);
}
.dialog-btn.connect:hover:not(:disabled) {
    background: rgba(110, 231, 183, 0.3);
    box-shadow: 0 0 12px rgba(110, 231, 183, 0.2);
    transform: translateZ(0) translateY(-2px);
}

.dialog-btn.disconnect {
    background: rgba(252, 165, 165, 0.2);
    border-color: rgba(252, 165, 165, 0.4);
}
.dialog-btn.disconnect:hover {
    background: rgba(252, 165, 165, 0.3);
    box-shadow: 0 0 12px rgba(252, 165, 165, 0.2);
    transform: translateZ(0) translateY(-2px);
}

.dialog-btn.secondary {
    background: rgba(255, 255, 255, 0.06);
    border-color: rgba(255, 255, 255, 0.15);
}
.dialog-btn.secondary:hover {
    background: rgba(255, 255, 255, 0.12);
    box-shadow: 0 0 8px rgba(255, 255, 255, 0.08);
    transform: translateZ(0) translateY(-2px);
}

.dialog-btn.copy {
    background: rgba(255, 255, 255, 0.08);
    border-color: rgba(255, 255, 255, 0.15);
    white-space: nowrap;
}
.dialog-btn.copy:hover {
    background: rgba(255, 255, 255, 0.15);
    transform: translateZ(0) translateY(-2px);
}
.dialog-btn.copy.copied {
    background: rgba(110, 231, 183, 0.2);
    color: rgba(110, 231, 183, 0.9);
    border-color: rgba(110, 231, 183, 0.4);
    transform: translateZ(0) scale(0.93);
    box-shadow: 0 0 12px rgba(110, 231, 183, 0.25);
}

/* Transition — same as SettingsModal */
.modal-enter-active { animation: backdrop-fade-in 0.25s ease forwards; }
@keyframes backdrop-fade-in { from { opacity: 0; } to { opacity: 1; } }
.modal-enter-active .dialog { animation: modal-in 0.35s cubic-bezier(0.34, 1.56, 0.64, 1) forwards; }
@keyframes modal-in {
    0%   { opacity: 0; transform: scale(0.88) translateY(12px); }
    60%  { opacity: 1; transform: scale(1.03) translateY(-2px); }
    80%  { transform: scale(0.98) translateY(1px); }
    100% { opacity: 1; transform: scale(1) translateY(0); }
}
.modal-leave-active { transition: opacity 0.18s ease; }
.modal-leave-active .dialog { animation: modal-out 0.18s ease-in forwards; }
@keyframes modal-out {
    0%   { opacity: 1; transform: scale(1); }
    100% { opacity: 0; transform: scale(0.92) translateY(6px); }
}
.modal-leave-to { opacity: 0; }
</style>
