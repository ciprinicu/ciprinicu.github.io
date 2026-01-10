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
    if (!pipe) {
        self.postMessage({ type: 'error', data: "Model not loaded yet" });
        return;
    }

    try {
        // Rulăm AI-ul cu setări ANTI-REPETIȚIE
        const output = await pipe(audioData, {
            chunk_length_s: 30,
            stride_length_s: 5,
            language: 'portuguese',
            task: 'transcribe',
            
            // --- MODIFICĂRI NOI ---
            temperature: 0,        // Îl forțăm să fie cât mai exact (fără halucinații)
            repetition_penalty: 1.2, // Dacă repetă cuvinte, primește "amendă" (le evită)
            no_repeat_ngram_size: 3 // Nu are voie să repete secvențe de 3 cuvinte identice
        });

        // Trimitem textul înapoi
        self.postMessage({ type: 'result', data: output.text.trim() });
    } catch (err) {
        self.postMessage({ type: 'error', data: err.message });
    }
}