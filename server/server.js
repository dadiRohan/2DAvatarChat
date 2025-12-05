/**
 * Enhanced server.js with better viseme timing and synchronization
 */
import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import FormData from "form-data";
import fs from "fs";
import path from "path";
import { WebSocketServer } from "ws";
import say from "say";
import wavFileInfo from "wav-file-info";
import { promisify } from "util";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static("."));

const readWavInfo = promisify(wavFileInfo.infoByFilename);

// Config
const HTTP_PORT = process.env.HTTP_PORT ? Number(process.env.HTTP_PORT) : 3000;
const WS_PORT = process.env.WS_PORT ? Number(process.env.WS_PORT) : 8080;
const OLLAMA_URL = process.env.OLLAMA_URL || "http://localhost:11434/v1/chat/completions";
const GENTLE_URL = process.env.GENTLE_URL || "http://localhost:8765/transcriptions?async=false";

// Enhanced Phoneme -> Viseme mapping
const PHONEME_TO_VISEME = {
  // SILENCE/REST
  "SIL": "rest", "SPN": "rest", "CLOSURE": "rest",

  // Vowels - Open mouth
  "AA": "A", "AE": "A", "AH": "A", "AO": "O", "AW": "O",
  "AY": "A", "EH": "E", "ER": "A", "EY": "E",

  // Front vowels/smile
  "IY": "E", "IH": "E", "Y": "E",

  // Back vowels - Round
  "OW": "O", "UH": "O", "UW": "O",

  // Bilabials - Closed lips
  "B": "M", "P": "M", "M": "M", "EM": "M",

  // Labiodental
  "F": "FV", "V": "FV",

  // L sounds
  "L": "L", "EL": "L",

  // Sibilants
  "S": "E", "Z": "E", "SH": "E", "ZH": "E",

  // Affricates
  "CH": "E", "JH": "E",

  // Dental
  "TH": "E", "DH": "E",

  // Nasals
  "N": "M", "NG": "M", "EN": "M",

  // Plosives
  "T": "M", "D": "M", "K": "A", "G": "A",

  // Approximants
  "R": "O", "W": "O", "WH": "O",

  // Default
  "DEFAULT": "A"
};

