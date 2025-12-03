/**
 * server.js
 * Node backend:
 * - HTTP /chat accepts { text } -> calls Ollama for reply+emotion (JSON)
 * - generates TTS WAV using say.export (tmp file)
 * - reads WAV duration using wav-file-info
 * - converts text -> simple phoneme-like tokens and maps them to visemes
 * - builds viseme timeline with accurate timings using WAV duration
 * - broadcasts via WebSocket { type: 'tts', audio: <base64 wav>, visemes: [...], emotion: 'happy' }
 *
 * NOTE: This generates heuristics for viseme timestamps. For production,
 * replace the mapping/aligner with a forced-aligner (Gentle / MFA / aeneas) for exact phoneme timings.
 */

import express from "express";
import cors from "cors";
import fetch from "node-fetch"; // for calling Ollama
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

// ---------------------------
// Config: Ollama (local) endpoint
// ---------------------------
const OLLAMA_URL = process.env.OLLAMA_URL || "http://localhost:11434/v1/chat/completions";
// If you use OpenAI HTTP API instead, modify callOllama accordingly.

// ---------------------------
// Simple mapping from characters/phoneme-classes -> viseme label
// This is heuristic fallback. Replace with real phoneme mapping in production.
// ---------------------------
function charToViseme(ch) {
    ch = ch.toLowerCase();
    if ("aeiou".includes(ch)) return "A"; // vowels -> open vowel viseme (A)
    if ("bdpv".includes(ch)) return "M"; // bilabials -> closed-ish
    if ("fvw".includes(ch)) return "FV"; // labiodental -> FV
    if ("l".includes(ch)) return "L"; // L
    if ("szcjx".includes(ch)) return "E"; // high front-ish
    if ("o".includes(ch)) return "O";
    // fallback
    return "A";
}

// Map a text string to a sequence of viseme labels (per character, compressed)
function textToVisemeSequence(text) {
    const seq = [];
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (!/[\w']/i.test(ch)) continue; // ignore punctuation & spaces
        const v = charToViseme(ch);
        if (!seq.length || seq[seq.length - 1] !== v) seq.push(v);
    }
    return seq;
}

// Build timeline: distribute audio duration across viseme sequence
function buildVisemeTimeline(visemeSeq, durationSeconds) {
    if (!visemeSeq.length) return [];

    // assign roughly equal durations per viseme with small random jitter for realism
    const base = durationSeconds / visemeSeq.length;
    const timeline = [];
    let cursor = 0;
    for (let i = 0; i < visemeSeq.length; i++) {
        const dur = Math.max(0.04, base * (0.85 + (Math.random() * 0.3))); // min 40ms
        const start = cursor;
        const end = Math.min(durationSeconds, cursor + dur);
        timeline.push({ viseme: visemeSeq[i], start: Number(start.toFixed(3)), end: Number(end.toFixed(3)) });
        cursor = end;
    }
    // ensure last viseme ends at durationSeconds
    if (timeline.length) timeline[timeline.length - 1].end = Number(durationSeconds.toFixed(3));
    return timeline;
}

// ---------------------------
// callOllama: ask model to reply in JSON with emotion
// We instruct the model to respond as JSON: {"reply":"...", "emotion":"happy"}
// ---------------------------
async function callOllama(userText) {
    // system prompt: ask for JSON only
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

        // Ollama might return { completion: "..."} or choices...
        let text = "";
        if (j.completion) text = j.completion;
        else if (j.choices?.[0]?.message?.content) text = j.choices[0].message.content;
        else text = JSON.stringify(j);

        // try parse JSON from model output
        let parsed;
        try {
            parsed = JSON.parse(text.trim());
            if (!parsed.reply) parsed.reply = text;
            if (!parsed.emotion) parsed.emotion = "neutral";
        } catch (e) {
            // fallback: treat whole text as reply and neutral emotion
            parsed = { reply: text.trim(), emotion: "neutral" };
        }
        return parsed;
    } catch (err) {
        console.error("callOllama error", err);
        return { reply: "Sorry, I couldn't generate a response.", emotion: "neutral" };
    }
}

