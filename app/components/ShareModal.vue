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
                            <button class="toggle-btn" :class="{ on: allowTerminalInput }"
                                @click="allowTerminalInput = !allowTerminalInput">
                                {{ allowTerminalInput ? 'ON' : 'OFF' }}
                            </button>
                        </div>

                        <div class="actions">
                            <button class="btn btn-primary" @click="onCreateShare" :disabled="creating || !canStartSharing">
                                {{ creating ? 'Creating...' : 'Start Sharing' }}
                            </button>
                            <button class="btn btn-secondary" @click="joinMode = true">Join a Session</button>
                        </div>

                        <p v-if="error" class="error-msg">{{ error }}</p>
                    </template>

                    <!-- HOST VIEW: Currently sharing -->
                    <template v-else-if="isHost">
                        <p class="dialog-title">Sharing Active</p>

                        <div class="share-link-row">
                            <input class="field-input share-link" :value="shareUrl" readonly
                                @click="($event.target as HTMLInputElement).select()" />
                            <button class="btn btn-copy" @click="copyLink" :class="{ copied }">
                                {{ copied ? 'Copied!' : 'Copy' }}
                            </button>
                        </div>

                        <div class="section">
                            <p class="section-label">Connected Users ({{ guests.length + 1 }})</p>
                            <ul class="guest-list">
                                <li class="guest-item host">{{ hostName }} (you)</li>
                                <li v-for="g in guests" :key="g.id" class="guest-item">{{ g.name }}</li>
                            </ul>
                        </div>

                        <div class="toggle-row">
                            <label class="toggle-label">Allow terminal access</label>
                            <button class="toggle-btn" :class="{ on: allowTerminal }"
                                @click="onToggleTerminal">
                                {{ allowTerminal ? 'ON' : 'OFF' }}
                            </button>
                        </div>

                        <div class="actions">
                            <button class="btn btn-danger" @click="onStopSharing">Stop Sharing</button>
                        </div>
                    </template>

                    <!-- GUEST VIEW: Currently connected -->
                    <template v-else-if="isGuest">
                        <p class="dialog-title">Connected to {{ hostName }}'s Session</p>

                        <div class="section">
                            <p class="section-label">Connected Users ({{ guests.length + 1 }})</p>
                            <ul class="guest-list">
                                <li class="guest-item host">{{ hostName }} (host)</li>
                                <li v-for="g in guests" :key="g.id" class="guest-item"
                                    :class="{ you: g.id === guestId }">
                                    {{ g.name }}{{ g.id === guestId ? ' (you)' : '' }}
                                </li>
                            </ul>
                        </div>

                        <div class="actions">
                            <button class="btn btn-danger" @click="onLeave">Leave Session</button>
                        </div>
                    </template>

                    <!-- JOIN MODE -->
                    <template v-else-if="joinMode">
                        <p class="dialog-title">Join a Session</p>

                        <div class="field">
                            <label class="field-label">Share Link or ID</label>
                            <input v-model="joinLinkInput" class="field-input" type="text"
                                placeholder="Paste the share link..." spellcheck="false"
                                @keydown.enter="onJoin" />
                        </div>

                        <div class="field">
                            <label class="field-label">Your Name <span class="optional">(optional)</span></label>
                            <input v-model="joinNameInput" class="field-input" type="text"
                                placeholder="Guest" spellcheck="false"
                                @keydown.enter="onJoin" />
                        </div>

                        <div class="actions">
                            <button class="btn btn-primary" @click="onJoin" :disabled="joining || !joinLinkInput.trim()">
                                {{ joining ? 'Joining...' : 'Join' }}
                            </button>
                            <button class="btn btn-secondary" @click="joinMode = false">Back</button>
                        </div>

                        <p v-if="error" class="error-msg">{{ error }}</p>
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

const hostNameInput = ref("Host");
const allowTerminalInput = ref(true);
const creating = ref(false);
const error = ref("");
const shareUrl = ref("");
const copied = ref(false);

