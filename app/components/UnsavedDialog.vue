<template>
    <Teleport to="body">
        <Transition name="modal">
            <div v-if="show" class="dialog-backdrop" @click="$emit('cancel')">
                <div class="dialog" @click.stop>
                    <button class="dialog-close" @click="$emit('cancel')">&times;</button>
                    <p class="dialog-text">Unsaved changes in <strong>{{ fileName }}</strong></p>
                    <div class="dialog-actions">
                        <button class="dialog-btn save" @click="$emit('save')">Save</button>
                        <button class="dialog-btn discard" @click="$emit('discard')">Discard</button>
                        <button class="dialog-btn cancel" @click="$emit('cancel')">Cancel</button>
                    </div>
                </div>
            </div>
        </Transition>
    </Teleport>
</template>

<script setup lang="ts">
defineProps<{ show: boolean; fileName: string }>();
defineEmits<{
    (e: "save"): void;
    (e: "discard"): void;
    (e: "cancel"): void;
}>();
</script>

<style lang="css" scoped>
/* --- Backdrop --- */
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

/* --- Dialog card --- */
.dialog {
    position: relative;
    background-color: rgba(30, 30, 30, 0.88);
    backdrop-filter: blur(24px);
    -webkit-backdrop-filter: blur(24px);
    border: 1.5px solid rgba(255, 255, 255, 0.2);
    border-radius: 12px;
    padding: 24px;
    max-width: 380px;
    width: 90%;
    box-shadow:
        0 4px 16px rgba(0, 0, 0, 0.35),
        0 20px 60px rgba(0, 0, 0, 0.55),
        inset 0 1px 0 rgba(255, 255, 255, 0.07);
}

/* --- Close button --- */
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

/* --- Content --- */
.dialog-text {
    color: rgba(255, 255, 255, 0.9);
    font-size: 0.95rem;
    margin-bottom: 20px;
    line-height: 1.4;
}

.dialog-actions {
    display: flex;
    gap: 8px;
}

/* --- Buttons --- */
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
        background 0.15s ease,
        box-shadow 0.15s ease;
}

.dialog-btn:active {
    transform: scale(0.93);
    transition: transform 0.08s ease;
}

/* Save */
.dialog-btn.save {
    background: rgba(100, 200, 100, 0.3);
    border-color: rgba(100, 200, 100, 0.4);
}

.dialog-btn.save:hover {
    background: rgba(100, 200, 100, 0.45);
    box-shadow: 0 0 14px rgba(100, 200, 100, 0.35);
    transform: translateY(-2px);
}

/* Discard */
.dialog-btn.discard {
    background: rgba(220, 100, 100, 0.3);
    border-color: rgba(220, 100, 100, 0.4);
}

.dialog-btn.discard:hover {
    background: rgba(220, 100, 100, 0.45);
    box-shadow: 0 0 14px rgba(220, 100, 100, 0.35);
    transform: translateY(-2px);
}

/* Cancel */
.dialog-btn.cancel {
    background: rgba(255, 255, 255, 0.1);
}

.dialog-btn.cancel:hover {
    background: rgba(255, 255, 255, 0.2);
    box-shadow: 0 0 10px rgba(255, 255, 255, 0.1);
    transform: translateY(-2px);
}

/* --- Transition: entrance --- */
@keyframes modal-in {
    0%   { opacity: 0; transform: scale(0.88) translateY(12px); }
    60%  { opacity: 1; transform: scale(1.03) translateY(-2px); }
    80%  { transform: scale(0.98) translateY(1px); }
    100% { opacity: 1; transform: scale(1) translateY(0); }
}

@keyframes modal-out {
    0%   { opacity: 1; transform: scale(1); }
    100% { opacity: 0; transform: scale(0.92) translateY(6px); }
}

.modal-enter-active {
    animation: backdrop-fade-in 0.25s ease forwards;
}

@keyframes backdrop-fade-in {
    from { opacity: 0; }
    to { opacity: 1; }
}

.modal-enter-active .dialog {
    animation: modal-in 0.35s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
}

.modal-enter-active .dialog-text {
    animation: fade-up 0.25s ease forwards;
    animation-delay: 0.12s;
    opacity: 0;
}

.modal-enter-active .dialog-actions {
    animation: fade-up 0.25s ease forwards;
    animation-delay: 0.19s;
    opacity: 0;
}

/* --- Transition: exit --- */
.modal-leave-active {
    transition: opacity 0.18s ease;
}

.modal-leave-active .dialog {
    animation: modal-out 0.18s ease-in forwards;
}

.modal-leave-to {
    opacity: 0;
}

/* --- Mobile --- */
@media (max-width: 767px) {
    .dialog {
        padding: 18px;
    }
    .dialog-text {
        font-size: 0.85rem;
    }
    .dialog-btn {
        font-size: 0.78rem;
        padding: 7px 8px;
    }
}
</style>
