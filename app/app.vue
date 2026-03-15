<template>
    <div>
        <div class="bg" />
        <div class="bg bg2" />
        <div class="bg bg3" />

        <div class="screen">
            <NuxtPage />
        </div>

        <Transition name="loader-fade">
            <div v-if="loading" class="loader-overlay">
                <div class="loader-card">
                    <img src="/logo.svg" alt="LoCode" class="loader-logo" />
                    <div class="loader-text-container">
                        <span v-for="i in messages.length" class="loader-text"
                            :style="{ animationDelay: `${(i - 1) * 2}s` }">
                            {{ messages[(messageIndex + i) % messages.length]! }}
                        </span>
                    </div>
                    <div class="loader-progress">
                        <div class="loader-progress-fill" />
                    </div>
                </div>
            </div>
        </Transition>
    </div>
</template>

<style lang="css" scoped>
    .screen {
        width: 100%;
        height: 100%;
        position: fixed;
    }

    .bg {
        filter: blur(2px);
        animation: slide 12s ease-in-out infinite alternate;
        background-image: linear-gradient(-60deg, #1a1a2e 50%, #16213e 50%);
        position: fixed;
        left: -50%;
        right: -50%;
        top: 0;
        bottom: 0;
        opacity: 1;
    }

    .bg2 {
        background-image: linear-gradient(-60deg, #0f0f1a 50%, #1e1e2e 50%);
        animation-delay: -3s;
        animation-direction: alternate-reverse;
        animation-duration: 16s;
    }

    .bg3 {
        background-image: linear-gradient(-60deg, #141425 50%, #1a1a30 50%);
        animation-delay: -6s;
        animation-duration: 20s;
    }

    @keyframes slide {
        0% { transform: translateX(-25%); }
        100% { transform: translateX(25%); }
    }

    /* --- Loading overlay --- */
    .loader-overlay {
        position: fixed;
        inset: 0;
        z-index: 9999;
        display: flex;
        align-items: center;
        justify-content: center;
        backdrop-filter: blur(20px);
        -webkit-backdrop-filter: blur(20px);
        background: rgba(0, 0, 0, 0.3);
    }

    .loader-card {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 20px;
        padding: 40px 50px;
        background: rgba(20, 20, 20, 0.6);
        border: 1px solid rgba(255, 255, 255, 0.1);
        border-radius: 16px;
        box-shadow:
            0 8px 32px rgba(0, 0, 0, 0.4),
            inset 0 1px 0 rgba(255, 255, 255, 0.05);
    }

    .loader-logo {
        width: 48px;
        height: 48px;
        animation: logo-pulse 1.995s ease-in-out infinite;
    }

    @keyframes logo-pulse {
        0%, 100% { opacity: 0.7; transform: scale(1); }
        40%, 60% { opacity: 1; transform: scale(1.08); }
    }

    .loader-text-container {
        height: 22px;
        list-style: none;
        overflow: hidden;
    }

    .loader-text {
        font-size: 0.85rem;
        font-weight: 500;
        color: rgba(255, 255, 255, 0.95);
        white-space: nowrap;
        letter-spacing: 0.02em;
        position: absolute;
        opacity: 0;
        animation: rotate 20s infinite;
        transform: translateX(-50%)
    }

    @keyframes rotate {
        0%, 10% { opacity: 0 }
        3%, 7% { opacity: 1 }
    }

    .loader-progress {
        width: 180px;
        height: 2px;
        border-radius: 2px;
        background: rgba(255, 255, 255, 0.08);
        overflow: hidden;
    }

    .loader-progress-fill {
        height: 100%;
        border-radius: 2px;
        background: linear-gradient(90deg, rgba(140, 160, 200, 0.6), rgba(200, 210, 230, 0.4));
        animation: progress-indeterminate 5s cubic-bezier(0.4, 0, 0.2, 1);
    }

    @keyframes progress-indeterminate {
        0%   { width: 0% }
        20%  { width: 70% }
        80%  { width: 95% }
        100% { width: 100% }
    }

    /* --- Loader fade out --- */
    .loader-fade-leave-active {
        transition: opacity 0.4s ease;
    }
    .loader-fade-leave-to {
        opacity: 0;
    }
</style>

<script setup lang="ts">
useHead({
    title: "LoCode",
    meta: [
        { name: "viewport", content: "width=device-width, initial-scale=1, interactive-widget=resizes-content" },
    ]
});

const messages = [
    // "Activation du mode turbo",
    "Déploiement de la matrice syntaxique",
    "Harmonisation des fréquences binaires",
    "Optimisation des particules virtuelles",
    "Compilation des algorithmes quantiques",
    "Calibration de l'interface holographique",
    "Chargement des bibliothèques neurales",
    "Injection du code source galactique",
    "Synchronisation des flux temporels",
    "Chargement des shaders cognitifs",
    "Analyse spectrale du workspace",
    // "Initialisation du plasma",
];

const loading = ref(true);
// useState: computed once on server, serialized in HTML payload, reused as-is on client → no hydration mismatch
const messageIndex = useState('loaderMsgIdx', () => Math.floor(Math.random() * messages.length));

onMounted(() => {
    nextTick(() => { loading.value = false; });
});

</script>
