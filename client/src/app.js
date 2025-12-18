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
let currentTimeline = [];
let audioStartTime = 0;
let audioPlaybackId = 0;
let audioDuration = 0;
let syncCorrection = 0;

// ----------------------------
// VISEME CONSTANTS
// ----------------------------
const VISEME_FADE_SPEED = 0.15;
const VISEME_PRELOAD_MS = 50;
const REST_VISEME = "rest";
const SYNC_CHECK_INTERVAL = 500;

// Preload viseme images
const visemeCache = {};
let currentEmotion = "neutral";

// ----------------------------
// LOG
// ----------------------------
function log(msg) {
  const timestamp = new Date().toLocaleTimeString();
  logBox.innerHTML += `[${timestamp}] ${msg}<br>`;
  logBox.scrollTop = logBox.scrollHeight;
}

// ----------------------------
// PRELOAD IMAGES
// ----------------------------
function preloadImages() {
  const visemes = ['A', 'B', 'C', 'D', 'E', 'FV', 'L', 'M', 'O'];
  visemes.forEach(viseme => {
    const img = new Image();
    img.src = `assets/visemes/${viseme}.png`;
    visemeCache[viseme] = img;
  });
}

preloadImages();

// ----------------------------
// SEND MESSAGE
// ----------------------------
function sendMessage() {
  const txt = document.getElementById("text").value.trim();
  if (!txt) return;

  // fetch("http://localhost:3000/chat", {
  fetch("https://twodavatarchat-xe6t.onrender.com/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: txt })
  });

  log(`<span style='color:#4af'>You:</span> ${txt}`);
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
  } else if (packet.type === "info") {
    log(`<span style='color:#aaa'>System:</span> ${packet.msg}`);
  }
};

// ----------------------------
// MAIN BOT RESPONSE HANDLER
// ----------------------------
function handleResponse(packet) {
  log(`<span style='color:#4f4'><b>Bot [${packet.emotion}]:</b></span> ${packet.reply}`);

  // ✅ Stop any previous playback
  stopAllPlayback();

  // Generate unique ID for this playback
  const playbackId = Date.now();
  audioPlaybackId = playbackId;
  audioDuration = packet.duration || 1.0;
  currentEmotion = packet.emotion || "neutral";

  // ✅ Set emotion
  faceRig.setEmotion(currentEmotion);

  // ✅ Set audio if available
  if (packet.audio) {
    setupAudioPlayback(packet, playbackId);
  } else {
    // If no audio, simulate with timeline
    if (packet.visemes && packet.visemes.length > 0) {
      currentTimeline = packet.visemes;
      simulateVisemes(currentTimeline, playbackId);
    }
  }

  // ✅ Start lip-sync with timeline
  if (packet.visemes && packet.visemes.length > 0) {
    currentTimeline = packet.visemes;
    log(`Lip-sync ready: ${currentTimeline.length} viseme frames`);
  }
}

// ----------------------------
// AUDIO PLAYBACK SETUP - COMPLETE FIX
// ----------------------------
function setupAudioPlayback(packet, playbackId) {
  // Clear any existing event listeners first
  audioPlayer.onplay = null;
  audioPlayer.onpause = null;
  audioPlayer.ontimeupdate = null;
  audioPlayer.onended = null;
  audioPlayer.onerror = null;

  // Create audio URL from base64
  const audioBlob = base64ToBlob(packet.audio, 'audio/wav');
  const audioUrl = URL.createObjectURL(audioBlob);

  // Reset audio element
  audioPlayer.src = audioUrl;
  audioPlayer.currentTime = 0;

  // Set up new event listeners
  audioPlayer.onplay = () => {
    if (audioPlaybackId !== playbackId) return;

    isPlaying = true;
    audioStartTime = Date.now();
    faceRig.startSpeaking();

    // Add speaking class to avatar
    document.getElementById('avatar').classList.add('speaking');

    // Start viseme animation
    if (currentTimeline.length > 0) {
      playVisemesSync(currentTimeline, playbackId);
    }

    log("Audio started playing");
  };

  audioPlayer.onpause = () => {
    if (audioPlaybackId !== playbackId) return;
    log("Audio paused");
  };

  audioPlayer.ontimeupdate = () => {
    if (!isPlaying || audioPlaybackId !== playbackId) return;
    // Keep track of audio time for sync
  };

  audioPlayer.onended = () => {
    if (audioPlaybackId !== playbackId) return;

    log("Audio playback ended");
    cleanupPlayback(playbackId);
    URL.revokeObjectURL(audioUrl);
  };

  audioPlayer.onerror = (e) => {
    log(`<span style='color:#f44'>Audio error:</span> ${e.message}`);
    if (audioPlaybackId === playbackId) {
      cleanupPlayback(playbackId);
    }
    URL.revokeObjectURL(audioUrl);
  };

  // Start playback with a small delay
  setTimeout(() => {
    if (audioPlaybackId === playbackId) {
      audioPlayer.play().catch(err => {
        log(`<span style='color:#f44'>Playback failed:</span> ${err.message}`);
        cleanupPlayback(playbackId);
        URL.revokeObjectURL(audioUrl);
      });
    }
  }, 100);
}