// ---------------------------
// TTS via say.export (creates tmp WAV)
// ---------------------------
async function ttsToWavBase64(text) {
    const tmpPath = path.join(".", `tmp_tts_${Date.now()}.wav`);
    return new Promise((resolve, reject) => {
        say.export(text, null, 1.0, tmpPath, async (err) => {
            if (err) return reject(err);
            try {
                const buf = fs.readFileSync(tmpPath);
                fs.unlinkSync(tmpPath);
                const b64 = buf.toString("base64");
                resolve(b64);
            } catch (e) {
                reject(e);
            }
        });
    });
}

// ---------------------------
// HTTP chat endpoint
// ---------------------------
app.post("/chat", async (req, res) => {
    const { text } = req.body;
    if (!text) return res.status(400).json({ error: "text required" });

    // // 1) Ask Ollama for reply + emotion (JSON)
    // const { reply, emotion } = await callOllama(text);

    // // 2) Generate TTS WAV base64
    // let audioBase64 = null;
    // try {
    //   audioBase64 = await ttsToWavBase64(reply);
    // } catch (err) {
    //   console.error("TTS error:", err);
    //   // fallback: empty
    //   audioBase64 = null;
    // }

    const parsed = await callOllama(text);

    // parsed.reply may contain ```json...```
    let cleanReply = parsed.reply
        .replace(/```json/g, "")
        .replace(/```/g, "")
        .trim();

    try {
        // Try parse JSON inside reply
        const inner = JSON.parse(cleanReply);
        cleanReply = inner.reply || cleanReply;
    } catch (_) { }

    const reply = cleanReply;
    const emotion = parsed.emotion || "neutral";

    // Generate TTS for CLEAN reply only
    let audioBase64 = null;
    try {
        audioBase64 = await ttsToWavBase64(reply);
    } catch (err) {
        console.error("TTS error:", err);
        audioBase64 = null;
    }


    // 3) determine WAV duration using wav-file-info if audio exists
    let durationSeconds = 1.0;
    if (audioBase64) {
        try {
            const tmpFile = path.join(".", `tmp_probe_${Date.now()}.wav`);
            fs.writeFileSync(tmpFile, Buffer.from(audioBase64, "base64"));
            const info = await readWavInfo(tmpFile);
            // info has header.riffChunkSize and header.sampleRate etc.
            if (info && info.header && info.header.sampleRate && info.data && info.data.dataChunkSize) {
                const sampleRate = Number(info.header.sampleRate);
                const bytesPerSample = Number(info.header.bitsPerSample) / 8 || 2;
                const channels = Number(info.header.numChannels) || 1;
                const totalSamples = info.data.dataChunkSize / (bytesPerSample * channels);
                durationSeconds = totalSamples / sampleRate;
            } else {
                // fallback using data chunk size / (sampleRate * etc)
                if (info && info.data && info.data.dataChunkSize) {
                    const sampleRate = info.header.sampleRate || 44100;
                    durationSeconds = info.data.dataChunkSize / (sampleRate * 2 * (info.header.numChannels || 1));
                }
            }
            fs.unlinkSync(tmpFile);
        } catch (err) {
            console.warn("Failed to probe WAV duration:", err);
        }
    }

    // 4) Build viseme sequence & timeline (heuristic): map reply -> chars -> visemes
    const visemeSeq = textToVisemeSequence(reply);
    const visemeTimeline = buildVisemeTimeline(visemeSeq, durationSeconds);

    // 5) Reply quickly to HTTP client then broadcast via websocket (clients receive tts package)
    res.json({ status: "ok", reply, emotion, visemes: visemeTimeline, audio: audioBase64 });

    // 6) Broadcast to all WS clients (so UI can animate)
    const payload = { type: "tts", reply, emotion, visemes: visemeTimeline, audio: audioBase64 };
    broadcastWS(JSON.stringify(payload));
});

// ---------------------------
// WebSocket server (broadcast helper)
// ---------------------------
const wss = new WebSocketServer({ port: 8080 });

function broadcastWS(msg) {
    wss.clients.forEach(c => {
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
const httpPort = 3000;
app.listen(httpPort, () => {
    console.log(`HTTP server running on http://localhost:${httpPort}`);
    console.log(`WS server running on ws://localhost:8080`);
});
