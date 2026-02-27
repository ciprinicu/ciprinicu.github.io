// js/worker.js
import { pipeline, env } from 'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.14.0';

// Configurare
env.allowLocalModels = false;
env.useBrowserCache = true;

let whisperPipe = null;
let translatorPipe = null;

// Ascultăm comenzi de la Main Thread (Transcriber)
self.addEventListener('message', async (event) => {
    const { type, data } = event.data;

    if (type === 'install') {
        await loadModels(data.modelName);
    }
    else if (type === 'transcribe') {
        await runTranscriptionAndTranslation(data.audio);
    }
});

async function loadModels(whisperModel) {
    try {
        console.log(0)
        // 1. Load Whisper for Transcription
        whisperPipe = await pipeline('automatic-speech-recognition', whisperModel, {
            device: 'webgpu', // Acceleration enabled
            quantized: true, // Makes it much lighter on the GPU
            progress_callback: (p) => self.postMessage({ type: 'progress', data: p })
        });

        // 2. Load M2M100 for Offline Translation
        translatorPipe = await pipeline('translation', 'Xenova/m2m100_418M', {
            device: 'webgpu',
            quantized: true, // Makes it much lighter on the GPU
            progress_callback: (p) => self.postMessage({ type: 'progress', data: p })
        });


        await whisperPipe(new Float32Array(16000), {
            language: 'portuguese',
            task: 'transcribe'
        });

        // 2. Cold-start M2M100 (Translation)
        // We send a tiny dummy string to "prime" the translation engine
        await translatorPipe("Oi", {
            src_lang: 'pt',
            tgt_lang: 'en'
        });

        self.postMessage({ type: 'ready' });
    } catch (err) {
        // Fallback to CPU if WebGPU is not supported on the device
        console.error("WebGPU error, trying CPU...", err);
        self.postMessage({ type: 'error', data: "Switching to CPU mode..." });
        // Re-attempt without webgpu device if needed
    }
}

async function runTranscriptionAndTranslation(audioData) {
    if (!whisperPipe || !translatorPipe) return;

    try {
        // --- STEP 1: TRANSCRIBE PT ---
        const whisperOutput = await whisperPipe(audioData, {
            language: 'portuguese',
            task: 'transcribe',
            chunk_length_s: 30,
            stride_length_s: 5,
            num_beams: 5,
            repetition_penalty: 1.2,
            temperature: 0,
            no_speech_threshold: 0.6,
            condition_on_previous_text: false
        });

        const ptText = whisperOutput.text.trim();
        if (!ptText) return;

        // --- STEP 2: TRANSLATE TO EN (OFFLINE) ---
        const translationOutput = await translatorPipe(ptText, {
            src_lang: 'pt',
            tgt_lang: 'en',
        });

        const enText = translationOutput[0].translation_text;

        // Send BOTH results back at once
        self.postMessage({
            type: 'result',
            data: { pt: ptText, en: enText }
        });

    } catch (err) {
        self.postMessage({ type: 'error', data: err.message });
    }
}