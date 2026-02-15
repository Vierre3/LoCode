<template>
    <div class="terminal-panel" :style="{ height: panelHeight + 'px' }">
        <div class="terminal-resize-handle" @mousedown.prevent="startHeightResize" />
        <!-- Mobile: horizontal bar above terminal -->
        <div v-if="isMobile" class="terminal-mobile-bar">
            <div v-for="s in sessions" :key="s.id"
                class="terminal-mobile-tab" :class="{ active: s.id === activeId }"
                @click="selectSession(s.id)">
                {{ s.name }}
            </div>
            <button class="sidebar-btn" @click="addSession">+</button>
            <button class="sidebar-btn danger" @click="removeSession">&times;</button>
        </div>
        <div class="terminal-body">
            <div ref="contentRef" class="terminal-content"
                @dragenter.prevent="onDragEnter" @dragover.prevent="onDragOver"
                @dragleave="onDragLeave" @drop.prevent="onTermDrop">
                <!-- Drop overlay for terminal split -->
                <div v-if="termDragging" class="term-drop-overlay">
                    <div class="term-drop-zone" :class="{ hover: termDropZone === 'left' }">Left</div>
                    <div class="term-drop-zone" :class="{ hover: termDropZone === 'right' }">Right</div>
                </div>

                <!-- Split resize handle -->
                <div v-if="splitId" class="terminal-split-handle"
                    :style="{ left: splitRatio + '%' }"
                    @mousedown.prevent="startSplitResize" />

                <!-- All terminals rendered once, positioned via CSS -->
                <div v-for="s in sessions" :key="s.id"
                    class="terminal-slot"
                    :class="termSlotClass(s.id)"
                    :style="termSlotStyle(s.id)">
                    <Terminal :ref="el => setTermRef(s.id, el)" :cwd="rootPath"
                        :active="s.id === activeId || s.id === splitId" />
                </div>
            </div>
            <div v-if="!isMobile" class="terminal-sidebar">
                <div v-for="s in sessions" :key="s.id"
                    class="terminal-tab" :class="{ active: s.id === activeId, split: s.id === splitId }"
                    draggable="true"
                    @dragstart="e => onTabDragStart(e, s.id)"
                    @click="selectSession(s.id)">
                    {{ s.name }}
                </div>
                <div class="terminal-sidebar-actions">
                    <button class="sidebar-btn" @click="addSession" title="New terminal">+</button>
                    <button class="sidebar-btn danger" @click="removeSession" title="Close terminal">&times;</button>
                </div>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
const props = defineProps<{
    rootPath: string;
    isMobile: boolean;
}>();

const emit = defineEmits<{
    (e: "update:sessionCount", count: number): void;
    (e: "update:splitIndex", index: number): void;
    (e: "close"): void;
}>();

interface TerminalSession {
    id: string;
    name: string;
}

let nextId = 1;

function createSessions(count: number): TerminalSession[] {
    const arr: TerminalSession[] = [];
    for (let i = 0; i < Math.max(1, count); i++) {
        arr.push({ id: "t" + nextId, name: `Terminal ${nextId}` });
        nextId++;
    }
    return arr;
}

const sessions = ref<TerminalSession[]>(createSessions(1));
const activeId = ref(sessions.value[0]!.id);
const splitId = ref<string | null>(null);
const splitRatio = ref(50);

// Remember last split pair to restore when clicking back
let savedSplit: { left: string; right: string } | null = null;
const contentRef = ref<HTMLElement | null>(null);

const panelHeight = ref(
    import.meta.client ? parseInt(localStorage.getItem("locode:terminalHeight") || "250") : 250
);

// --- Terminal refs for focus ---
const termRefs: Record<string, any> = {};

function setTermRef(id: string, el: any) {
    if (el) termRefs[id] = el;
    else delete termRefs[id];
}

function focusTerminal(id: string) {
    nextTick(() => termRefs[id]?.focus());
}

function termSlotClass(id: string) {
    if (!splitId.value) {
        return { hidden: id !== activeId.value };
    }
    if (id === activeId.value) return { 'split-left': true };
    if (id === splitId.value) return { 'split-right': true };
    return { hidden: true };
}

function termSlotStyle(id: string) {
    if (splitId.value && id === activeId.value) {
        return { width: splitRatio.value + '%' };
    }
    return {};
}

watch(splitId, () => {
    const idx = splitId.value ? sessions.value.findIndex(s => s.id === splitId.value) : -1;
    emit("update:splitIndex", idx);
});

// --- Terminal drag-and-drop for split ---
const termDragging = ref(false);
const termDropZone = ref<"left" | "right" | null>(null);
let termDragCounter = 0;
let draggedTermId: string | null = null;

function onTabDragStart(e: DragEvent, id: string) {
    draggedTermId = id;
    e.dataTransfer?.setData("text/terminal-id", id);
}

function onDragEnter(e: DragEvent) {
    if (!e.dataTransfer?.types.includes("text/terminal-id")) return;
    termDragCounter++;
    termDragging.value = true;
}

