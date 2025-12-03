// ===============================
// 2D FaceRig Engine
// ===============================

class FaceRig {
    constructor() {
        this.base = document.getElementById("base");
        this.emotion = document.getElementById("emotion");
        this.blink = document.getElementById("blink");
        this.viseme = document.getElementById("viseme");

        // dynamic second viseme layer for smoother blend
        this.viseme2 = document.createElement("img");
        this.viseme2.style.position = "absolute";
        this.viseme2.style.top = "0";
        this.viseme2.style.left = "0";
        this.viseme2.style.width = "100%";
        this.viseme2.style.opacity = "0";
        document.getElementById("avatar").appendChild(this.viseme2);

        // animation states
        this.currentEmotion = "neutral";
        this.targetEmotion = "neutral";
        this.emotionBlend = 0;

        this.eyeJitter = { x: 0, y: 0 };
        this.headTilt = 0;

        this.isSpeaking = false;

        this.startIdleLoops();
        requestAnimationFrame(() => this.update());
    }

    // =============================================
    // Idle micro motions
    // =============================================
    startIdleLoops() {
        // blinking
        setInterval(() => this.blinkOnce(), 3500 + Math.random() * 1200);

        // eye jitter
        setInterval(() => {
            this.eyeJitter.x = (Math.random() - 0.5) * 2;
            this.eyeJitter.y = (Math.random() - 0.5) * 2;
        }, 180);

        // breathing / head bob
        setInterval(() => {
            if (!this.isSpeaking) {
                this.headTilt = (Math.random() - 0.5) * 2; // degrees
            }
        }, 800);
    }

    blinkOnce() {
        this.blink.style.opacity = 1;
        setTimeout(() => {
            this.blink.style.opacity = 0;
        }, 120);
    }

    // =============================================
    // Emotion fading (smooth morph)
    // =============================================
    setEmotion(e) {
        this.targetEmotion = e;
        this.emotion.src = `assets/emotions/${e}.png`;
    }

    // =============================================
    // Lip-sync (called by app.js)
    // =============================================
    showViseme(v) {
        this.viseme.src = `assets/viseme/${v}.png`;
        this.viseme.style.opacity = 1;

        // secondary blend layer (delayed fade)
        this.viseme2.src = this.viseme.src;
        this.viseme2.style.opacity = 0.1;
    }

    hideVisemes() {
        this.viseme.style.opacity = 0;
        this.viseme2.style.opacity = 0;
    }

    // =============================================
    // Update loop
    // =============================================
    update() {
        // smooth emotion blend
        if (this.emotionBlend < 1) this.emotionBlend += 0.05;

        this.emotion.style.opacity = this.emotionBlend;

        // head tilt & eye jitter
        this.base.style.transform =
            `rotate(${this.headTilt}deg) translate(${this.eyeJitter.x}px, ${this.eyeJitter.y}px)`;

        requestAnimationFrame(() => this.update());
    }
}

window.FaceRig = FaceRig;
