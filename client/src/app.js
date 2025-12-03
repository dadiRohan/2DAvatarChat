let ws = new WebSocket("ws://localhost:8080");

const baseImg = document.getElementById("base");
const emotionImg = document.getElementById("emotion");
const blinkImg = document.getElementById("blink");
const visemeImg = document.getElementById("viseme");  // FIXED
const audioPlayer = document.getElementById("audioPlayer");
const logBox = document.getElementById("log");

document.getElementById("send").onclick = sendMessage;

function log(msg) {
  logBox.innerHTML += msg + "<br>";
  logBox.scrollTop = logBox.scrollHeight;
}

// ----------------------------
// BLINK LOOP
// ----------------------------
function startBlinkLoop() {
  setInterval(() => {
    blinkImg.style.opacity = 1;
    setTimeout(() => (blinkImg.style.opacity = 0), 120);
  }, 2500 + Math.random() * 1500);
}
startBlinkLoop();

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
  try { packet = JSON.parse(ev.data); }
  catch { return; }

  if (packet.type === "tts") {
    handleResponse(packet);
  }
};

function handleResponse(packet) {
  log("<span style='color:#4f4'><b>Bot:</b></span> " + packet.reply);

  emotionImg.src = "assets/emotions/" + packet.emotion + ".png";
  emotionImg.style.opacity = 1;

  if (packet.audio) {
    audioPlayer.src = "data:audio/wav;base64," + packet.audio;
    audioPlayer.play();
  }

  playVisemes(packet.visemes);
}

// ----------------------------
// HIGH-QUALITY VISEME ANIMATION
// ----------------------------
function playVisemes(data) {
  if (!data || data.length === 0) return;

  visemeImg.style.opacity = 1;

  const startTime = performance.now();
  const total = data[data.length - 1].end;

  function loop() {
    const t = (performance.now() - startTime) / 1000;

    let active = null;
    for (const v of data) {
      if (t >= v.start && t < v.end) {
        active = v.viseme;
        break;
      }
    }

    if (active) {
      visemeImg.src = "assets/visemes/" + active + ".png";
      visemeImg.style.opacity = 1;
    } else {
      visemeImg.style.opacity = 0;
    }

    if (!audioPlayer.paused) {
      requestAnimationFrame(loop);
    } else {
      visemeImg.style.opacity = 0;
    }
  }

  requestAnimationFrame(loop);
}