function onDragOver(e: DragEvent) {
    if (!termDragging.value) return;
    const el = contentRef.value;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    termDropZone.value = x < 0.5 ? "left" : "right";
}

function onDragLeave(e: DragEvent) {
    termDragCounter--;
    if (termDragCounter <= 0) {
        termDragging.value = false;
        termDropZone.value = null;
        termDragCounter = 0;
    }
}

function onTermDrop(e: DragEvent) {
    termDragging.value = false;
    termDragCounter = 0;
    const droppedId = e.dataTransfer?.getData("text/terminal-id") || draggedTermId;
    draggedTermId = null;
    if (!droppedId) return;

    const zone = termDropZone.value;
    termDropZone.value = null;

    if (droppedId === activeId.value && !splitId.value) return;

    if (droppedId === activeId.value) return;

    if (zone === "left") {
        splitId.value = activeId.value;
        activeId.value = droppedId;
    } else if (zone === "right") {
        splitId.value = activeId.value;
        activeId.value = droppedId;
    }
    savedSplit = null;
    focusTerminal(droppedId);
}

// --- Session management ---
function addSession() {
    const num = nextId++;
    const id = "t" + num;
    sessions.value.push({ id, name: `Terminal ${num}` });
    activeId.value = id;
    emit("update:sessionCount", sessions.value.length);
    focusTerminal(id);
}

function removeSession() {
    if (sessions.value.length <= 1) {
        sessions.value = [];
        splitId.value = null;
        savedSplit = null;
        emit("update:sessionCount", 0);
        emit("close");
        return;
    }
    const removedId = activeId.value;
    const idx = sessions.value.findIndex(s => s.id === removedId);
    sessions.value = sessions.value.filter(s => s.id !== removedId);

    // If removing one of a split pair, unsplit and show the other full
    if (splitId.value) {
        const otherId = splitId.value === removedId ? activeId.value : splitId.value;
        splitId.value = null;
        activeId.value = otherId;
    } else {
        activeId.value = sessions.value[Math.min(idx, sessions.value.length - 1)]!.id;
    }

    // Invalidate savedSplit if a member was removed
    if (savedSplit && (savedSplit.left === removedId || savedSplit.right === removedId)) {
        savedSplit = null;
    }

    // If savedSplit exists and both members still alive, restore the split
    if (savedSplit) {
        const bothExist = sessions.value.some(s => s.id === savedSplit!.left)
            && sessions.value.some(s => s.id === savedSplit!.right);
        if (bothExist) {
            activeId.value = savedSplit.left;
            splitId.value = savedSplit.right;
            savedSplit = null;
        }
    }

    emit("update:sessionCount", sessions.value.length);
}

function selectSession(id: string) {
    if (splitId.value) {
        // Clicking one of the two split terminals → swap focus
        if (id === activeId.value || id === splitId.value) {
            const oldActive = activeId.value;
            activeId.value = splitId.value;
            splitId.value = oldActive;
            focusTerminal(activeId.value);
            return;
        }
        // Clicking a third terminal → save split pair and unsplit
        savedSplit = { left: activeId.value, right: splitId.value };
        splitId.value = null;
        activeId.value = id;
        focusTerminal(id);
        return;
    }
    // Check if clicking a terminal that was part of a saved split
    if (savedSplit && (id === savedSplit.left || id === savedSplit.right)) {
        // Both terminals still exist → restore split
        const bothExist = sessions.value.some(s => s.id === savedSplit!.left)
            && sessions.value.some(s => s.id === savedSplit!.right);
        if (bothExist) {
            activeId.value = savedSplit.left;
            splitId.value = savedSplit.right;
            savedSplit = null;
            focusTerminal(id);
            return;
        }
        savedSplit = null;
    }
    activeId.value = id;
    focusTerminal(id);
}

// --- Height resize ---
let heightCleanup: (() => void) | null = null;

function startHeightResize() {
    document.body.style.cursor = "row-resize";
    document.body.style.userSelect = "none";

    const onMouseMove = (ev: MouseEvent) => {
        const viewportH = window.innerHeight;
        const maxH = viewportH * 0.6;
        const bottomOffset = 8;
        const height = viewportH - ev.clientY - bottomOffset;
        panelHeight.value = Math.max(100, Math.min(maxH, height));
    };

    const cleanup = () => {
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        localStorage.setItem("locode:terminalHeight", String(panelHeight.value));
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", cleanup);
        heightCleanup = null;
    };

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", cleanup);
    heightCleanup = cleanup;
}

// --- Split resize ---
let splitCleanup: (() => void) | null = null;

function startSplitResize() {
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const container = contentRef.value;
    if (!container) return;
    const rect = container.getBoundingClientRect();

    const onMouseMove = (ev: MouseEvent) => {
        const ratio = ((ev.clientX - rect.left) / rect.width) * 100;
        splitRatio.value = Math.max(20, Math.min(80, ratio));
    };

    const cleanup = () => {
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", cleanup);
        splitCleanup = null;
    };

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", cleanup);
    splitCleanup = cleanup;
}

