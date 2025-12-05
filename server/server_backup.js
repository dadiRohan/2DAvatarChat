/**
 * Full patched server.js
 * - Uses Gentle forced-aligner to get phoneme timings from the TTS WAV
 * - Maps phonemes -> visemes and broadcasts accurate viseme timeline
 * - Falls back to heuristic timeline if aligner fails
 *
 * Requirements:
 * npm i express cors ws node-fetch form-data say wav-file-info dotenv
 *
 * Start Gentle (recommended via Docker):
 * docker run -d -p 8765:8765 lowerquality/gentle:latest
 *
 * Put your .env if you want to override endpoints:
 * GENTLE_URL, OLLAMA_URL
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

// ---------------------------
// Phoneme -> Viseme mapping
// ARPAbet-ish phonemes mapped to your viseme PNG names
// ---------------------------
const PHONEME_TO_VISEME = {
    // vowels
    "AA": "A", "AE": "A", "AH": "A", "AO": "O", "AW": "O", "AY": "A",
    // bilabials
    "B": "M", "P": "M", "M": "M",
    // labiodental
    "F": "FV", "V": "FV",
    // L
    "L": "L",
    // sibilants & affricates -> E-ish (smile)
    "S": "E", "Z": "E", "SH": "E", "CH": "E", "JH": "E", "ZH": "E",
    // front vowels
    "IY": "E", "IH": "E", "EY": "E",
    // back vowels
    "OW": "O", "UH": "O", "UW": "O",
    // th/dh
    "TH": "E", "DH": "E",
    // r/n/t/d/k/g etc -> map to neutral open/closed approximations
    "R": "O",
    "N": "M", "T": "M", "D": "M", "K": "A", "G": "A",
    // fallback
};

// ---------------------------
// Utilities: text -> heur viseme seq (fallback)
// ---------------------------

function charToPhonemePair(text, i) {
    const pair = text.slice(i, i + 2).toLowerCase();

    // --- DIGRAPHS FIRST (MOST IMPORTANT) ---
    if (pair === "th") return { ph: "TH", skip: 2 };
    if (pair === "sh") return { ph: "SH", skip: 2 };
    if (pair === "ch") return { ph: "CH", skip: 2 };
    if (pair === "ph") return { ph: "F", skip: 2 };
    if (pair === "oo") return { ph: "UW", skip: 2 };
    if (pair === "ee") return { ph: "IY", skip: 2 };
    if (pair === "ai") return { ph: "AY", skip: 2 };
    if (pair === "ou") return { ph: "OW", skip: 2 };

    // --- SINGLE CHARACTER FALLBACK ---
    const ch = (text[i] || "").toLowerCase();

    if ("a".includes(ch)) return { ph: "AA", skip: 1 };
    if ("e".includes(ch)) return { ph: "EH", skip: 1 };
    if ("i".includes(ch)) return { ph: "IY", skip: 1 };
    if ("o".includes(ch)) return { ph: "OW", skip: 1 };
    if ("u".includes(ch)) return { ph: "UH", skip: 1 };

    if ("pbm".includes(ch)) return { ph: "M", skip: 1 };
    if ("fv".includes(ch)) return { ph: "FV", skip: 1 };
    if ("l".includes(ch)) return { ph: "L", skip: 1 };

    if ("sz".includes(ch)) return { ph: "S", skip: 1 };
    if ("tdnrkg".includes(ch)) return { ph: "T", skip: 1 };

    return { ph: "AA", skip: 1 }; // neutral fallback
}

function charToViseme(ch) {
    ch = (ch || "").toLowerCase();
    if ("aeiou".includes(ch)) return "A";
    if ("bdpv".includes(ch)) return "M";
    if ("fvw".includes(ch)) return "FV";
    if ("l".includes(ch)) return "L";
    if ("szcjx".includes(ch)) return "E";
    if ("o".includes(ch)) return "O";
    return "A";
}

function charToPhoneme(ch) {
    ch = ch.toLowerCase();
    if ("a".includes(ch)) return "AA";
    if ("e".includes(ch)) return "EH";
    if ("i".includes(ch)) return "IY";
    if ("o".includes(ch)) return "OW";
    if ("u".includes(ch)) return "UH";

    if ("pbm".includes(ch)) return "M";
    if ("fv".includes(ch)) return "FV";
    if ("l".includes(ch)) return "L";

    if ("szcjx".includes(ch)) return "S";
    if ("tdnrkg".includes(ch)) return "T";

    return "AA"; // default vowelish neutral
}

function phonemeToViseme(ph) {
    // --- OPEN VOWELS ---
    if (["AA", "AE", "AH", "AY"].includes(ph)) return "A";

    // --- SMILE / FRONT VOWELS & SIBILANTS ---
    if (["EH", "EE", "IY", "IH", "S", "Z", "SH", "CH", "TH"].includes(ph)) return "E";

    // --- ROUND O VOWELS ---
    if (["OW", "OO", "UH", "UW"].includes(ph)) return "O";

    // --- CLOSED LIPS ---
    if (["M", "P", "B"].includes(ph)) return "M";

    // --- LIP TO TEETH ---
    if (["F", "V", "FV"].includes(ph)) return "FV";

    // --- TONGUE UP ---
    if (["L"].includes(ph)) return "L";

    return "A";
}


function textToVisemeSequence(text) {
    const seq = [];
    let i = 0;

    while (i < text.length) {
        const { ph, skip } = charToPhonemePair(text, i);
        const vis = phonemeToViseme(ph);

        if (seq.length === 0 || seq[seq.length - 1] !== vis) {
            seq.push(vis);
        }

        i += skip;
    }

    return seq;
}

function buildVisemeTimeline(visemes, duration) {
    if (visemes.length === 0) return [];

    // more natural lip movement distribution
    const timeline = [];
    const avg = duration / visemes.length;

    let cursor = 0;

    for (let i = 0; i < visemes.length; i++) {
        const hold = avg * (0.9 + Math.random() * 0.3);  // slight randomness
        const start = cursor;
        const end = Math.min(duration, cursor + hold);

        timeline.push({
            viseme: visemes[i],
            start: Number(start.toFixed(3)),
            end: Number(end.toFixed(3))
        });

        cursor = end;
    }

    // ensure last matches audio
    timeline[timeline.length - 1].end = Number(duration.toFixed(3));
    return timeline;
}


// ---------------------------
// Call Ollama (same as before) — returns parsed { reply, emotion }
// The function is tolerant to Ollama returning a JSON blob inside a ```json code fence.
// ---------------------------
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

        // strip code fences if present
        let cleaned = text.replace(/```json/g, "").replace(/```/g, "").trim();

        try {
            const parsed = JSON.parse(cleaned);
            return { reply: (parsed.reply || cleaned), emotion: (parsed.emotion || "neutral") };
        } catch (e) {
            // fallback - treat as a plain reply string
            return { reply: cleaned, emotion: "neutral" };
        }
    } catch (err) {
        console.error("callOllama error:", err);
        return { reply: "Sorry, I couldn't generate a response.", emotion: "neutral" };
    }
}

// ---------------------------
// TTS via say.export -> base64
// ---------------------------
async function ttsToWavBase64(text) {
    const tmpPath = path.join(".", `tmp_tts_${Date.now()}.wav`);
    return new Promise((resolve, reject) => {
        say.export(text, null, 1.0, tmpPath, async (err) => {
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

// ---------------------------
// Gentle aligner call (multipart/form-data)
// Returns phones: [{ phoneme, start, end }, ...] OR null on failure
// ---------------------------
async function runForcedAligner(wavFilePath, transcript) {
    try {
        if (!fs.existsSync(wavFilePath)) {
            console.warn("runForcedAligner: wav file missing:", wavFilePath);
            return null;
        }

        const form = new FormData();
        form.append("audio", fs.createReadStream(wavFilePath));
        form.append("transcript", transcript);

        const res = await fetch(GENTLE_URL, {
            method: "POST",
            body: form,
            headers: form.getHeaders()
        });

        if (!res.ok) {
            console.warn("Gentle HTTP error:", res.status, await res.text());
            return null;
        }

        const json = await res.json();

        // Gentle structure: json.words -> alignedWord.phones { phone, duration, start }
        const phones = [];
        if (json && Array.isArray(json.words)) {
            for (const w of json.words) {
                if (!w.alignedWord || !Array.isArray(w.alignedWord.phones)) continue;
                for (const p of w.alignedWord.phones) {
                    if (!p.phone) continue;
                    let phone = String(p.phone).replace(/\d/g, "").toUpperCase();
                    // Gentle phone objects commonly include start & duration
                    const start = (typeof p.start === "number") ? p.start : (typeof w.start === "number" ? w.start : 0);
                    const dur = (typeof p.duration === "number") ? p.duration : ((typeof w.end === "number" && typeof w.start === "number") ? (w.end - w.start) : 0.05);
                    const end = start + dur;
                    phones.push({ phoneme: phone, start: Number(start.toFixed(3)), end: Number(end.toFixed(3)) });
                }
            }
        }

        if (!phones.length) return null;
        return phones;
    } catch (err) {
        console.error("runForcedAligner exception:", err);
        return null;
    }
}

// ---------------------------
// Convert phoneme timeline -> viseme timeline (merge nearby same visemes)
// ---------------------------
function phonemesToVisemes(phones) {
    const vis = [];
    for (const p of phones) {
        const viseme = (PHONEME_TO_VISEME[p.phoneme] || "A");
        const last = vis.length ? vis[vis.length - 1] : null;
        // merge if same viseme and gap tiny
        if (last && last.viseme === viseme && Math.abs(last.end - p.start) < 0.035) {
            last.end = p.end;
        } else {
            vis.push({ viseme, start: Number(p.start.toFixed(3)), end: Number(p.end.toFixed(3)) });
        }
    }
    return vis;
}

// ---------------------------
// HTTP /chat endpoint
// ---------------------------
app.post("/chat", async (req, res) => {
    const { text } = req.body;
    if (!text) return res.status(400).json({ error: "text required" });

    try {
        // 1) generate model reply + emotion
        const parsed = await callOllama(text);
        // parsed.reply is cleaned string (not raw fenced JSON)
        let reply = (parsed.reply || "").toString();
        const emotion = parsed.emotion || "neutral";

        // 2) produce TTS WAV (base64) of CLEAN reply
        let audioBase64 = null;
        try {
            audioBase64 = await ttsToWavBase64(reply);
        } catch (err) {
            console.error("TTS generation failed:", err);
            audioBase64 = null;
        }

        // 3) determine WAV duration if we have audio
        let durationSeconds = 1.0;
        if (audioBase64) {
            const probeFile = path.join(".", `tmp_probe_${Date.now()}.wav`);
            try {
                fs.writeFileSync(probeFile, Buffer.from(audioBase64, "base64"));
                const info = await readWavInfo(probeFile);
                if (info && info.header && info.data && info.data.dataChunkSize) {
                    const sampleRate = Number(info.header.sampleRate) || 44100;
                    const bits = Number(info.header.bitsPerSample) || 16;
                    const channels = Number(info.header.numChannels) || 1;
                    const bytesPerSample = bits / 8 || 2;
                    const totalSamples = info.data.dataChunkSize / (bytesPerSample * channels);
                    durationSeconds = totalSamples / sampleRate;
                }
            } catch (err) {
                console.warn("Failed to probe WAV duration:", err);
            } finally {
                try { fs.unlinkSync(probeFile); } catch (e) { }
            }
        }

        // 4) Attempt forced alignment using Gentle (best) -> build viseme timeline
        let visemeTimeline = [];

        if (audioBase64) {
            // write temp wav for Gentle
            const alignTmp = path.join(".", `tmp_align_${Date.now()}.wav`);
            try {
                fs.writeFileSync(alignTmp, Buffer.from(audioBase64, "base64"));

                // run Gentle
                const phones = await runForcedAligner(alignTmp, reply);

                if (phones && phones.length) {
                    visemeTimeline = phonemesToVisemes(phones);
                    console.log("Viseme timeline (from Gentle) length:", visemeTimeline.length);
                } else {
                    // fallback heuristic
                    const seq = textToVisemeSequence(reply);
                    visemeTimeline = buildVisemeTimeline(seq, durationSeconds);
                    console.warn("Gentle failed or returned no phones -> used heuristic viseme timeline");
                }
            } catch (err) {
                console.error("Aligner pipeline error:", err);
                const seq = textToVisemeSequence(reply);
                visemeTimeline = buildVisemeTimeline(seq, durationSeconds);
            } finally {
                try { fs.unlinkSync(alignTmp); } catch (e) { }
            }
        } else {
            // no audio, fallback heuristic using estimated durationSeconds
            const seq = textToVisemeSequence(reply);
            visemeTimeline = buildVisemeTimeline(seq, durationSeconds);
        }

        // 5) Respond immediately to HTTP client with basic info
        res.json({ status: "ok", reply, emotion, visemes: visemeTimeline, audio: audioBase64 });

        // 6) Broadcast via WebSocket to all connected clients
        const payload = { type: "tts", reply, emotion, visemes: visemeTimeline, audio: audioBase64 };
        broadcastWS(JSON.stringify(payload));
    } catch (err) {
        console.error("Chat endpoint error:", err);
        res.status(500).json({ status: "error", error: String(err) });
    }
});

// ---------------------------
// WebSocket server
// ---------------------------
const wss = new WebSocketServer({ port: WS_PORT });

function broadcastWS(msg) {
    wss.clients.forEach((c) => {
        if (c.readyState === 1) c.send(msg);
    });
}

wss.on("connection", (ws) => {
    console.log("WS client connected");
    ws.send(JSON.stringify({ type: "info", msg: "connected" }));
});

// ---------------------------
// Start HTTP server
// ---------------------------
app.listen(HTTP_PORT, () => {
    console.log(`HTTP server running at http://localhost:${HTTP_PORT}`);
    console.log(`WebSocket server running at ws://localhost:${WS_PORT}`);
});
