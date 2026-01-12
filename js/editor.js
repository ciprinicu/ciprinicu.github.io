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

async function init() {
    const isInstalled = localStorage.getItem('traduCipriInstalled');
    if (!isInstalled) {
        alert("Trebuie să finalizezi configurarea mai întâi!");
        window.location.href = 'index.html';
        return;
    }

    // === SETUP TIPTAP EDITOR ===
    if (document.getElementById('tiptap-editor')) {
        editor = new Editor({
            element: document.getElementById('tiptap-editor'),
            extensions: [
                StarterKit,
                // FIX 2: Configurare CORECTĂ pentru imagini
                // Setările allowBase64 și inline trebuie să fie la nivelul de bază, nu în 'resize'
                ImageExtension.configure({
                    inline: true,      
                    allowBase64: true, // Asta e CHEIA ca să nu dispară pozele la load!
                }), 
                Placeholder.configure({
                    placeholder: 'Scrie, dictează sau pune o poză...',
                }),
                StarterKit.UndoRedo,
            ],
            content: '',
            autofocus: true,
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
        alert("Caietul nu există!");
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

if (btnMic) {
    btnMic.onclick = async () => {
        if (btnMic.disabled) return;
        if (!isRecording) await startRecordingLoop();
        else stopRecordingLoop();
    };
}

async function startRecordingLoop() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        isRecording = true;
        btnMic.innerHTML = "⏹ Stop";
        btnMic.classList.add('rec-active');

        const recordSegment = () => {
            if (!isRecording) return;
            const recorder = new MediaRecorder(stream);
            let chunks = [];
            recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
            recorder.onstop = async () => {
                const audioBlob = new Blob(chunks, { type: 'audio/webm' });
                if (audioBlob.size > 0) {
                    const text = await transcriber.transcribe(audioBlob);
                    if (text && text.trim().length > 0) insertTextSmart(text);
                }
            };
            recorder.start();
            setTimeout(() => { if (recorder.state === 'recording') recorder.stop(); }, 5000);
        };

        recordSegment();
        recordingInterval = setInterval(() => { if (isRecording) recordSegment(); }, 5010);
    } catch (err) {
        alert("Microfon blocat!");
        stopRecordingLoop();
    }
}

function stopRecordingLoop() {
    isRecording = false;
    if (recordingInterval) { clearInterval(recordingInterval); recordingInterval = null; }
    if (btnMic) { btnMic.innerHTML = "🎙️ REC"; btnMic.classList.remove('rec-active'); }
}

function insertTextSmart(text) {
    if (!editor) return;
    let cleanText = text.trim();
    if (cleanText.length === 0) return;

    const allText = editor.getText();
    const lastChars = allText.slice(-50).trim();
    if (lastChars.endsWith(cleanText)) return;

    const htmlFragment = mdParser.render(cleanText);
    editor.commands.insertContent(htmlFragment);
    editor.commands.scrollIntoView();
    triggerSave(false); 
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
        if (confirm("Ștergi desenul?")) {
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
    
    if (state === 'saving') saveStatus.innerText = "Se salvează...";
    if (state === 'saved') {
        saveStatus.innerText = "Salvat ✔";
        setTimeout(() => { 
            if(saveStatus) saveStatus.classList.remove('visible'); 
        }, 2000);
    }
    if (state === 'error') saveStatus.innerText = "Eroare! ❌";
}

// START
init();