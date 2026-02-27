import { transcriber } from './transcriber.js';
import { NotebookManager, dbPromise } from './db.js';

// --- IMPORTURI TIPTAP & EXTENSII (Image inclusă) ---
import { Editor } from 'https://esm.sh/@tiptap/core';
import { StarterKit } from 'https://esm.sh/@tiptap/starter-kit';
import Placeholder from 'https://esm.sh/@tiptap/extension-placeholder';
import ImageExtension from 'https://esm.sh/@tiptap/extension-image'; 
import MarkdownIt from 'https://esm.sh/markdown-it';

// --- CONFIGURARE GLOBALĂ ---
let editor = null;
let audioContext, analyser, dataArray;
let silenceStart = null;
const SILENCE_THRESHOLD = 10; // Cât de liniște trebuie să fie (0-255)
const SILENCE_DURATION = 5000; // 1.2 secunde de liniște = final de frază   

let globalAudioContext = null;
let globalStream = null;
let animationId;

// FIX 1: Activăm html: true ca să nu șteargă pozele dacă le trece prin parser din greșeală
const mdParser = new MarkdownIt({ html: true });
let saveTimeout = null;

// Elemente DOM - Editor & Desen
const titleInput = document.getElementById('doc-title');
const saveStatus = document.getElementById('save-status'); 
const btnMic = document.getElementById('btn-mic');
const canvas = document.getElementById('draw-layer');
const sheet = document.getElementById('scroll-container'); 
const paperBg = document.getElementById('scroll-container');
const btnDraw = document.getElementById('btn-draw-mode');
const btnClear = document.getElementById('btn-clear-draw');

// js/editor.js -> Sus, la secțiunea de Elemente DOM
const btnSplit = document.getElementById('btn-toggle-split');
const editorElement = document.getElementById('tiptap-editor');

// Elemente DOM - Imagini
const btnAddImg = document.getElementById('btn-add-img');
const imgInput = document.getElementById('img-input');

// Variabile de Stare
const urlParams = new URLSearchParams(window.location.search);
const noteId = parseInt(urlParams.get('id'));

let currentNote = null;
let isRecording = false;
let recordingInterval = null;
let isDrawingMode = false;
let ctx = null;

if (canvas) ctx = canvas.getContext('2d');

// --- 1. INIȚIALIZARE APP ---

import { Node, mergeAttributes } from 'https://esm.sh/@tiptap/core';

const NoteBlock = Node.create({
    name: 'noteBlock',
    group: 'block',
    content: 'block*', // Permite alte blocuri în interior (cum e textul)
    defining: true,

    parseHTML() {
        return [{ tag: 'div.note-block' }]; // Recunoaște tag-ul în HTML
    },

    renderHTML({ HTMLAttributes }) {
        return ['div', mergeAttributes(HTMLAttributes, { class: 'note-block' }), 0];
    },
});

const SourcePt = Node.create({
    name: 'sourcePt',
    group: 'block',
    content: 'inline*',
    parseHTML() { return [{ tag: 'div.source-pt' }]; },
    renderHTML({ HTMLAttributes }) {
        return ['div', mergeAttributes(HTMLAttributes, { class: 'source-pt' }), 0];
    },
});

const TargetEn = Node.create({
    name: 'targetEn',
    group: 'block',
    content: 'inline*',
    parseHTML() { return [{ tag: 'div.target-en' }]; },
    renderHTML({ HTMLAttributes }) {
        return ['div', mergeAttributes(HTMLAttributes, { class: 'target-en' }), 0];
    },
});

function applyPtVisibility(isHidden) {
    // 1. Aplicăm clasa pe editor ca să ascundem/arătăm PT
    if (editorElement) {
        if (isHidden) {
            editorElement.classList.add('hide-pt');
        } else {
            editorElement.classList.remove('hide-pt');
        }
    }

    // 2. Colorăm butonul (doar îi punem clasa .active)
    if (btnSplit) {
        btnSplit.classList.toggle('active', isHidden);
    }
}

