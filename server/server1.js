import express from "express";
import dotenv from "dotenv";
import fetch from "node-fetch";
import say from "say";
import fs from "fs";
import path from "path";
import { WebSocketServer } from "ws";
import cors from "cors";

dotenv.config();

const app = express();

// ------------------------
// CORS
// ------------------------
app.use(
    cors({
        origin: "*",
        methods: ["GET", "POST", "OPTIONS"],
        allowedHeaders: ["Content-Type", "Authorization"]
    })
);
app.options("*", cors());

// ------------------------
// JSON parsing
// ------------------------
app.use(express.json({ limit: "10mb" }));

// ------------------------
// Paths
// ------------------------
const __dirname = path.resolve();

// ------------------------
// Load robot sprites once
// ------------------------
let sprites = [];
for (let i = 1; i <= 25; i++) {
    const file = path.join(__dirname, "assets", `robot0${i}.png`);
    const data = fs.readFileSync(file);
    sprites.push({ image: data.toString("base64"), format: "PNG" });
}
sprites = [...sprites, ...sprites.slice().reverse()]; // looped animation
const quietFrame = sprites[0];

// ------------------------
// Global state
// ------------------------
let conversation = [
    { role: "system", content: "You are Chatbot, a friendly short-talking robot assistant. Keep answers simple." }
];

// ------------------------
// LLM using Ollama
// ------------------------
async function callLLM(message) {
    conversation.push({ role: "user", content: message });

    const body = {
        model: "phi3:mini",
        messages: conversation.map((x) => ({
            role: x.role,
            content: x.content
        }))
    };

    try {
        const response = await fetch("http://localhost:11434/v1/chat/completions", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body)
        });

        const json = await response.json();

        let reply = "";
        if (json.completion) reply = json.completion;
        else if (json.choices?.[0]?.message) reply = json.choices[0].message.content;
        else reply = "Sorry, I couldn't process that.";

        conversation.push({ role: "assistant", content: reply });
        return reply;
    } catch (err) {
        console.error("Ollama error:", err);
        return "Sorry, I couldn't process that.";
    }
}

// ------------------------
// Text → Speech (WAV Base64)
// ------------------------
async function textToSpeech(text) {
    try {
        const filePath = "./tmp_audio.wav";

        await new Promise((resolve, reject) => {
            say.export(text, null, 1.0, filePath, (err) => {
                if (err) return reject(err);
                resolve();
            });
        });

        const audioBuffer = fs.readFileSync(filePath);
        fs.unlinkSync(filePath);

        return audioBuffer.toString("base64");
    } catch (err) {
        console.error("TTS error:", err);
        return null;
    }
}

// ------------------------
// WebSocket server
// ------------------------
const wss = new WebSocketServer({ noServer: true });

wss.on("connection", (ws) => {
    console.log("Client connected");

    // Send quiet frame and all sprites once
    ws.send(JSON.stringify({ type: "quiet_frame", data: quietFrame }));
    ws.send(JSON.stringify({ type: "sprites", data: sprites }));

    ws.on("message", async (raw) => {
        const msg = JSON.parse(raw);

        if (msg.type === "user_message") {
            const text = msg.text;

            // 1️⃣ LLM
            const reply = await callLLM(text);

            // 2️⃣ TTS
            const audioBase64 = await textToSpeech(reply);

            // 3️⃣ Send bot text + audio (NO ANIMATION from server)
            ws.send(JSON.stringify({ type: "bot_text", text: reply }));
            ws.send(JSON.stringify({ type: "audio", base64: audioBase64 }));
        }
    });

    ws.on("close", () => console.log("Client disconnected"));
});

// ------------------------
// Routes
// ------------------------
app.post("/start", (req, res) => {
    res.json({ status: "ok", ws_url: "ws://localhost:7860/ws" });
});

app.post("/stop", (req, res) => {
    conversation = conversation.slice(0, 1);
    res.json({ status: "stopped" });
});

// ------------------------
// Start server
// ------------------------
const server = app.listen(7860, () =>
    console.log("Server running at http://localhost:7860")
);

server.on("upgrade", (req, socket, head) => {
    if (req.url === "/ws") {
        wss.handleUpgrade(req, socket, head, (client) => {
            wss.emit("connection", client, req);
        });
    } else socket.destroy();
});
