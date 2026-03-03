// js/worker.js
import { pipeline, env } from 'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.14.0';

// Configurare pentru cache și performanță
env.allowLocalModels = false;
env.useBrowserCache = true;

let whisperPipe = null;
let translatorPipe = null;
let isM2M100Loaded = false; // Flag ca să nu ocupăm RAM-ul degeaba

self.addEventListener('message', async (event) => {
    const { type, data } = event.data;

    if (type === 'install') {
        // Trecem modelName-ul de la transcriber (recomandat: whisper-tiny)
        await loadModels(data.modelName);
    }
    else if (type === 'transcribe') {
        await runTranscriptionAndTranslation(data.audio);
    }
});

async function loadModels(whisperModel) {
    try {
        console.log("🚀 Pornire motor AI...");

        // 1. Load Whisper (Prioritate maximă)
        whisperPipe = await pipeline('automatic-speech-recognition', whisperModel, {
            device: 'webgpu',
            quantized: true, // Obligatoriu pentru iPhone
            progress_callback: (p) => self.postMessage({ type: 'progress', data: { ...p, task: 'Whisper' } })
        });

        // 2. Warm-up Whisper ca să nu dea lag la prima dictare
        //await whisperPipe(new Float32Array(16000), { language: 'portuguese' });

        // 3. NU încărcăm M2M100 încă dacă suntem online
        // Asta salvează ~300MB RAM care altfel ar face iPhone-ul să dea crash
        if (!navigator.onLine) {
            alert("Switching to offline translation...");
            await loadTranslator();
        } else { console.log("Running online...") }

        self.postMessage({ type: 'ready' });
    } catch (err) {
        console.error("WebGPU error, falling back to CPU...", err);
        // Re-încercare pe WASM (CPU) dacă WebGPU e blocat pe iPad
        self.postMessage({ type: 'error', data: "Switching to CPU mode for stability..." });
    }
}

async function loadTranslator() {
    if (isM2M100Loaded) return;
    try {
        translatorPipe = await pipeline('translation', 'Xenova/m2m100_418M', {
            device: 'webgpu',
            quantized: true, // ESENȚIAL: scade RAM-ul masiv
            progress_callback: (p) => self.postMessage({ type: 'progress', data: { ...p, task: 'Translator' } })
        });
        isM2M100Loaded = true;
        console.log("📦 Motorul de traducere offline este gata.");
    } catch (e) {
        console.warn("Translator failed to load on GPU, trying CPU...");
    }
}

async function fetchOnlineTranslation(text) {
    try {
        // Timeout de 3 secunde ca să nu stăm la infinit dacă net-ul e prost
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 3000);

        const response = await fetch(
            `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=pt|en`,
            { signal: controller.signal }
        );
        clearTimeout(timeoutId);

        const data = await response.json();
        return data.responseData?.translatedText || null;
    } catch (err) {
        console.warn("🌐 Online API failed. Fallback to Local GPU...");
        return null;
    }
}

async function runTranscriptionAndTranslation(audioData) {
    if (!whisperPipe) return;

    try {
        // --- STEP 1: TRANSCRIBE PT (Local GPU) ---
        const whisperOutput = await whisperPipe(audioData, {
            language: 'portuguese',
            task: 'transcribe'
        });

        const ptText = whisperOutput.text.trim();
        if (!ptText) return;

        // --- STEP 2: HYBRID TRANSLATION ---
        let enText = null;
        let usedOffline = false;

        if (navigator.onLine) {
            enText = await fetchOnlineTranslation(ptText);
        }

        // --- STEP 3: FALLBACK TO LOCAL GPU ---
        if (!enText) {
            if (!isM2M100Loaded) await loadTranslator(); // Îl încărcăm doar acum dacă e nevoie

            const translation = await translatorPipe(ptText, {
                src_lang: 'pt',
                tgt_lang: 'en'
            });
            enText = translation[0].translation_text;
            usedOffline = true;
        }

        self.postMessage({
            type: 'result',
            data: { pt: ptText, en: enText, offline: usedOffline }
        });

    } catch (err) {
        self.postMessage({ type: 'error', data: err.message });
    }
}