async function init() {
    const isInstalled = localStorage.getItem('traduCipriInstalled');
    if (!isInstalled) {
        alert("You have to complete the configuration first!");
        window.location.href = 'index.html';
        return;
    }

    // === SETUP TIPTAP EDITOR ===
    if (document.getElementById('tiptap-editor')) {
    editor = new Editor({
        element: document.getElementById('tiptap-editor'),
        extensions: [
            StarterKit.configure({
                heading: { levels: [1, 2, 3] },
            }),
            ImageExtension.configure({
                inline: true,      
                allowBase64: true, 
            }), 
            Placeholder.configure({
                placeholder: 'Write, dictate or insert an image...',
            }),
            NoteBlock,
            SourcePt,
            TargetEn,
            // 2. Add a simple extension to handle the Dual-Language blocks
            // This prevents Tiptap from "cleaning" your note-blocks
            StarterKit.UndoRedo,
        ],
        // 3. IMPORTANT: Tell Tiptap to leave our HTML alone during parsing
        parseOptions: {
            preserveWhitespace: 'full',
        },
        content: '',
        autofocus: true,
        onCreate({ editor }) {
            // 1. La pornire, verificăm ce avem salvat
            const isHidden = localStorage.getItem('traduCipri_hidePt') === 'true';
            // Așteptăm un mic delay ca Tiptap să randeze DOM-ul
            setTimeout(() => applyPtVisibility(isHidden), 100);
        },
        onUpdate: ({ editor }) => {
            triggerSave(false); 
            resizeCanvas(true);
        },
    });
}

    // === SETUP AI (LOADING) ===
    if (btnMic) {
        btnMic.disabled = true;
        btnMic.style.opacity = '0.5';
        btnMic.innerHTML = '⏳ <span style="font-size:0.7em">AI Loading...</span>';

        transcriber.init().then(() => {
            console.log("✅ AI Ready to rock!");
            if (btnMic) {
                btnMic.disabled = false;
                btnMic.style.opacity = '1';
                btnMic.innerHTML = '🎙️ REC';
                btnMic.style.transition = "all 0.3s ease";
                btnMic.style.transform = "scale(1.1)";
                setTimeout(() => btnMic.style.transform = "scale(1)", 300);
            }
        }).catch(err => {
            console.error("❌ Eroare AI:", err);
            if (btnMic) btnMic.innerText = "❌ Eroare AI";
        });
    }

    // === ÎNCĂRCARE DATE DIN DB ===
    if (!noteId) return;

    const db = await dbPromise;
    currentNote = await db.get('notebooks', noteId);

    if (!currentNote) {
        alert("The notebook does not exist!");
        window.location.href = 'index.html';
        return;
    }

    if (titleInput) titleInput.value = currentNote.title;

    // Încărcăm conținutul
    if (currentNote.content && editor) {
        if (titleInput) titleInput.value = currentNote.title;

        // Verificăm conținutul
        const content = currentNote.content.trim();
        
        // Dacă începe cu tag-uri HTML (<p, <img, <h1), îl încărcăm direct
        if (content.startsWith('<')) {
            editor.commands.setContent(content);
        } else {
            // Dacă pare a fi Markdown vechi, îl convertim
            // Dar acum mdParser are html: true, deci nu va șterge pozele existente
            const parsedHtml = mdParser.render(currentNote.content);
            editor.commands.setContent(parsedHtml);
        }
    }

    // Încărcăm desenul
    if (canvas && sheet) {
        resizeCanvas();
        if (currentNote.drawing) {
            const img = new Image();
            img.src = currentNote.drawing;
            img.onload = () => ctx.drawImage(img, 0, 0);
        }
        window.addEventListener('resize', () => resizeCanvas(false));
    }

    // Auto-Save Titlu
    if (titleInput) {
        titleInput.addEventListener('change', () => {
            currentNote.title = titleInput.value;
            triggerSave(true); 
        });
    }

    // Focus pe editor
    if (paperBg) {
        paperBg.onclick = (e) => {
            if (e.target.id === 'scroll-container' && editor) editor.commands.focus();
        }
    }

    if (btnSplit && editorElement) {
        btnSplit.onclick = () => {
            const isCurrentlyHidden = editorElement.classList.contains('hide-pt');
            const newState = !isCurrentlyHidden;
            console.log(isCurrentlyHidden, newState)

            applyPtVisibility(newState);
            localStorage.setItem('traduCipri_hidePt', newState);
        };
    }
}