function resetSessions(count: number, splitIndex: number) {
    nextId = 1;
    sessions.value = createSessions(count);
    activeId.value = sessions.value[0]!.id;
    splitId.value = splitIndex >= 0 && splitIndex < sessions.value.length
        ? sessions.value[splitIndex]!.id
        : null;
    emit("update:sessionCount", sessions.value.length);
}

function ensureSession() {
    if (sessions.value.length === 0) {
        nextId = 1;
        sessions.value = createSessions(1);
        activeId.value = sessions.value[0]!.id;
        splitId.value = null;
        emit("update:sessionCount", 1);
    }
}

defineExpose({ resetSessions, ensureSession });

onBeforeUnmount(() => {
    heightCleanup?.();
    splitCleanup?.();
});
</script>

<style lang="css" scoped>
.terminal-panel {
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    min-height: 100px;
    position: relative;
}

.terminal-resize-handle {
    height: 6px;
    cursor: row-resize;
    flex-shrink: 0;
}

.terminal-resize-handle:hover {
    background: rgba(255, 255, 255, 0.08);
    border-radius: 3px;
}

.terminal-body {
    flex: 1;
    display: flex;
    min-height: 0;
    background: #1e1e1e;
    border-radius: 5px;
    overflow: hidden;
}

.terminal-content {
    flex: 1;
    display: flex;
    min-width: 0;
    position: relative;
}

.terminal-slot {
    width: 100%;
    height: 100%;
}

.terminal-slot.hidden {
    position: absolute;
    left: -9999px;
    width: 100%;
    height: 100%;
    pointer-events: none;
}

.terminal-slot.split-left {
    flex-shrink: 0;
    height: 100%;
}

.terminal-slot.split-right {
    flex: 1;
    height: 100%;
    min-width: 0;
}

.terminal-split-handle {
    position: absolute;
    top: 0;
    width: 6px;
    height: 100%;
    cursor: col-resize;
    z-index: 5;
    transform: translateX(-3px);
}

.terminal-split-handle:hover {
    background: rgba(255, 255, 255, 0.1);
}

/* Terminal drop overlay */
.term-drop-overlay {
    position: absolute;
    inset: 0;
    z-index: 10;
    display: flex;
    pointer-events: none;
}

.term-drop-zone {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 0.85rem;
    font-weight: 700;
    color: rgba(255, 255, 255, 0.5);
    background: rgba(255, 255, 255, 0.03);
    border: 2px dashed rgba(255, 255, 255, 0.08);
    transition: .1s ease;
}

.term-drop-zone.hover {
    background: rgba(100, 180, 255, 0.15);
    border-color: rgba(100, 180, 255, 0.4);
    color: white;
}

/* Sidebar */
.terminal-sidebar {
    width: 90px;
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    border-left: 1px solid rgba(255, 255, 255, 0.08);
    padding: 4px;
    gap: 2px;
    overflow-y: auto;
}

.terminal-tab {
    font-size: 0.7rem;
    font-weight: 600;
    padding: 4px 6px;
    border-radius: 3px;
    cursor: grab;
    color: rgba(255, 255, 255, 0.6);
    transition: .1s ease;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

.terminal-tab:hover {
    color: white;
    background: rgba(255, 255, 255, 0.08);
}

.terminal-tab.active {
    color: white;
    background: rgba(255, 255, 255, 0.12);
    font-weight: 700;
}

.terminal-tab.split {
    border-left: 2px solid rgba(100, 180, 255, 0.5);
}

.terminal-sidebar-actions {
    margin-top: auto;
    display: flex;
    gap: 2px;
    padding-top: 4px;
    border-top: 1px solid rgba(255, 255, 255, 0.06);
}

.sidebar-btn {
    flex: 1;
    font-size: 0.8rem;
    font-weight: 700;
    padding: 3px;
    border-radius: 3px;
    cursor: pointer;
    color: rgba(255, 255, 255, 0.6);
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid rgba(255, 255, 255, 0.08);
    transition: .15s ease;
}

.sidebar-btn:hover {
    color: white;
    background: rgba(255, 255, 255, 0.12);
}

.sidebar-btn.danger:hover {
    color: white;
    background: rgba(220, 100, 100, 0.9);
}

.sidebar-btn:disabled {
    opacity: 0.3;
    cursor: default;
}

/* Mobile bar */
.terminal-mobile-bar {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 4px;
    background: #1e1e1e;
    border-radius: 5px 5px 0 0;
    flex-shrink: 0;
    overflow-x: auto;
}

.terminal-mobile-tab {
    font-size: 0.65rem;
    font-weight: 600;
    padding: 3px 8px;
    border-radius: 3px;
    cursor: pointer;
    color: rgba(255, 255, 255, 0.6);
    white-space: nowrap;
    flex-shrink: 0;
}

.terminal-mobile-tab.active {
    color: white;
    background: rgba(255, 255, 255, 0.12);
}
</style>
