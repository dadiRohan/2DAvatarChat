let ws = null;

const connectBtn = document.getElementById("connect-btn");
const disconnectBtn = document.getElementById("disconnect-btn");
const sendBtn = document.getElementById("send-text-btn");
const textInput = document.getElementById("text-input");
const statusSpan = document.getElementById("connection-status");
const debugLog = document.getElementById("debug-log");
const botVideoContainer = document.getElementById("bot-video-container");
const botAudio = document.getElementById("bot-audio");

let sprites = [];
let quietFrame = null;
let animationTimer = null;
let animIndex = 0;

// ------------------------
// Animation helpers
// ------------------------

function startAnimation() {
    if (!sprites.length) return;

    stopAnimation(); // clear old timers
    animIndex = 0;

    animationTimer = setInterval(() => {
        const frame = sprites[animIndex];
        if (frame && frame.image) {
            const img = document.createElement("img");
            img.src = "data:image/png;base64," + frame.image;
            botVideoContainer.innerHTML = "";
            botVideoContainer.appendChild(img);
        }
        animIndex = (animIndex + 1) % sprites.length;
    }, 55);
}

function stopAnimation() {
    if (animationTimer) clearInterval(animationTimer);
    animationTimer = null;

    if (quietFrame?.image) {
        const img = document.createElement("img");
        img.src = "data:image/png;base64," + quietFrame.image;
        botVideoContainer.innerHTML = "";
        botVideoContainer.appendChild(img);
    }
}

// ------------------------
// Connect WebSocket
// ------------------------
connectBtn.addEventListener("click", async () => {
    await fetch("http://localhost:7860/start", { method: "POST" });

    ws = new WebSocket("ws://localhost:7860/ws");

    ws.onopen = () => {
        statusSpan.textContent = "Connected";
        connectBtn.disabled = true;
        disconnectBtn.disabled = false;
        sendBtn.disabled = false;
    };

    ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);

        if (msg.type === "sprites") {
            sprites = msg.data;
        } else if (msg.type === "quiet_frame") {
            quietFrame = msg.data;

            const img = document.createElement("img");
            img.src = "data:image/png;base64," + quietFrame.image;
            botVideoContainer.innerHTML = "";
            botVideoContainer.appendChild(img);
        }

        else if (msg.type === "audio") {
            botAudio.src = "data:audio/wav;base64," + msg.base64;

            botAudio.onplay = () => startAnimation();
            botAudio.onended = () => stopAnimation();
            botAudio.onpause = () => stopAnimation();

            botAudio.play().catch(() => startAnimation());
        }

        else if (msg.type === "bot_text") {
            const entry = document.createElement("div");
            entry.style.color = "#4CAF50";
            entry.textContent = `Bot: ${msg.text}`;
            debugLog.appendChild(entry);
            debugLog.scrollTop = debugLog.scrollHeight;
        }
    };

    ws.onclose = () => {
        statusSpan.textContent = "Disconnected";
        connectBtn.disabled = false;
        disconnectBtn.disabled = true;
        sendBtn.disabled = true;
        stopAnimation();
    };
});

// ------------------------
// Disconnect
// ------------------------
disconnectBtn.addEventListener("click", () => {
    if (ws) ws.close();
});

// ------------------------
// Send message
// ------------------------
sendBtn.addEventListener("click", () => {
    const text = textInput.value.trim();
    if (!text || !ws || ws.readyState !== WebSocket.OPEN) return;

    ws.send(JSON.stringify({ type: "user_message", text }));

    const entry = document.createElement("div");
    entry.style.color = "#2196F3";
    entry.textContent = `You: ${text}`;
    debugLog.appendChild(entry);
    debugLog.scrollTop = debugLog.scrollHeight;

    textInput.value = "";
});

textInput.addEventListener("keypress", (e) => {
    if (e.key === "Enter") sendBtn.click();
});