// --- 2. LOGICA PENTRU IMAGINI (SMART INSERT) ---

if (btnAddImg && imgInput) {
    btnAddImg.onclick = () => imgInput.click();

    imgInput.onchange = async (event) => {
        const files = event.target.files;
        if (!files || files.length === 0) return;

        showStatus('saving'); 

        const fileArray = Array.from(files);

        const readFileAsDataURL = (file) => {
            return new Promise((resolve) => {
                const reader = new FileReader();
                reader.onload = (e) => resolve(e.target.result);
                reader.readAsDataURL(file);
            });
        };

        for (const file of fileArray) {
            const imgSrc = await readFileAsDataURL(file);

            if (editor) {
                const { from, to, empty } = editor.state.selection;
                if (!empty) {
                    editor.commands.setTextSelection(to);
                }

                editor.chain()
                    .focus()
                    .setImage({ src: imgSrc })
                    .run();

                editor.chain().focus().enter().run();
            }
        }

        imgInput.value = ''; 

        // Salvare și Scroll la final
        setTimeout(() => {
            if (editor) editor.commands.scrollIntoView();
            triggerSave(true); 
        }, 100);
    };
}

// --- 3. LOGICA AUDIO ---

function killMicrophone() {
    if (globalStream) {
        globalStream.getTracks().forEach(track => track.stop());
        globalStream = null;
    }

    if (animationId) {
        cancelAnimationFrame(animationId);
    }

    // We don't necessarily need to close it, just suspend it to save battery
    if (globalAudioContext && globalAudioContext.state !== 'closed') {
        globalAudioContext.suspend();
    }
}

if (btnMic) {
    btnMic.onclick = async () => {
        if (btnMic.disabled) return;
        if (!isRecording) await startRecordingLoop();
        else stopRecordingLoop();
    };
}

let recorder;
const loader = document.createElement('div');
loader.id = 'processing-loader';
document.body.appendChild(loader);  

function monitorVoiceActivity(stream) {
    // 1. REUSE the existing context from the transcriber
    const audioContext = transcriber.getAudioContext();

    // Resume context if it was suspended by the browser
    if (audioContext.state === 'suspended') {
        audioContext.resume();
    }

    const source = audioContext.createMediaStreamSource(stream);

    // Use global variables for analyser/dataArray to avoid re-declaring them
    analyser = audioContext.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);

    const bufferLength = analyser.frequencyBinCount;
    dataArray = new Uint8Array(bufferLength);

    function check() {
        // Exit loop if recording stopped
        if (!isRecording) return;

        animationId = requestAnimationFrame(check);
        analyser.getByteFrequencyData(dataArray);

        let sum = 0;
        for (let i = 0; i < bufferLength; i++) sum += dataArray[i];
        let average = sum / bufferLength;

        // Visual feedback for your loading bar if you want it
        const loader = document.getElementById('processing-loader');
        if (loader && !loader.classList.contains('is-thinking')) {
            loader.style.width = Math.min(average * 1.5, 100) + '%';
        }

        if (average < SILENCE_THRESHOLD) {
            if (!silenceStart) silenceStart = Date.now();

            if (Date.now() - silenceStart > SILENCE_DURATION) {
                console.log("Pauză detectată, trimitem segmentul...");

                // 2. Use window.recorder to avoid Scope/Reference errors
                if (window.recorder && window.recorder.state === 'recording') {
                    window.recorder.stop();
                    silenceStart = null;
                    // Note: We don't 'return' here, we let the loop die naturally 
                    // when isRecording becomes false or the next segment starts.
                }
            }
        } else {
            silenceStart = null;
        }
    }
    check();
}

