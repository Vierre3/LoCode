<template>
    <Teleport to="body">
        <div v-if="show" class="dialog-backdrop" @click="$emit('cancel')">
            <div class="dialog" @click.stop>
                <p class="dialog-text">Unsaved changes in <strong>{{ fileName }}</strong></p>
                <div class="dialog-actions">
                    <button class="dialog-btn save" @click="$emit('save')">Save</button>
                    <button class="dialog-btn discard" @click="$emit('discard')">Discard</button>
                    <button class="dialog-btn cancel" @click="$emit('cancel')">Cancel</button>
                </div>
            </div>
        </div>
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
.dialog-backdrop {
    position: fixed;
    inset: 0;
    z-index: 100;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
}

.dialog {
    background-color: rgba(30, 30, 30, 0.85);
    backdrop-filter: blur(20px);
    border: 2px solid rgba(255, 255, 255, 0.15);
    border-radius: 10px;
    padding: 24px;
    max-width: 380px;
    width: 90%;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
}

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

.dialog-btn {
    flex: 1;
    padding: 8px 12px;
    font-size: 0.85rem;
    font-weight: 700;
    border-radius: 5px;
    cursor: pointer;
    color: rgba(255, 255, 255, 0.9);
    border: 1px solid rgba(255, 255, 255, 0.15);
    transition: .2s ease;
}

.dialog-btn:hover {
    transform: translateY(-2px);
}

.dialog-btn:active {
    transform: scale(0.95);
}

.dialog-btn.save {
    background: rgba(100, 200, 100, 0.3);
    border-color: rgba(100, 200, 100, 0.4);
}

.dialog-btn.save:hover {
    background: rgba(100, 200, 100, 0.45);
}

.dialog-btn.discard {
    background: rgba(220, 100, 100, 0.3);
    border-color: rgba(220, 100, 100, 0.4);
}

.dialog-btn.discard:hover {
    background: rgba(220, 100, 100, 0.45);
}

.dialog-btn.cancel {
    background: rgba(255, 255, 255, 0.1);
}

.dialog-btn.cancel:hover {
    background: rgba(255, 255, 255, 0.2);
}

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
