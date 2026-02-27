// js/worker.js
import { pipeline, env } from 'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.14.0';

// Configurare
env.allowLocalModels = false;
env.useBrowserCache = true;

let pipe = null;

// Ascultăm comenzi de la Main Thread (Transcriber)
self.addEventListener('message', async (event) => {
    const { type, data } = event.data;

    if (type === 'install') {
        await loadModel(data.modelName);
    } 
    else if (type === 'transcribe') {
        await runTranscription(data.audio);
    }
});

async function loadModel(modelName) {
    try {
        // Trimitem mesaje de progres înapoi
        pipe = await pipeline('automatic-speech-recognition', modelName, {
            quantized: true,
            progress_callback: (progressData) => {
                self.postMessage({ type: 'progress', data: progressData });
            }
        });
        self.postMessage({ type: 'ready' });
    } catch (err) {
        self.postMessage({ type: 'error', data: err.message });
    }
}

async function runTranscription(audioData) {
    if (!pipe) return;

    try {
        const output = await pipe(audioData, {
            chunk_length_s: 30,
            stride_length_s: 5,
            language: 'portuguese',
            task: 'transcribe',

            // SPEED OPTIMIZATIONS
            return_timestamps: false,
            force_full_sequences: false,
            num_beams: 1, // 1 beam is significantly faster than the default for base models
            temperature: 0,
        });

        self.postMessage({ type: 'result', data: output.text.trim() });
    } catch (err) {
        self.postMessage({ type: 'error', data: err.message });
    }
}