var tempstream = null;

async function startRecordingLoop() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        tempstream = stream;
        isRecording = true;
        btnMic.innerHTML = "⏹ Stop";
        btnMic.classList.add('rec-active');

        const recordSegment = () => {
            if (!isRecording) return;

            // Start a new recorder for this segment
            recorder = new MediaRecorder(stream);
            window.recorder = recorder
            let chunks = [];

            recorder.ondataavailable = (e) => {
                if (e.data.size > 0) chunks.push(e.data);
            };

            // Pornește monitorizarea „inteligentă”
            monitorVoiceActivity(stream);

            // Plasa de siguranță: dacă nu taci deloc, tăiem la 12 secunde
            const safetyNet = setTimeout(() => {
                if (recorder.state === 'recording') recorder.stop();
            }, 8000);

            recorder.onstop = async () => {
                // Immediately trigger the next segment BEFORE processing this one
                // This ensures the "mic" is always captured by a recorder
                if (isRecording) recordSegment();

                const audioBlob = new Blob(chunks, { type: 'audio/webm' });
                chunks = []; // Clear local memory immediately

                if (audioBlob.size > 1000) {
                    // ACTIVĂM FEEDBACK-UL VIZUAL
                    clearTimeout(safetyNet); // Oprim cronometrul de siguranță
                    loader.classList.add('is-thinking');
                    const result = await transcriber.transcribe(audioBlob);
                    // DEZACTIVĂM CÂND E GATA
                    loader.classList.remove('is-thinking');
                    // CHECK THIS: result is now { pt: "...", en: "..." }
                    if (result && result.pt) {
                        insertTextSmart(result.pt, result.en);
                    }
                    //if (text && text.trim()) insertTextSmart(text);
                }
            };

            recorder.start();
        };

        recordSegment();
    } catch (err) {
        console.error("Mic error:", err);
        alert("Microfon blocat!");
        stopRecordingLoop();
    }
}

function stopRecordingLoop() {
    isRecording = false;
    if (recordingInterval) { clearInterval(recordingInterval); recordingInterval = null; }
    if (btnMic) { btnMic.innerHTML = "🎙️ REC"; btnMic.classList.remove('rec-active'); }
    if(tempstream !== globalStream) killMicrophone();
}

async function insertTextSmart(ptText, enText) {
    if (!editor || !ptText) return;

    // 1. Clean up Whisper hallucinations like [Música] or [Gritos]
    let cleanPt = ptText.replace(/\[.*?\]/g, '').trim();
    let cleanEn = enText ? enText.replace(/\[.*?\]/g, '').trim() : "Translation unavailable";

    if (cleanPt.length < 2) return;

    // 2. Avoid duplicates (Whisper stutter)
    const allText = editor.getText();
    if (allText.slice(-100).includes(cleanPt)) return;

    showStatus('saving');

    // 3. Create the Tight HTML Block
    // Note: We keep this on ONE LINE with no spaces between tags to stop Tiptap's <p> injection
    const finalHtml = `<div class="note-block"><div class="source-pt">${cleanPt}</div><div class="target-en">${cleanEn}</div></div>`;

    // 4. Insert Everything in one chain
    editor.chain()
        .focus()
        .insertContent(finalHtml)
        .run();

    // 5. Auto-scroll to bottom for mobile
    window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });

    triggerSave(false);
}


