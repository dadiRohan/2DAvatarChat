// ========================================================
// WebSocket
// ========================================================
let ws = new WebSocket("ws://localhost:8080");

// ========================================================
// DOM Elements
// ========================================================
const emotionImg = document.getElementById("emotion");
const visemeImg = document.getElementById("viseme");
const blinkImg = document.getElementById("blink");
const audioPlayer = document.getElementById("audioPlayer");
const logBox = document.getElementById("log");

// ========================================================
// Log Messages
// ========================================================
function log(msg) {
    logBox.innerHTML += msg + "<br>";
    logBox.scrollTop = logBox.scrollHeight;
}

// ========================================================
// Blink Loop
// ========================================================
function startBlinkLoop() {
    setInterval(() => {
        blinkImg.style.opacity = 1;
        setTimeout(() => {
            blinkImg.style.opacity = 0;
        }, 120);
    }, 3500 + Math.random() * 1200);
}
startBlinkLoop();

// ========================================================
// SEND MESSAGE → backend
// ========================================================
document.getElementById("send").onclick = sendMessage;

function sendMessage() {
    const txt = document.getElementById("text").value.trim();
    if (!txt) return;

    fetch("http://localhost:3000/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: txt })
    });

    log(`<span style='color:#4af'>You:</span> ${txt}`);
    document.getElementById("text").value = "";
}

// ========================================================
// WEBSOCKET LISTENER
// ========================================================
ws.onmessage = (ev) => {
    let packet;

    try {
        packet = JSON.parse(ev.data);
    } catch (e) {
        console.error("Invalid JSON:", ev.data);
        return;
    }

    if (packet.type === "tts") {
        handleResponse(packet);
    }
};

// ========================================================
// HANDLE BACKEND PACKET
// ========================================================
function cleanModelReply(raw) {
    return raw.replace(/```json/g, "").replace(/```/g, "").trim();
}

function decodeReply(rawReply) {
    const clean = cleanModelReply(rawReply);

    try {
        const parsed = JSON.parse(clean);
        return parsed.reply || clean;
    } catch {
        return clean;
    }
}

function handleResponse(packet) {
    const rawReply = packet.reply || "";
    const replyText = decodeReply(rawReply);

    log(`<span style='color:#4f4'><b>Bot:</b></span> ${replyText}`);

    // Emotion image
    const emotion = packet.emotion || "neutral";
    emotionImg.src = `assets/emotions/${emotion}.png`;
    emotionImg.style.opacity = 1;

    const visemeTimeline = packet.visemes || [];

    // AUDIO + TRUE LIP-SYNC
    if (packet.audio) {
        audioPlayer.src = "data:audio/wav;base64," + packet.audio;

        audioPlayer.onplay = () => {
            playVisemesDuringAudio(visemeTimeline);
        };

        audioPlayer.onended = () => {
            visemeImg.style.opacity = 0;
        };

        audioPlayer.play();
    }
}

// ========================================================
// REAL LIP-SYNC LOOP — runs until audio ends
// ========================================================
function playVisemesDuringAudio(visemes) {
    visemeImg.style.opacity = 0;

    let running = true;

    audioPlayer.onended = () => {
        running = false;
        visemeImg.style.opacity = 0;
    };

    const start = performance.now();

    function loop() {
        if (!running) return;

        const t = (performance.now() - start) / 1000;

        let active = null;
        for (let v of visemes) {
            if (t >= v.start && t < v.end) {
                active = v.viseme;
                break;
            }
        }

        if (active) {
            visemeImg.src = `assets/visemes/${active}.png`;
            visemeImg.style.opacity = 1;
        } else {
            visemeImg.style.opacity = 0;
        }

        requestAnimationFrame(loop);
    }

    requestAnimationFrame(loop);
}
