<template>
    <ul :class="{ 'browse-mode': !!onSelect }">
        <li v-for="node in nodes" :key="node.path">
            <div class="node-row">
                <div class="node cursor-pointer p-1 rounded select-none"
                    :class="{ active: openFiles.includes(node.path) }"
                    :draggable="node.type === 'file'"
                    @dragstart="e => { if (node.type === 'file') { e.dataTransfer?.setData('text/locode-file', node.path); e.dataTransfer!.effectAllowed = 'move'; } }"
                    @click="props.onClick(node)">
                    {{ node.type !== 'dir' ? "📄" : node.open ? "📂" : "📁" }} {{ node.name }}
                </div>
                <button v-if="onSelect && node.type === 'dir'"
                    @click.stop="onSelect(node)"
                    class="select-btn">
                    Open
                </button>
            </div>
            <FileTree v-if="node.type === 'dir' && node.open" class="ml-5" :nodes="node.children || []"
                :openFiles="openFiles" :folder="folder" :onClick="onClick" :onSelect="onSelect" />
        </li>
    </ul>
</template>

<script setup lang="ts">
const props = defineProps<{
    openFiles: string[], folder: string,
    nodes: { name: string; path: string; type: "file" | "dir"; children?: any[]; open?: Boolean }[],
    onClick: (node: any) => void,
    onSelect?: (node: any) => void
}>();
</script>

<style lang="css" scoped>
.node-row {
    display: flex;
    align-items: center;
}

.node {
    font-weight: 600;
    font-size: 0.95rem;
    transition: font-weight .1s ease;
    white-space: nowrap;
}

.node:hover {
    font-weight: 700;
}

.node.active {
    font-weight: 700;
}

.browse-mode .node {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    mask-image: linear-gradient(to right, black calc(100% - 12px), transparent);
    -webkit-mask-image: linear-gradient(to right, black calc(100% - 12px), transparent);
}

.select-btn {
    flex-shrink: 0;
    font-size: 0.65rem;
    font-weight: 700;
    padding: 1px 6px;
    border-radius: 3px;
    background: rgba(255, 255, 255, 0.12);
    border: 1px solid rgba(255, 255, 255, 0.2);
    color: white;
    cursor: pointer;
    margin-left: 4px;
    transition: .15s ease;
}

.select-btn:hover {
    background: rgba(255, 255, 255, 0.25);
    border-color: rgba(255, 255, 255, 0.37);
}

@media (max-width: 767px) {
    .node {
        font-size: 0.8rem;
        font-weight: 500;
    }
}
</style>
