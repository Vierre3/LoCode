<template>
    <div ref="containerRef" class="editor-container"
        @dragenter.prevent="onDragEnter" @dragover.prevent="onDragOver"
        @dragleave="onDragLeave" @drop.prevent="onDrop">
        <!-- Drop zone overlay (purely visual, pointer-events: none) -->
        <div v-if="dragging && !isMobile" class="drop-overlay">
            <div class="drop-zone" :class="{ hover: dropZone === 'left' }">Split Left</div>
            <div class="drop-zone" :class="{ hover: dropZone === 'center' }">Replace</div>
            <div class="drop-zone" :class="{ hover: dropZone === 'right' }">Split Right</div>
        </div>

        <!-- Editor panes -->
        <div class="panes-container">
            <div v-for="(pane, i) in panes" :key="pane.id" class="pane"
                :class="{ active: pane.id === activePaneId }"
                :style="paneStyle(i)"
                @click="focusPane(pane.id)">
                <MonacoEditor :ref="el => setEditorRef(pane.id, el)"
                    :modelValue="pane.code" :language="pane.language"
                    @update:modelValue="v => $emit('update:pane', pane.id, 'code', v)"
                    @focus="$emit('set-active', pane.id)" />
                <Transition name="skeleton-fade">
                    <div v-if="loadingPaneId === pane.id" class="pane-skeleton ml-10">
                        <div v-for="i in skeletonWidths" class="skeleton-line"
                            :style="{ width: i / (isMobile ? 1 : 2) + '%'}" />
                    </div>
                </Transition>
            </div>
            <div v-if="panes.length === 2" class="split-handle" :style="{ left: splitRatio + '%' }"
                @mousedown.prevent="startSplitResize" />
        </div>
    </div>
</template>

<script setup lang="ts">
export interface EditorPane {
    id: string;
    filePath: string;
    code: string;
    savedCode: string;
    language: string;
}

const props = defineProps<{
    panes: EditorPane[];
    activePaneId: string;
    isMobile: boolean;
    loadingPaneId?: string | null;
}>();

const emit = defineEmits<{
    (e: "update:pane", paneId: string, field: string, value: string): void;
    (e: "set-active", paneId: string): void;
    (e: "drop", zone: "left" | "center" | "right", filePath: string): void;
    (e: "close-pane", paneId: string): void;
}>();

const skeletonWidths = [10, 20, 33, 45, 72, 30, 60, 70, 55, 65, 20, 33, 10];
const containerRef = ref<HTMLDivElement | null>(null);
const dragging = ref(false);
const dropZone = ref<"left" | "center" | "right" | null>(null);
const splitRatio = ref(
    import.meta.client ? parseInt(localStorage.getItem("locode:splitRatio") || "50") : 50
);
let dragCounter = 0;

// --- Editor refs for focus ---
const editorRefs: Record<string, any> = {};

function setEditorRef(paneId: string, el: any) {
    if (el) editorRefs[paneId] = el;
    else delete editorRefs[paneId];
}

function focusPane(paneId: string) {
    emit("set-active", paneId);
    nextTick(() => editorRefs[paneId]?.focus());
}

function paneStyle(index: number) {
    if (props.panes.length === 1) return { flex: "1 1 0%" };
    return index === 0
        ? { width: splitRatio.value + "%", flexShrink: 0 }
        : { flex: "1 1 0%" };
}

function getZoneFromPosition(e: DragEvent): "left" | "center" | "right" {
    const el = containerRef.value;
    if (!el) return "center";
    const rect = el.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    if (x < 0.33) return "left";
    if (x > 0.67) return "right";
    return "center";
}

function onDragEnter(e: DragEvent) {
    if (!e.dataTransfer?.types.includes("text/locode-file")) return;
    dragCounter++;
    dragging.value = true;
}

function onDragOver(e: DragEvent) {
    if (!props.isMobile && dragging.value) {
        dropZone.value = getZoneFromPosition(e);
    }
}

function onDragLeave(e: DragEvent) {
    dragCounter--;
    if (dragCounter <= 0) {
        dragging.value = false;
        dropZone.value = null;
        dragCounter = 0;
    }
}

function onDrop(e: DragEvent) {
    dragging.value = false;
    dragCounter = 0;
    const filePath = e.dataTransfer?.getData("text/locode-file");
    const zone = getZoneFromPosition(e);
    if (filePath) {
        emit("drop", zone, filePath);
    }
    dropZone.value = null;
}

let splitCleanup: (() => void) | null = null;

function startSplitResize() {
    const container = containerRef.value?.querySelector(".panes-container") as HTMLElement;
    if (!container) return;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    const rect = container.getBoundingClientRect();

    const onMouseMove = (ev: MouseEvent) => {
        const ratio = ((ev.clientX - rect.left) / rect.width) * 100;
        splitRatio.value = Math.max(20, Math.min(80, ratio));
    };
    const cleanup = () => {
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        localStorage.setItem("locode:splitRatio", String(Math.round(splitRatio.value)));
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", cleanup);
        splitCleanup = null;
    };
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", cleanup);
    splitCleanup = cleanup;
}

defineExpose({ splitRatio, focusPane });

onBeforeUnmount(() => {
    splitCleanup?.();
});
</script>

<style lang="css" scoped>
.editor-container {
    position: relative;
    width: 100%;
    height: 100%;
    background: #1e1e1e;
    border-radius: 5px;
    overflow: hidden;
}

.panes-container {
    display: flex;
    width: 100%;
    height: 100%;
    position: relative;
}

.pane {
    position: relative;
    min-width: 0;
    height: 100%;
    overflow: hidden;
}

.pane.active {
    outline: 1px solid rgba(255, 255, 255, 0.15);
    outline-offset: -1px;
}

.split-handle {
    position: absolute;
    top: 0;
    width: 6px;
    height: 100%;
    cursor: col-resize;
    z-index: 5;
    transform: translateX(-3px);
}

.split-handle:hover {
    background: rgba(255, 255, 255, 0.1);
}

.drop-overlay {
    position: absolute;
    inset: 0;
    z-index: 10;
    display: flex;
    pointer-events: none;
}

.drop-zone {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 0.9rem;
    font-weight: 700;
    color: rgba(255, 255, 255, 0.5);
    background: rgba(255, 255, 255, 0.03);
    border: 2px dashed rgba(255, 255, 255, 0.08);
    transition: .1s ease;
}

.drop-zone.hover {
    background: rgba(100, 180, 255, 0.15);
    border-color: rgba(100, 180, 255, 0.4);
    color: rgba(255, 255, 255, 0.9);
}

/* --- Skeleton overlay --- */
.pane-skeleton {
    position: absolute;
    inset: 0;
    background: #1e1e1e;
    padding: 16px 20px;
    display: flex;
    flex-direction: column;
    gap: 10px;
    pointer-events: none;
    z-index: 2;
}

.skeleton-line {
    height: 13px;
    border-radius: 4px;
    background: linear-gradient(
        90deg,
        rgba(255, 255, 255, 0.05) 0%,
        rgba(255, 255, 255, 0.12) 50%,
        rgba(255, 255, 255, 0.05) 100%
    );
    background-size: 200% 100%;
    animation: shimmer 1.4s ease infinite;
}

.skeleton-fade-leave-active {
    transition: opacity 0.2s ease;
}

.skeleton-fade-leave-to {
    opacity: 0;
}

/* Active pane blue accent */
.pane {
    transition: outline-color 0.15s ease;
}

.pane.active {
    outline: 1px solid rgba(100, 180, 255, 0.35);
    outline-offset: -1px;
}
</style>
