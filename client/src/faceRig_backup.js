// ===============================
// 2D FaceRig Engine (FINAL EMOTION + LIPS FIX)
// ===============================

class FaceRig {
    constructor() {
        this.base = document.getElementById("base");
        this.emotion = document.getElementById("emotion");
        this.blink = document.getElementById("blink");
        this.viseme = document.getElementById("viseme");

        // ✅ Secondary viseme blend layer (for smoothing only, above mouth)
        this.viseme2 = document.createElement("img");
        this.viseme2.style.position = "absolute";
        this.viseme2.style.top = "0";
        this.viseme2.style.left = "0";
        this.viseme2.style.width = "100%";
        this.viseme2.style.pointerEvents = "none";
        this.viseme2.style.opacity = "0";
        this.viseme2.style.zIndex = 4;

        document.getElementById("avatar").appendChild(this.viseme2);

        // ✅ Enforce correct visual stacking
        this.base.style.zIndex = 1;
        this.emotion.style.zIndex = 2;
        this.viseme.style.zIndex = 3;
        this.blink.style.zIndex = 5;

        // animation states
        this.currentEmotion = "neutral";
        this.targetEmotion = "neutral";
        this.emotionBlend = 0;

        this.eyeJitter = { x: 0, y: 0 };
        this.headTilt = 0;

        this.isSpeaking = false;
        this.currentViseme = null;
        this.visemeFade = 0;

        this.startIdleLoops();
        requestAnimationFrame(() => this.update());
    }

    // =============================================
    // Idle micro motions
    // =============================================
    startIdleLoops() {
        setInterval(() => this.blinkOnce(), 3000 + Math.random() * 1400);

        setInterval(() => {
            this.eyeJitter.x = (Math.random() - 0.5) * 1.2;
            this.eyeJitter.y = (Math.random() - 0.5) * 1.2;
        }, 180);

        setInterval(() => {
            if (!this.isSpeaking) {
                this.headTilt = (Math.random() - 0.5) * 1.1;
            }
        }, 900);
    }

    blinkOnce() {
        this.blink.style.opacity = 1;
        setTimeout(() => {
            this.blink.style.opacity = 0;
        }, 110);
    }

    // =============================================
    // ✅ EMOTION SYSTEM (NEVER TOUCHES LIPS)
    // =============================================
    setEmotion(e) {
        if (this.currentEmotion === e) return;
        this.currentEmotion = e;
        this.emotionBlend = 0;
        this.emotion.src = `assets/emotions/${e}.png`;
    }

    // =============================================
    // ✅ SPEAKING STATE
    // =============================================
    startSpeaking() {
        this.isSpeaking = true;
    }

    stopSpeaking() {
        this.isSpeaking = false;
        this.hideVisemes();
    }

    // =============================================
    // ✅ LIP-SYNC (ALWAYS ABOVE EMOTION)
    // =============================================
    showViseme(v) {
        if (!v) return;

        this.currentViseme = v;
        this.visemeFade = 1;

        const src = `assets/visemes/${v}.png`;

        this.viseme.src = src;
        this.viseme2.src = src;

        this.viseme.style.opacity = 1;
        this.viseme2.style.opacity = 0.35;
    }

    hideVisemes() {
        this.viseme.style.opacity = 0;
        this.viseme2.style.opacity = 0;
        this.currentViseme = null;
    }

    // =============================================
    // ✅ MAIN UPDATE LOOP (NO LAYER CONFLICT)
    // =============================================
    update() {
        // Smooth emotion fade independently
        if (this.emotionBlend < 1) this.emotionBlend += 0.05;
        this.emotion.style.opacity = this.emotionBlend;

        // Smooth viseme fade while stopping
        if (!this.isSpeaking && this.visemeFade > 0) {
            this.visemeFade -= 0.08;
            this.viseme.style.opacity = Math.max(0, this.visemeFade);
            this.viseme2.style.opacity = Math.max(0, this.visemeFade * 0.35);
        }

        // Head + eye motion
        this.base.style.transform =
            `rotate(${this.headTilt}deg) translate(${this.eyeJitter.x}px, ${this.eyeJitter.y}px)`;

        requestAnimationFrame(() => this.update());
    }
}

window.FaceRig = FaceRig;
