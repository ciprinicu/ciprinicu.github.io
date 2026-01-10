// js/transcriber.js

class AudioTranscriber {
    constructor() {
        // Aici lansăm worker-ul pe un fir separat
        this.worker = new Worker('./js/worker.js', { type: 'module' });
        
        // Dacă vrei acuratețe maximă, pune 'Xenova/whisper-small'. 
        // Dacă vrei viteză, lasă 'Xenova/whisper-base'.
        this.modelName = 'Xenova/whisper-base'; 
        
        this.isReady = false;
        this.installCallback = null;
        this.transcribeResolve = null;

        // Ascultăm ce zice Worker-ul
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
                if (this.transcribeResolve) this.transcribeResolve(data);
                this.transcribeResolve = null;
            }
            if (type === 'error') {
                console.error("Worker Error:", data);
                if (this.transcribeResolve) this.transcribeResolve(""); // Returnăm gol pe eroare
            }
        };
    }

    // Funcția pentru Wizard (Instalare)
    install(progressCallback) {
        this.installCallback = (data) => {
            // Adaptăm formatul pentru Wizard
            if(data.status === 'progress') {
                const percent = (data.loaded / data.total) * 100;
                progressCallback(percent, data.file);
            }
            if(data.status === 'done') {
                // Opțional: log
            }
        };

        return new Promise((resolve) => {
            this.installResolve = resolve;
            // Îi zicem worker-ului să descarce
            this.worker.postMessage({ 
                type: 'install', 
                data: { modelName: this.modelName } 
            });
        });
    }

    // Funcția de transcriere
    async transcribe(audioBlob) {
        if (!this.isReady) {
            console.log("Model not ready, waiting...");
            // Dacă nu e gata, încercăm să-l inițializăm
             this.worker.postMessage({ 
                type: 'install', 
                data: { modelName: this.modelName } 
            });
            // Așteptăm puțin (hack simplu) sau returnăm eroare
            return ""; 
        }

        // Convertim Blob-ul aici (e rapid) și trimitem datele pure la Worker
        const audioData = await this.convertBlobToFloat32(audioBlob);

        return new Promise((resolve) => {
            this.transcribeResolve = resolve;
            this.worker.postMessage({ 
                type: 'transcribe', 
                data: { audio: audioData } 
            });
        });
    }

    // Helper audio
    async convertBlobToFloat32(blob) {
        const audioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
        const arrayBuffer = await blob.arrayBuffer();
        const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
        return audioBuffer.getChannelData(0);
    }

    init() {
        console.log("🔈 Pre-loading AI model...");
        // Apelăm install cu o funcție goală, doar ca să oblige worker-ul să încarce fișierele în RAM
        return this.install(() => {}); 
    }
}

export const transcriber = new AudioTranscriber();