//ignore this i will maybe add online
async function translateToEnglish(text) {
    try {
        // Using MyMemory API (Free, no key needed for low volume)
        const response = await fetch(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=pt|en`);
        const data = await response.json();

        if (data.responseData && data.responseData.translatedText) {
            return data.responseData.translatedText;
        }
        return "🇬🇧 [Translation Error]";
    } catch (err) {
        console.error("Translation API failed:", err);
        return "🇬🇧 " + text; // Fallback to original
    }
}

// --- 4. LOGICA DESEN ---

if (btnDraw && canvas) {
    btnDraw.onclick = () => {
        isDrawingMode = !isDrawingMode;
        if (isDrawingMode) {
            btnDraw.classList.add('active');
            canvas.style.pointerEvents = 'auto';
            if (editor) editor.setEditable(false);
            if (document.querySelector('.editor-content')) document.querySelector('.editor-content').style.opacity = '0.5';
        } else {
            btnDraw.classList.remove('active');
            canvas.style.pointerEvents = 'none';
            if (editor) editor.setEditable(true);
            if (document.querySelector('.editor-content')) document.querySelector('.editor-content').style.opacity = '1';
            saveDrawing();
        }
    };
}

let painting = false;
function startPosition(e) { painting = true; draw(e); }
function finishedPosition() { painting = false; if (ctx) ctx.beginPath(); }
function draw(e) {
    if (!painting || !isDrawingMode || !ctx) return;

    const x = e.clientX;
    const y = e.clientY + sheet.scrollTop; 

    if (y < 65) return; 

    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#ef4444';

    ctx.lineTo(x, y);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x, y);
}

if (canvas) {
    canvas.addEventListener('mousedown', startPosition);
    canvas.addEventListener('mouseup', finishedPosition);
    canvas.addEventListener('mousemove', draw);
}

if (btnClear) {
    btnClear.onclick = () => {
        if (confirm("Delete drawing?")) {
            if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
            saveDrawing();
        }
    };
}

// --- 5. HELPERS SI SALVARE ---

function resizeCanvas(preserve = false) {
    if (!canvas || !sheet) return;
    const newHeight = Math.max(sheet.scrollHeight, sheet.offsetHeight);
    const newWidth = sheet.offsetWidth;
    if (canvas.width === newWidth && canvas.height === newHeight) return;

    if (preserve) {
        const savedData = canvas.toDataURL();
        const img = new Image();
        img.src = savedData;
        img.onload = () => {
            canvas.width = newWidth;
            canvas.height = newHeight;
            if (ctx) ctx.drawImage(img, 0, 0);
        };
    } else {
        canvas.width = newWidth;
        canvas.height = newHeight;
    }
}

// === SISTEM DE SALVARE ===

function triggerSave(isUrgent) {
    showStatus('saving'); 
    
    if (saveTimeout) clearTimeout(saveTimeout);

    if (isUrgent) {
        saveNote(); 
    } else {
        saveTimeout = setTimeout(saveNote, 1000); 
    }
}

async function saveNote() {
    if (!currentNote || !editor) return;
    
    try {
        const db = await dbPromise;
        const note = await db.get('notebooks', noteId) || currentNote;
        
        note.content = editor.getHTML(); 
        if (titleInput) note.title = titleInput.value;
        note.updatedAt = new Date();
        
        await db.put('notebooks', note); 
        showStatus('saved'); 
    } catch (e) {
        console.error("Save failed", e);
        showStatus('error');
    }
}

async function saveDrawing() {
    if (!currentNote || !canvas) return;
    showStatus('saving');
    const db = await dbPromise;
    const note = await db.get('notebooks', noteId);
    note.drawing = canvas.toDataURL();
    await db.put('notebooks', note);
    showStatus('saved');
}

function showStatus(state) {
    if (!saveStatus) return; 
    
    saveStatus.classList.add('visible');
    saveStatus.className = 'visible ' + state;
    
    if (state === 'saving') saveStatus.innerText = "Saving...";
    if (state === 'saved') {
        saveStatus.innerText = "Saved ✔";
        setTimeout(() => { 
            if(saveStatus) saveStatus.classList.remove('visible'); 
        }, 2000);
    }
    if (state === 'error') saveStatus.innerText = "Error! ❌";
}

// START
init();