// Enhanced text cleaning for better phoneme alignment
function cleanTextForTTS(text) {
  return text
    .replace(/[^\w\s.,!?;:'"-]/g, '') // Remove special characters
    .replace(/\s+/g, ' ')            // Normalize whitespace
    .trim();
}

// Enhanced forced aligner with better error handling
async function runForcedAligner(wavFilePath, transcript) {
  try {
    if (!fs.existsSync(wavFilePath)) {
      console.warn("runForcedAligner: wav file missing:", wavFilePath);
      return null;
    }

    const form = new FormData();
    form.append("audio", fs.createReadStream(wavFilePath));
    form.append("transcript", transcript);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000); // 10 second timeout

    const res = await fetch(GENTLE_URL, {
      method: "POST",
      body: form,
      headers: form.getHeaders(),
      signal: controller.signal
    });

    clearTimeout(timeout);

    if (!res.ok) {
      console.warn("Gentle HTTP error:", res.status, await res.text());
      return null;
    }

    const json = await res.json();

    const phones = [];
    if (json && Array.isArray(json.words)) {
      let currentTime = 0;

      for (const w of json.words) {
        if (w.case === "not-found-in-audio" || !w.alignedWord) {
          // Add default phoneme for non-aligned words
          const defaultPhone = {
            phoneme: "SIL",
            start: currentTime,
            end: currentTime + 0.1,
            confidence: 0
          };
          phones.push(defaultPhone);
          currentTime += 0.1;
          continue;
        }

        if (Array.isArray(w.phones)) {
          for (const p of w.phones) {
            if (!p.phone) continue;

            let phone = String(p.phone).replace(/\d/g, "").toUpperCase();
            const start = (typeof p.start === "number") ? p.start :
              (typeof w.start === "number" ? w.start : currentTime);
            const dur = (typeof p.duration === "number") ? p.duration : 0.05;
            const end = start + dur;
            const confidence = p.score || 1.0;

            phones.push({
              phoneme: phone,
              start: Number(start.toFixed(3)),
              end: Number(end.toFixed(3)),
              confidence: confidence
            });

            currentTime = end;
          }
        } else {
          // Fallback for words without phone breakdown
          const start = w.start || currentTime;
          const end = w.end || start + 0.1;
          const wordPhoneme = w.word ? guessPhonemeFromWord(w.word) : "SIL";

          phones.push({
            phoneme: wordPhoneme,
            start: Number(start.toFixed(3)),
            end: Number(end.toFixed(3)),
            confidence: 0.5
          });

          currentTime = end;
        }
      }
    }

    return phones.length > 0 ? phones : null;
  } catch (err) {
    console.error("runForcedAligner exception:", err);
    return null;
  }
}

function guessPhonemeFromWord(word) {
  const firstChar = word.charAt(0).toUpperCase();
  if ("AEIOU".includes(firstChar)) return "AA";
  if ("BPM".includes(firstChar)) return "M";
  if ("FVCK".includes(firstChar)) return "FV";
  if ("SZ".includes(firstChar)) return "S";
  if ("L".includes(firstChar)) return "L";
  return "AA";
}

// Enhanced phoneme smoothing and merging
function smoothPhonemeTimeline(phones, mergeThreshold = 0.03) {
  if (!phones || phones.length === 0) return phones;

  const smoothed = [];
  let current = { ...phones[0] };

  for (let i = 1; i < phones.length; i++) {
    const next = phones[i];

    // Merge if same phoneme and close together
    if (current.phoneme === next.phoneme &&
      (next.start - current.end) < mergeThreshold) {
      current.end = next.end;
      current.confidence = Math.max(current.confidence || 0.5, next.confidence || 0.5);
    } else {
      smoothed.push(current);
      current = { ...next };
    }
  }

  smoothed.push(current);
  return smoothed;
}

// Enhanced phoneme to viseme conversion
function phonemesToVisemesEnhanced(phones) {
  const visemes = [];

  // Add initial rest state
  if (phones.length > 0 && phones[0].start > 0) {
    visemes.push({
      viseme: "rest",
      start: 0,
      end: phones[0].start,
      confidence: 1.0
    });
  }

  for (let i = 0; i < phones.length; i++) {
    const phone = phones[i];
    const viseme = PHONEME_TO_VISEME[phone.phoneme] || PHONEME_TO_VISEME["DEFAULT"];

    // Determine if this should be a hold or transition
    const duration = phone.end - phone.start;
    const confidence = phone.confidence || 0.5;

    // For very short phonemes, combine with neighbors
    if (duration < 0.05 && i > 0 && i < phones.length - 1) {
      const prevViseme = PHONEME_TO_VISEME[phones[i - 1].phoneme] || "A";
      const nextViseme = PHONEME_TO_VISEME[phones[i + 1].phoneme] || "A";

      // Skip if sandwiched between same visemes
      if (prevViseme === nextViseme) {
        continue;
      }
    }

    visemes.push({
      viseme: viseme,
      start: phone.start,
      end: phone.end,
      confidence: confidence
    });
  }

  // Add final rest state
  if (visemes.length > 0) {
    const lastViseme = visemes[visemes.length - 1];
    if (lastViseme.end < phones[phones.length - 1].end) {
      visemes.push({
        viseme: "rest",
        start: lastViseme.end,
        end: phones[phones.length - 1].end,
        confidence: 1.0
      });
    }
  }

  return visemes;
}

// Generate fallback viseme timeline with better timing
function generateFallbackVisemes(text, duration) {
  const words = text.toLowerCase().split(/\s+/);
  const visemeSequence = [];
  let timeCursor = 0;
  const wordDuration = duration / Math.max(words.length, 1);

  for (const word of words) {
    const wordStart = timeCursor;
    const wordEnd = timeCursor + wordDuration;

    // Generate visemes for each character in the word
    let charTime = wordStart;
    const charDuration = wordDuration / Math.max(word.length, 1);

    for (let i = 0; i < word.length; i++) {
      const char = word[i];
      const viseme = charToVisemeEnhanced(char);

      if (visemeSequence.length === 0 || visemeSequence[visemeSequence.length - 1].viseme !== viseme) {
        const visemeStart = charTime;
        const visemeEnd = Math.min(wordEnd, charTime + charDuration);

        visemeSequence.push({
          viseme: viseme,
          start: Number(visemeStart.toFixed(3)),
          end: Number(visemeEnd.toFixed(3))
        });
      }

      charTime += charDuration;
    }

    // Add pause between words
    if (word !== words[words.length - 1]) {
      visemeSequence.push({
        viseme: "rest",
        start: charTime,
        end: charTime + 0.05
      });
      timeCursor = charTime + 0.05;
    } else {
      timeCursor = wordEnd;
    }
  }

  // Ensure timeline matches total duration
  if (visemeSequence.length > 0) {
    visemeSequence[visemeSequence.length - 1].end = Number(duration.toFixed(3));
  }

  return visemeSequence;
}

function charToVisemeEnhanced(ch) {
  ch = (ch || "").toLowerCase();
  if ("aeiou".includes(ch)) return "A";
  if ("bp".includes(ch)) return "M";
  if ("m".includes(ch)) return "M";
  if ("fv".includes(ch)) return "FV";
  if ("l".includes(ch)) return "L";
  if ("sz".includes(ch)) return "E";
  if ("ckg".includes(ch)) return "A";
  if ("o".includes(ch)) return "O";
  if ("w".includes(ch)) return "O";
  if ("tdnr".includes(ch)) return "M";
  if ("h".includes(ch)) return "A";
  return "rest";
}

// Call Ollama (unchanged)
async function callOllama(userText) {
  const prompt = [
    { role: "system", content: "You are a concise chatbot. Return ONLY valid JSON with keys reply and emotion (emotion one of: neutral, happy, sad, angry, surprised)." },
    { role: "user", content: `User: ${userText}\nReturn: {"reply":"...","emotion":"..."} JSON only.` }
  ];

  try {
    const body = { model: "phi3:mini", messages: prompt };
    const res = await fetch(OLLAMA_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!res.ok) {
      console.error("Ollama error", res.status, await res.text());
      return { reply: "Sorry, I couldn't generate a response.", emotion: "neutral" };
    }
    const j = await res.json();

    let text = "";
    if (j.completion) text = j.completion;
    else if (j.choices?.[0]?.message?.content) text = j.choices[0].message.content;
    else text = JSON.stringify(j);

    let cleaned = text.replace(/```json/g, "").replace(/```/g, "").trim();

    try {
      const parsed = JSON.parse(cleaned);
      return { reply: (parsed.reply || cleaned), emotion: (parsed.emotion || "neutral") };
    } catch (e) {
      return { reply: cleaned, emotion: "neutral" };
    }
  } catch (err) {
    console.error("callOllama error:", err);
    return { reply: "Sorry, I couldn't generate a response.", emotion: "neutral" };
  }
}

// TTS via say.export
async function ttsToWavBase64(text) {
  const cleanedText = cleanTextForTTS(text);
  const tmpPath = path.join(".", `tmp_tts_${Date.now()}.wav`);

  return new Promise((resolve, reject) => {
    say.export(cleanedText, null, 1.0, tmpPath, async (err) => {
      if (err) return reject(err);
      try {
        const buf = fs.readFileSync(tmpPath);
        fs.unlinkSync(tmpPath);
        resolve(buf.toString("base64"));
      } catch (e) {
        reject(e);
      }
    });
  });
}

// Get audio duration
async function getAudioDuration(wavBase64) {
  try {
    const probeFile = path.join(".", `tmp_probe_${Date.now()}.wav`);
    fs.writeFileSync(probeFile, Buffer.from(wavBase64, "base64"));
    const info = await readWavInfo(probeFile);
    fs.unlinkSync(probeFile);

    if (info && info.header && info.data && info.data.dataChunkSize) {
      const sampleRate = Number(info.header.sampleRate) || 22050;
      const bits = Number(info.header.bitsPerSample) || 16;
      const channels = Number(info.header.numChannels) || 1;
      const bytesPerSample = bits / 8 || 2;
      const totalSamples = info.data.dataChunkSize / (bytesPerSample * channels);
      return totalSamples / sampleRate;
    }
  } catch (err) {
    console.warn("Failed to get audio duration:", err);
  }
  return 1.0;
}

// HTTP /chat endpoint
app.post("/chat", async (req, res) => {
  const { text } = req.body;
  if (!text) return res.status(400).json({ error: "text required" });

  try {
    // 1) Generate model reply + emotion
    const parsed = await callOllama(text);
    let reply = (parsed.reply || "").toString();
    const emotion = parsed.emotion || "neutral";

    // 2) Produce TTS WAV
    let audioBase64 = null;
    try {
      audioBase64 = await ttsToWavBase64(reply);
    } catch (err) {
      console.error("TTS generation failed:", err);
      audioBase64 = null;
    }

    // 3) Get audio duration
    let durationSeconds = 1.0;
    if (audioBase64) {
      durationSeconds = await getAudioDuration(audioBase64);
    }

    // 4) Attempt forced alignment
    let visemeTimeline = [];
    let alignmentSource = "fallback";

    if (audioBase64) {
      const alignTmp = path.join(".", `tmp_align_${Date.now()}.wav`);
      try {
        fs.writeFileSync(alignTmp, Buffer.from(audioBase64, "base64"));

        const phones = await runForcedAligner(alignTmp, reply);

        if (phones && phones.length) {
          const smoothedPhones = smoothPhonemeTimeline(phones);
          visemeTimeline = phonemesToVisemesEnhanced(smoothedPhones);
          alignmentSource = "gentle";
          console.log(`Gentle alignment successful: ${visemeTimeline.length} visemes`);
        } else {
          visemeTimeline = generateFallbackVisemes(reply, durationSeconds);
          console.warn("Gentle failed -> used enhanced fallback viseme timeline");
        }
      } catch (err) {
        console.error("Aligner pipeline error:", err);
        visemeTimeline = generateFallbackVisemes(reply, durationSeconds);
      } finally {
        try { fs.unlinkSync(alignTmp); } catch (e) { }
      }
    } else {
      visemeTimeline = generateFallbackVisemes(reply, durationSeconds);
    }

    // 5) Ensure timeline has at least one entry
    if (visemeTimeline.length === 0) {
      visemeTimeline = [{
        viseme: "rest",
        start: 0,
        end: Math.max(durationSeconds, 0.1)
      }];
    }

    // 6) Add metadata
    const responsePayload = {
      status: "ok",
      reply,
      emotion,
      visemes: visemeTimeline,
      audio: audioBase64,
      duration: durationSeconds,
      alignmentSource: alignmentSource,
      timestamp: Date.now()
    };

    res.json(responsePayload);

    // 7) Broadcast via WebSocket
    const wsPayload = {
      type: "tts",
      ...responsePayload,
      audio: audioBase64 // Keep audio in WS for real-time playback
    };
    broadcastWS(JSON.stringify(wsPayload));

  } catch (err) {
    console.error("Chat endpoint error:", err);
    res.status(500).json({ status: "error", error: String(err) });
  }
});

// WebSocket server
const wss = new WebSocketServer({ port: WS_PORT });

function broadcastWS(msg) {
  wss.clients.forEach((c) => {
    if (c.readyState === 1) c.send(msg);
  });
}

wss.on("connection", (ws) => {
  console.log("WS client connected");
  ws.send(JSON.stringify({
    type: "info",
    msg: "connected",
    timestamp: Date.now()
  }));
});

// Start HTTP server
app.listen(HTTP_PORT, () => {
  console.log(`HTTP server running at http://localhost:${HTTP_PORT}`);
  console.log(`WebSocket server running at ws://localhost:${WS_PORT}`);
  console.log(`Gentle aligner URL: ${GENTLE_URL}`);
});