// ===============================
// SIMPLIFIED FaceRig Engine
// ===============================

class FaceRig {
    constructor() {
        this.base = document.getElementById("base");
        this.emotion = document.getElementById("emotion");
        this.blink = document.getElementById("blink");
        this.viseme = document.getElementById("viseme");

        // ✅ Visual stacking
        this.base.style.zIndex = 1;
        this.emotion.style.zIndex = 2;
        this.viseme.style.zIndex = 10; // HIGHEST - Always on top!
        this.blink.style.zIndex = 11; // Above everything

        // ✅ Animation states
        this.currentEmotion = "neutral";
        this.isSpeaking = false;
        this.currentViseme = null;

        this.eyeJitter = { x: 0, y: 0 };
        this.headTilt = 0;

        this.blinkState = 0;
        this.blinkTimer = 0;

        this.idleOffset = { x: 0, y: 0 };
        this.idlePhase = 0;

        // ✅ Initialize
        this.setEmotion("neutral");
        this.startIdleLoops();
        requestAnimationFrame(() => this.update());
    }

    // =============================================
    // Idle Animations
    // =============================================
    startIdleLoops() {
        // Natural blinking
        setInterval(() => {
            if (!this.isSpeaking || Math.random() > 0.3) {
                this.blinkOnce();
            }
        }, 2000 + Math.random() * 2500);

        // Micro eye movements
        setInterval(() => {
            this.eyeJitter.x = (Math.random() - 0.5) * 0.8;
            this.eyeJitter.y = (Math.random() - 0.5) * 0.6;
        }, 150 + Math.random() * 200);

        // Head movements
        setInterval(() => {
            if (!this.isSpeaking) {
                this.headTilt = (Math.random() - 0.5) * 1.5;
            }
        }, 2000 + Math.random() * 3000);

        // Breathing movement
        setInterval(() => {
            this.idlePhase += 0.02;
            this.idleOffset.x = Math.sin(this.idlePhase) * 0.1;
            this.idleOffset.y = Math.cos(this.idlePhase * 0.7) * 0.08;
        }, 40);
    }

    blinkOnce() {
        if (this.blinkState > 0) return;

        this.blinkState = 1;
        this.blinkTimer = 0;

        const animateBlink = () => {
            this.blinkTimer += 16;

            if (this.blinkTimer < 50) {
                // Closing
                this.blink.style.opacity = this.blinkTimer / 50;
            } else if (this.blinkTimer < 75) {
                // Holding closed
                this.blink.style.opacity = 1;
            } else if (this.blinkTimer < 125) {
                // Opening
                this.blink.style.opacity = 1 - ((this.blinkTimer - 75) / 50);
            } else {
                // Finished
                this.blink.style.opacity = 0;
                this.blinkState = 0;
                return;
            }

            if (this.blinkState > 0) {
                requestAnimationFrame(animateBlink);
            }
        };

        requestAnimationFrame(animateBlink);
    }

    // =============================================
    // Emotion System
    // =============================================
    setEmotion(emotion) {
        if (this.currentEmotion === emotion) return;

        this.currentEmotion = emotion;

        // Load emotion image
        const img = new Image();
        img.onload = () => {
            if (this.currentEmotion === emotion) {
                this.emotion.src = `assets/emotions/${emotion}.png`;
                this.emotion.style.opacity = 1;
            }
        };
        img.onerror = () => {
            console.warn(`Failed to load emotion: ${emotion}`);
            // Fallback to neutral
            this.emotion.src = `assets/emotions/neutral.png`;
            this.emotion.style.opacity = 1;
        };
        img.src = `assets/emotions/${emotion}.png`;
    }

    // =============================================
    // Speaking System
    // =============================================
    startSpeaking() {
        this.isSpeaking = true;
        // Reduce head movement while speaking
        this.headTilt *= 0.2;
    }

    stopSpeaking() {
        this.isSpeaking = false;
        this.hideVisemes();
    }

    // =============================================
    // Viseme System
    // =============================================
    showViseme(visemeName) {
        if (!visemeName || visemeName === "rest") {
            this.hideVisemes();
            return;
        }

        if (this.currentViseme === visemeName) return;

        this.currentViseme = visemeName;

        // Load and show viseme
        const img = new Image();
        img.onload = () => {
            if (this.currentViseme === visemeName) {
                this.viseme.src = `assets/visemes/${visemeName}.png`;
                this.viseme.style.opacity = 1;
            }
        };
        img.onerror = () => {
            console.warn(`Failed to load viseme: ${visemeName}`);
            this.viseme.style.opacity = 0;
        };
        img.src = `assets/visemes/${visemeName}.png`;
    }

    hideVisemes() {
        this.currentViseme = null;
        this.viseme.style.opacity = 0;
    }

    // =============================================
    // Update Loop
    // =============================================
    update() {
        // ✅ Apply head and eye movements
        const transform = `
            translate(${this.eyeJitter.x + this.idleOffset.x}px, ${this.eyeJitter.y + this.idleOffset.y}px)
            rotate(${this.headTilt}deg)
        `;

        this.base.style.transform = transform;
        this.emotion.style.transform = transform;
        this.viseme.style.transform = transform;
        this.blink.style.transform = transform;

        // ✅ Continue animation loop
        requestAnimationFrame(() => this.update());
    }
}

window.FaceRig = FaceRig;