// ----------------------------
// FIXED VISEME PLAYBACK ENGINE - ALWAYS SYNCED TO AUDIO
// ----------------------------
function playVisemesSync(timeline, playbackId) {
  if (!timeline || timeline.length === 0) {
    log("No viseme timeline available");
    return;
  }

  stopVisemeTrack();

  // Sort timeline by start time
  const sortedTimeline = [...timeline].sort((a, b) => a.start - b.start);
  let lastViseme = null;
  let lastVisemeChange = 0;
  let syncCheckCounter = 0;

  function visemeLoop() {
    if (audioPlaybackId !== playbackId || !isPlaying) {
      faceRig.hideVisemes();
      return;
    }

    // Get current audio time
    const audioTime = audioPlayer.currentTime || 0;

    // Throttle updates to ~30fps
    const now = Date.now();
    if (now - lastVisemeChange < 33) {
      if (!audioPlayer.ended && isPlaying) {
        activeVisemeTrack = requestAnimationFrame(visemeLoop);
      } else {
        faceRig.hideVisemes();
      }
      return;
    }

    lastVisemeChange = now;

    // Find current viseme using linear search (simpler and reliable)
    let currentViseme = null;

    for (let i = 0; i < sortedTimeline.length; i++) {
      const viseme = sortedTimeline[i];
      if (audioTime >= viseme.start && audioTime < viseme.end) {
        currentViseme = viseme.viseme;
        break;
      }
    }

    // If no viseme found but audio is still playing
    if (!currentViseme && audioTime < audioDuration) {
      // Find the closest upcoming viseme
      for (let i = 0; i < sortedTimeline.length; i++) {
        if (sortedTimeline[i].start > audioTime) {
          // Show rest or keep last
          currentViseme = "rest";
          break;
        }
      }
      // If past all visemes but audio still playing, keep last viseme
      if (!currentViseme && sortedTimeline.length > 0) {
        currentViseme = sortedTimeline[sortedTimeline.length - 1].viseme;
      }
    }

    // Update viseme if changed
    if (currentViseme !== lastViseme) {
      if (currentViseme === "rest" || !currentViseme) {
        faceRig.hideVisemes();
      } else {
        faceRig.showViseme(currentViseme);
      }
      lastViseme = currentViseme;
    }

    // Continue if audio is still playing
    if (!audioPlayer.ended && audioPlayer.currentTime < audioDuration * 0.99) {
      activeVisemeTrack = requestAnimationFrame(visemeLoop);
    } else {
      // Audio is ending or has ended
      faceRig.hideVisemes();
    }
  }

  // Start the loop
  activeVisemeTrack = requestAnimationFrame(visemeLoop);
}

