<template>
    <div class="overflow-auto h-full navbar p-3">
        <FileTree :nodes="tree" :file="file" :folder="folder" :onClick="click" />
    </div>
</template>

<style lang="css" scoped>
.navbar {
    background-color: rgba(255, 255, 255, 0.12);
    backdrop-filter: blur(15px);
    box-shadow: 0px 0px 25px rgba(227, 228, 237, 0.37);
    border: 2px solid rgba(255, 255, 255, 0.12);
    border-radius: 5px;
    transition: .1s ease;
}

@media (max-width: 767px) {
    .navbar {
        backdrop-filter: blur(5px);
    }
}

.navbar:hover {
    border-color: rgba(255, 255, 255, 0.37);
}
</style>

<script setup lang="ts">
const props = defineProps<{ file: string, rootPath: string }>();
const emit = defineEmits<{ (e: "select-file", path: string): void }>();

const tree = ref<any[]>([]);
const folder = ref("");

async function loadTree(path: string): Promise<any[]> {
    folder.value = path;
    const res = await fetch("/api/list?path=" + path);
    return await res.json();
}

async function click(node: any) {
    if (node.type !== "file") {
        node.open = !node.open;
        if (node.open)
            node.children = await loadTree(node.path);
    } else
        emit("select-file", node.path);
}

onMounted(async () => tree.value = await loadTree(props.rootPath));
</script>
