<template>
    <Teleport to="body">
        <Transition name="modal">
            <div v-if="show" class="dialog-backdrop" @click="$emit('close')">
                <div class="dialog" @click.stop>
                    <button class="dialog-close" @click="$emit('close')">&times;</button>
                    <p class="dialog-title">Settings</p>

                    <div class="field">
                        <label class="field-label">Remote Backend URL</label>
                        <input
                            v-model="urlInput"
                            class="field-input"
                            type="url"
                            placeholder="http://localhost:8080"
                            spellcheck="false"
                        />
                        <p class="field-hint">
                            Leave empty for local mode. In SSH mode, set up a tunnel
                            (<code>ssh -L 8080:localhost:8080 user@host</code>) then enter
                            <code>http://localhost:8080</code>. The terminal will spawn on that machine.
                        </p>
                    </div>

                    <div class="dialog-actions">
                        <button class="dialog-btn save" @click="save">Save</button>
                        <button class="dialog-btn cancel" @click="$emit('close')">Cancel</button>
                    </div>
                </div>
            </div>
        </Transition>
    </Teleport>
</template>

<script setup lang="ts">
const props = defineProps<{ show: boolean }>();
const emit = defineEmits<{ (e: "close"): void; (e: "saved"): void }>();

const urlInput = ref("");

watch(() => props.show, (visible) => {
    if (visible) {
        urlInput.value = import.meta.client
            ? (localStorage.getItem("locode:backendUrl") || "")
            : "";
    }
});

function save() {
    const trimmed = urlInput.value.trim().replace(/\/$/, "");
    if (import.meta.client) {
        if (trimmed) {
            localStorage.setItem("locode:backendUrl", trimmed);
        } else {
            localStorage.removeItem("locode:backendUrl");
        }
    }
    emit("saved");
    emit("close");
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
    max-width: 440px;
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

.field {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin-bottom: 20px;
}

.field-label {
    font-size: 0.8rem;
    font-weight: 600;
    color: rgba(255, 255, 255, 0.6);
    text-transform: uppercase;
    letter-spacing: 0.04em;
}

.field-input {
    background: rgba(255, 255, 255, 0.07);
    border: 1.5px solid rgba(255, 255, 255, 0.15);
    border-radius: 6px;
    padding: 8px 10px;
    font-size: 0.85rem;
    font-family: ui-monospace, monospace;
    color: rgba(255, 255, 255, 0.9);
    outline: none;
    transition: border-color 0.15s ease;
}
.field-input:focus {
    border-color: rgba(100, 180, 255, 0.5);
}
.field-input::placeholder {
    color: rgba(255, 255, 255, 0.25);
}

.field-hint {
    font-size: 0.75rem;
    color: rgba(255, 255, 255, 0.4);
    line-height: 1.5;
}
.field-hint code {
    font-family: ui-monospace, monospace;
    background: rgba(255, 255, 255, 0.08);
    border-radius: 3px;
    padding: 1px 4px;
    font-size: 0.72rem;
}

.dialog-actions {
    display: flex;
    gap: 8px;
}

.dialog-btn {
    flex: 1;
    padding: 8px 12px;
    font-size: 0.85rem;
    font-weight: 700;
    border-radius: 5px;
    cursor: pointer;
    color: rgba(255, 255, 255, 0.9);
    border: 1px solid rgba(255, 255, 255, 0.15);
    transition: transform 0.18s cubic-bezier(0.34, 1.56, 0.64, 1),
        background 0.15s ease, box-shadow 0.15s ease;
}
.dialog-btn:active { transform: scale(0.93); transition: transform 0.08s ease; }

.dialog-btn.save {
    background: rgba(100, 180, 255, 0.25);
    border-color: rgba(100, 180, 255, 0.4);
}
.dialog-btn.save:hover {
    background: rgba(100, 180, 255, 0.4);
    box-shadow: 0 0 14px rgba(100, 180, 255, 0.3);
    transform: translateY(-2px);
}

.dialog-btn.cancel {
    background: rgba(255, 255, 255, 0.1);
}
.dialog-btn.cancel:hover {
    background: rgba(255, 255, 255, 0.2);
    transform: translateY(-2px);
}

/* Transition — same as UnsavedDialog */
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
