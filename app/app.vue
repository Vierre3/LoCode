<template>
    <div>
        <meta name="viewport" content="width=device-width, initial-scale=1, interactive-widget=resizes-content" />
        <title>LoCode</title>
        <div class="bg" />
        <div class="bg bg2" />
        <div class="bg bg3" />
        <div class="screen">
            <NuxtPage />
        </div>
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
        background-image: linear-gradient(-60deg, #09f 50%, #6c3 50%);
        position: fixed;
        left: -50%;
        right: -50%;
        top: 0;
        bottom: 0;
        opacity: 0.5;
    }
    .bg2 {
        animation-delay: -3s;
        animation-direction: alternate-reverse;
        animation-duration: 16s;
    }
    .bg3 {
        animation-delay: -6s;
        animation-duration: 20s;
    }

    @keyframes slide {
        0% { transform: translateX(-25%); }
        100% { transform: translateX(25%); }
    }
</style>

<script>
</script>