// Host needs SSH connected (web mode) or a folder selected to start sharing
const canStartSharing = computed(() => {
    // Must have a rootPath (folder selected) or an SSH session
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
        const result = await createShare({
            rootPath: props.rootPath,
            backendMode: props.backendMode,
            hostSessionId: props.hostSessionId,
            allowTerminal: allowTerminalInput.value,
            hostName: hostNameInput.value.trim() || "Host",
        });
        shareUrl.value = result.shareUrl;
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
    max-width: 460px;
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
    margin-bottom: 12px;
}

.field-label {
    font-size: 0.75rem;
    font-weight: 600;
    color: rgba(255, 255, 255, 0.5);
}

.optional {
    font-weight: 400;
    color: rgba(255, 255, 255, 0.35);
}

.field-input {
    background: rgba(255, 255, 255, 0.08);
    border: 1px solid rgba(255, 255, 255, 0.15);
    border-radius: 6px;
    padding: 7px 10px;
    color: rgba(255, 255, 255, 0.9);
    font-size: 0.85rem;
    outline: none;
    transition: border-color 0.15s ease;
}
.field-input:focus {
    border-color: rgba(255, 255, 255, 0.4);
}
.field-input::placeholder {
    color: rgba(255, 255, 255, 0.25);
}

.share-link-row {
    display: flex;
    gap: 6px;
    margin-bottom: 16px;
}
.share-link {
    flex: 1;
    font-family: monospace;
    font-size: 0.78rem;
    user-select: all;
}

.toggle-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 16px;
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
    border: 1px solid rgba(255, 255, 255, 0.2);
    border-radius: 4px;
    background: rgba(255, 255, 255, 0.06);
    color: rgba(255, 255, 255, 0.5);
    cursor: pointer;
    transition: all 0.15s ease;
}
.toggle-btn.on {
    background: rgba(80, 200, 120, 0.25);
    border-color: rgba(80, 200, 120, 0.5);
    color: rgba(80, 200, 120, 0.9);
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
}
.guest-item.host {
    color: rgba(255, 255, 255, 0.9);
    font-weight: 600;
}
.guest-item.you {
    color: rgba(100, 180, 255, 0.9);
}

.actions {
    display: flex;
    gap: 8px;
    margin-top: 4px;
}

.btn {
    padding: 7px 16px;
    font-size: 0.82rem;
    font-weight: 600;
    border: 1px solid rgba(255, 255, 255, 0.2);
    border-radius: 6px;
    cursor: pointer;
    transition: all 0.15s ease;
}
.btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
}

.btn-primary {
    background: rgba(80, 160, 255, 0.3);
    border-color: rgba(80, 160, 255, 0.5);
    color: rgba(200, 225, 255, 0.95);
}
.btn-primary:hover:not(:disabled) {
    background: rgba(80, 160, 255, 0.45);
    transform: translateY(-1px);
}

.btn-secondary {
    background: rgba(255, 255, 255, 0.06);
    color: rgba(255, 255, 255, 0.7);
}
.btn-secondary:hover {
    background: rgba(255, 255, 255, 0.12);
    transform: translateY(-1px);
}

.btn-danger {
    background: rgba(220, 80, 80, 0.25);
    border-color: rgba(220, 80, 80, 0.5);
    color: rgba(255, 180, 180, 0.95);
}
.btn-danger:hover {
    background: rgba(220, 80, 80, 0.4);
    transform: translateY(-1px);
}

.btn-copy {
    padding: 7px 12px;
    background: rgba(255, 255, 255, 0.08);
    color: rgba(255, 255, 255, 0.7);
}
.btn-copy:hover {
    background: rgba(255, 255, 255, 0.15);
}
.btn-copy.copied {
    background: rgba(80, 200, 120, 0.2);
    color: rgba(80, 200, 120, 0.9);
    border-color: rgba(80, 200, 120, 0.4);
}

.error-msg {
    color: rgba(255, 120, 120, 0.9);
    font-size: 0.78rem;
    margin-top: 8px;
}

/* Transition */
.modal-enter-active,
.modal-leave-active {
    transition: opacity 0.25s ease;
}
.modal-enter-active .dialog,
.modal-leave-active .dialog {
    transition: transform 0.25s ease, opacity 0.25s ease;
}
.modal-enter-from,
.modal-leave-to {
    opacity: 0;
}
.modal-enter-from .dialog {
    transform: scale(0.95) translateY(10px);
    opacity: 0;
}
.modal-leave-to .dialog {
    transform: scale(0.95) translateY(10px);
    opacity: 0;
}
</style>