// ----------------------------
// SIMULATE VISEMES (for text-only responses)
// ----------------------------
function simulateVisemes(timeline, playbackId) {
  if (!timeline || timeline.length === 0) return;

  stopVisemeTrack();

  const sortedTimeline = [...timeline].sort((a, b) => a.start - b.start);
  const startTime = Date.now();
  isPlaying = true;
  faceRig.startSpeaking();

  let lastViseme = null;
  let lastUpdate = 0;

  function simulationLoop() {
    if (audioPlaybackId !== playbackId || !isPlaying) {
      faceRig.hideVisemes();
      return;
    }

    const elapsed = (Date.now() - startTime) / 1000;

    // Throttle updates to 30fps
    const now = Date.now();
    if (now - lastUpdate < 33) {
      if (isPlaying) {
        activeVisemeTrack = requestAnimationFrame(simulationLoop);
      }
      return;
    }
    lastUpdate = now;

    // Find current viseme
    let currentViseme = null;

    for (const viseme of sortedTimeline) {
      if (elapsed >= viseme.start && elapsed < viseme.end) {
        currentViseme = viseme.viseme;
        break;
      }
    }

    // Update if changed
    if (currentViseme !== lastViseme) {
      if (currentViseme) {
        faceRig.showViseme(currentViseme);
      } else {
        faceRig.hideVisemes();
      }
      lastViseme = currentViseme;
    }

    // Continue until timeline ends
    if (elapsed < sortedTimeline[sortedTimeline.length - 1].end) {
      activeVisemeTrack = requestAnimationFrame(simulationLoop);
    } else {
      // Timeline ended
      setTimeout(() => {
        if (audioPlaybackId === playbackId) {
          faceRig.hideVisemes();
          faceRig.stopSpeaking();
          isPlaying = false;
          log("Simulated lip-sync complete");
        }
      }, 100);
    }
  }

  activeVisemeTrack = requestAnimationFrame(simulationLoop);
}

// ----------------------------
// UTILITY FUNCTIONS
// ----------------------------
function base64ToBlob(base64, mimeType) {
  try {
    const byteCharacters = atob(base64);
    const byteNumbers = new Array(byteCharacters.length);

    for (let i = 0; i < byteCharacters.length; i++) {
      byteNumbers[i] = byteCharacters.charCodeAt(i);
    }

    const byteArray = new Uint8Array(byteNumbers);
    return new Blob([byteArray], { type: mimeType });
  } catch (e) {
    console.error("Failed to convert base64 to blob:", e);
    return null;
  }
}

function cleanupPlayback(playbackId) {
  if (audioPlaybackId !== playbackId) return;

  isPlaying = false;
  faceRig.stopSpeaking();
  stopVisemeTrack();
  currentTimeline = [];

  // Remove speaking class
  document.getElementById('avatar').classList.remove('speaking');

  // Restore full emotion after speech ends
  setTimeout(() => {
    if (audioPlaybackId === playbackId && !isPlaying) {
      faceRig.setEmotion(currentEmotion);
    }
  }, 100);
}

// ----------------------------
// SAFE STOP FUNCTIONS
// ----------------------------
function stopAllPlayback() {
  stopVisemeTrack();
  faceRig.stopSpeaking();
  isPlaying = false;
  audioPlaybackId++;

  if (!audioPlayer.paused) {
    audioPlayer.pause();
    audioPlayer.currentTime = 0;
  }

  currentTimeline = [];

  // Remove speaking class
  document.getElementById('avatar').classList.remove('speaking');
}

function stopVisemeTrack() {
  if (activeVisemeTrack) {
    cancelAnimationFrame(activeVisemeTrack);
    activeVisemeTrack = null;
  }
}

// ----------------------------
// KEYBOARD SHORTCUTS
// ----------------------------
document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }

  if (e.key === 'Escape') {
    stopAllPlayback();
    log("Playback stopped by user");
  }
});

// Handle page visibility changes
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    // Reduce animation when tab is hidden
    if (activeVisemeTrack) {
      cancelAnimationFrame(activeVisemeTrack);
    }
  } else {
    // Restart animation when tab becomes visible
    if (isPlaying && audioPlaybackId && currentTimeline.length > 0) {
      playVisemesSync(currentTimeline, audioPlaybackId);
    }
  }
});

// Handle audio element errors
audioPlayer.addEventListener('error', (e) => {
  const error = audioPlayer.error;
  let message = "Unknown audio error";

  switch (error.code) {
    case MediaError.MEDIA_ERR_ABORTED:
      message = "Playback aborted";
      break;
    case MediaError.MEDIA_ERR_NETWORK:
      message = "Network error";
      break;
    case MediaError.MEDIA_ERR_DECODE:
      message = "Audio decoding error";
      break;
    case MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED:
      message = "Audio format not supported";
      break;
  }

  log(`<span style='color:#f44'>Audio error:</span> ${message}`);
  stopAllPlayback();
});