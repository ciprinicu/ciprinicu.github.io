// js/transcriber.js

class AudioTranscriber {
    constructor() {
        this.worker = new Worker('./js/worker.js', { type: 'module' });
        this.modelName = 'Xenova/whisper-base';
        this.isReady = false;
        this.installCallback = null;
        this.transcribeResolve = null;
        this.audioContext = null;

        this.worker.onmessage = (e) => {
            const { type, data } = e.data;
            if (type === 'progress' && this.installCallback) {
                this.installCallback(data);
            }
            if (type === 'ready') {
                this.isReady = true;
                if (this.installResolve) this.installResolve(true);
            }
            if (type === 'result') {
                // ACUM: data este { pt: "...", en: "..." }
                if (this.transcribeResolve) this.transcribeResolve(data);
                this.transcribeResolve = null;
            }
            if (type === 'error') {
                console.error("Worker Error:", data);
            }
        };
    }

    getAudioContext() {
        if (!this.audioContext) {
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
        }
        return this.audioContext;
    }

    async transcribe(audioBlob) {
        if (!this.isReady) return null;

        const ctx = this.getAudioContext();
        const arrayBuffer = await audioBlob.arrayBuffer();

        try {
            const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
            const audioData = audioBuffer.getChannelData(0);

            return new Promise((resolve) => {
                this.transcribeResolve = resolve;
                this.worker.postMessage({
                    type: 'transcribe',
                    data: {
                        audio: audioData,
                        modelName: this.modelName // Trimitem și modelName pentru siguranță
                    }
                });
            });
        } catch (e) {
            console.error("Audio decoding failed", e);
            return null;
        }
    }

    install(progressCallback) {
        this.installCallback = (data) => {
            // Monitorizăm progresul pentru ambele modele (Whisper + M2M100)
            if (data.status === 'progress') {
                const percent = (data.loaded / data.total) * 100;
                progressCallback(percent, data.file);
            }
        };
        return new Promise((resolve) => {
            this.installResolve = resolve;
            this.worker.postMessage({ type: 'install', data: { modelName: this.modelName } });
        });
    }

    init() {
        if (!location.href.includes("editor")) return;
        this.getAudioContext();
        return this.install(() => { });
    }
}

export const transcriber = new AudioTranscriber();