let ws = new WebSocket("ws://localhost:8080");

const baseImg = document.getElementById("base");
const emotionImg = document.getElementById("emotion");
const blinkImg = document.getElementById("blink");
const visemeImg = document.getElementById("viseme");
const audioPlayer = document.getElementById("audioPlayer");
const logBox = document.getElementById("log");

// ✅ FaceRig instance
const faceRig = new FaceRig();

document.getElementById("send").onclick = sendMessage;

let activeVisemeTrack = null;
let isPlaying = false;

// ----------------------------
// LOG
// ----------------------------
function log(msg) {
    logBox.innerHTML += msg + "<br>";
    logBox.scrollTop = logBox.scrollHeight;
}

// ----------------------------
// SEND MESSAGE
// ----------------------------
function sendMessage() {
    const txt = document.getElementById("text").value.trim();
    if (!txt) return;

    fetch("http://localhost:3000/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: txt })
    });

    log("<span style='color:#4af'>You:</span> " + txt);
    document.getElementById("text").value = "";
}

// ----------------------------
// WEB SOCKET HANDLER
// ----------------------------
ws.onmessage = (ev) => {
    let packet;
    try {
        packet = JSON.parse(ev.data);
    } catch {
        return;
    }

    if (packet.type === "tts") {
        handleResponse(packet);
    }
};

// ----------------------------
// MAIN BOT RESPONSE HANDLER
// ----------------------------
function handleResponse(packet) {
    log("<span style='color:#4f4'><b>Bot:</b></span> " + packet.reply);

    // ✅ SET EMOTION
    faceRig.setEmotion(packet.emotion || "neutral");

    // ✅ STOP ANY PREVIOUS PLAYBACK CLEANLY
    stopAllPlayback();

    // ✅ SET AUDIO
    if (packet.audio) {
        audioPlayer.src = "data:audio/wav;base64," + packet.audio;

        audioPlayer.onplay = () => {
            isPlaying = true;
            faceRig.startSpeaking();
        };

        audioPlayer.onended = () => {
            isPlaying = false;
            faceRig.stopSpeaking();
            stopVisemeTrack();
        };

        audioPlayer.play();
    }

    // ✅ START PERFECT LIP-SYNC
    if (packet.visemes && packet.visemes.length > 0) {
        playVisemes(packet.visemes);
    }
}

// ----------------------------
// SAFE STOP EVERYTHING
// ----------------------------
function stopAllPlayback() {
    stopVisemeTrack();
    faceRig.stopSpeaking();

    if (!audioPlayer.paused) {
        audioPlayer.pause();
        audioPlayer.currentTime = 0;
    }
}

function stopVisemeTrack() {
    if (activeVisemeTrack) {
        cancelAnimationFrame(activeVisemeTrack);
        activeVisemeTrack = null;
    }
    faceRig.hideVisemes();
}

// ----------------------------
// ✅✅✅ TRUE AUDIO-LINKED VISEME ENGINE
// ----------------------------
function playVisemes(data) {
    if (!data || data.length === 0) return;

    const startTime = performance.now();
    const finalTime = data[data.length - 1].end;

    function loop() {
        if (!isPlaying) {
            faceRig.hideVisemes();
            return;
        }

        const t = audioPlayer.currentTime;

        let active = null;
        for (const v of data) {
            if (t >= v.start && t < v.end) {
                active = v.viseme;
                break;
            }
        }

        if (active) {
            faceRig.showViseme(active);
        }

        // ✅ CONTINUE UNTIL AUDIO **ACTUALLY ENDS**
        if (!audioPlayer.ended) {
            activeVisemeTrack = requestAnimationFrame(loop);
        } else {
            faceRig.hideVisemes();
        }
    }

    activeVisemeTrack = requestAnimationFrame(loop);
}
