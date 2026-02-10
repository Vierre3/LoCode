<template>
    <div class="flex h-screen gap-2 p-2 relative">
        <!-- Mobile hamburger toggle -->
        <button @click="sidebarOpen = !sidebarOpen" class="hamburger md:hidden">
            {{ sidebarOpen ? '✕' : '☰' }}
        </button>

        <!-- Mobile backdrop -->
        <div v-if="sidebarOpen" class="backdrop md:hidden" @click="sidebarOpen = false" />

        <!-- Sidebar -->
        <div class="sidebar" :class="{ open: sidebarOpen }">
            <FileExplorer @select-file="onSelectFile" :file="currentFile" rootPath="." />
        </div>

        <!-- Editor panel -->
        <div class="flex-1 flex flex-col gap-2 min-w-0">
            <div class="header-bar flex items-center gap-2">
                <span v-if="currentFile" class="file-label font-bold">{{ currentFile }}</span>
                <button @click="saveFile" class="btn ml-auto" :disabled="!currentFile">Save</button>
            </div>
            <MonacoEditor v-model="code" :language="language" />
        </div>
    </div>
</template>

<style lang="css" scoped>
.hamburger {
    position: fixed;
    top: 8px;
    left: 8px;
    z-index: 60;
    width: 40px;
    height: 40px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 1.25rem;
    font-weight: bold;
    cursor: pointer;
    background-color: rgba(255, 255, 255, 0.15);
    backdrop-filter: blur(15px);
    border: 2px solid rgba(255, 255, 255, 0.2);
    border-radius: 8px;
    color: white;
    transition: .2s ease;
}

.hamburger:active {
    transform: scale(0.92);
}

@media (min-width: 768px) {
    .hamburger {
        display: none !important;
    }
}

.backdrop {
    position: fixed;
    inset: 0;
    z-index: 40;
    background: rgba(0, 0, 0, 0.4);
}

.sidebar {
    width: 250px;
    flex-shrink: 0;
    height: 100%;
}

/* Mobile: drawer slide-in */
@media (max-width: 767px) {
    .sidebar {
        position: fixed;
        left: 0;
        top: 0;
        height: 100%;
        width: 80vw;
        max-width: 300px;
        z-index: 50;
        padding: 52px 8px 8px 8px;
        border-radius: 0 22px 22px 0;
        transform: translateX(-100%);
        transition: transform .25s ease;
    }

    .sidebar.open {
        transform: translateX(0);
    }
}

@media (max-width: 767px) {
    .header-bar {
        padding-left: 48px;
    }
}

.file-label {
    font-size: 0.8rem;
    opacity: 0.9;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.btn {
    font-weight: bold;
    cursor: pointer;
    padding: 6px 16px;
    background-color: rgba(255, 255, 255, 0.12);
    backdrop-filter: blur(15px);
    box-shadow: 0px 0px 25px rgba(227, 228, 237, 0.37);
    border: 2px solid rgba(255, 255, 255, 0.12);
    border-radius: 5px;
    transition: .3s ease;
    color: white;
    white-space: nowrap;
}

.btn:hover {
    transform: translateY(-2px);
    border-color: rgba(255, 255, 255, 0.37);
}

.btn:disabled {
    opacity: 0.4;
    cursor: default;
    transform: none;
}
</style>

<script setup lang="ts">
const code = ref("");
const currentFile = ref("");
const language = ref("");
const sidebarOpen = ref(false);

const isMobile = ref(false);

onMounted(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    isMobile.value = mq.matches;
    sidebarOpen.value = !mq.matches;
    mq.addEventListener("change", (e) => {
        isMobile.value = e.matches;
        sidebarOpen.value = !e.matches;
    });

    const saved = localStorage.getItem("locode:currentFile");
    if (saved) loadFile(saved);
});

function onSelectFile(path: string) {
    if (isMobile.value) sidebarOpen.value = false;
    if (path !== currentFile.value) loadFile(path);
}

async function loadFile(path: string) {
    currentFile.value = path;
    localStorage.setItem("locode:currentFile", path);
    const res = await fetch("/api/read?path=" + path);
    language.value = detectLanguage(path);
    code.value = await res.text();
}

async function saveFile() {
    if (!currentFile.value) return;
    await fetch("/api/write", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: currentFile.value, content: code.value }),
    });
}

function detectLanguage(path: string): string {
    const ext = path.split(".").pop();
    switch (ext) {
        case "js": return "javascript";
        case "ts": return "typescript";
        case "vue": return "vue";
        case "json": return "json";
        case "html": return "html";
        case "css": return "css";
        case "md": return "markdown";
        default: return "plaintext";
    }
}
</script>
