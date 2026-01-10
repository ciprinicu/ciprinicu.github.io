import { transcriber } from './transcriber.js';
import { NotebookManager, dbPromise } from './db.js';

// --- IMPORTURI TIPTAP & EXTENSII (Image inclusă) ---
import { Editor } from 'https://esm.sh/@tiptap/core';
import StarterKit from 'https://esm.sh/@tiptap/starter-kit';
import Placeholder from 'https://esm.sh/@tiptap/extension-placeholder';
import ImageExtension from 'https://esm.sh/@tiptap/extension-image'; // <--- AICI ERA LIPSA
import MarkdownIt from 'https://esm.sh/markdown-it';

// --- CONFIGURARE GLOBALĂ ---
let editor = null;
const mdParser = new MarkdownIt(); 

// Elemente DOM - Editor & Desen
const titleInput = document.getElementById('doc-title');
const btnMic = document.getElementById('btn-mic');
const canvas = document.getElementById('draw-layer');
const sheet = document.getElementById('scroll-container'); // Pt Infinite Scroll
const paperBg = document.getElementById('scroll-container');
const btnDraw = document.getElementById('btn-draw-mode');
const btnClear = document.getElementById('btn-clear-draw');

// Elemente DOM - Imagini (NOU)
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
    // Verificăm instalarea
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
                ImageExtension, // <--- Activăm suportul pentru poze
                Placeholder.configure({
                    placeholder: 'Scrie, dictează sau pune o poză...',
                }),
            ],
            content: '', 
            onUpdate: ({ editor }) => {
                saveNote();
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
        // Populăm datele
    if (titleInput) titleInput.value = currentNote.title;
    
    // --- FIX PENTRU TEXTUL NEFORMATAT ---
    if (currentNote.content && editor) {
        // Verificăm dacă e text vechi (Markdown) sau nou (HTML)
        // Dacă nu are tag-uri HTML (<p>, <h1>) dar are simboluri (#, **), e clar Markdown brut.
        const seemsLikeMarkdown = !currentNote.content.trim().startsWith('<') && 
                                  (currentNote.content.includes('#') || currentNote.content.includes('**'));

        if (seemsLikeMarkdown) {
            console.log("🔄 Detectat Markdown vechi -> Convertim în HTML...");
            // Îl traducem pe loc ca să apară frumos (H1, Bold, Liste)
            const parsedHtml = mdParser.render(currentNote.content);
            editor.commands.setContent(parsedHtml);
        } else {
            // E deja HTML (salvat corect de TipTap), îl punem direct
            editor.commands.setContent(currentNote.content);
        }
    }
    }

    // Încărcăm desenul + Resize pentru ecran complet
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
            saveNote();
        });
    }

    // Focus pe editor
    if (paperBg) {
        paperBg.onclick = (e) => {
            if(e.target.id === 'scroll-container' && editor) editor.commands.focus();
        }
    }
}

// --- 2. LOGICA PENTRU IMAGINI (ODATĂ APĂSAT BUTONUL) ---

if (btnAddImg && imgInput) {
    // 1. Click pe buton -> Deschide selectorul nativ
    btnAddImg.onclick = () => {
        imgInput.click();
    };

    // 2. Când utilizatorul alege poza
    imgInput.onchange = (event) => {
        const file = event.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        
        // Citim fișierul și îl facem Base64
        reader.onload = (e) => {
            const result = e.target.result;
            
            if (editor) {
                // Inserăm imaginea în TipTap
                editor.chain().focus().setImage({ src: result }).run();
                // Dăm un scroll mic să se vadă
                editor.commands.scrollIntoView();
                // Salvăm
                saveNote();
            }
        };
        
        reader.readAsDataURL(file);
        imgInput.value = ''; // Resetăm input-ul
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
        recordingInterval = setInterval(() => { if (isRecording) recordSegment(); }, 5100); 
    } catch (err) {
        alert("Microfon blocat!");
        stopRecordingLoop();
    }
}

function stopRecordingLoop() {
    isRecording = false;
    if (recordingInterval) { clearInterval(recordingInterval); recordingInterval = null; }
    if(btnMic) { btnMic.innerHTML = "🎙️ REC"; btnMic.classList.remove('rec-active'); }
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
}

// --- 4. LOGICA DESEN ---

if (btnDraw && canvas) {
    btnDraw.onclick = () => {
        isDrawingMode = !isDrawingMode;
        if (isDrawingMode) {
            btnDraw.classList.add('active');
            canvas.style.pointerEvents = 'auto'; 
            if(editor) editor.setEditable(false); 
            if(document.querySelector('.editor-content')) document.querySelector('.editor-content').style.opacity = '0.5';
        } else {
            btnDraw.classList.remove('active');
            canvas.style.pointerEvents = 'none';
            if(editor) editor.setEditable(true);
            if(document.querySelector('.editor-content')) document.querySelector('.editor-content').style.opacity = '1';
            saveDrawing();
        }
    };
}

let painting = false;
function startPosition(e) { painting = true; draw(e); }
function finishedPosition() { painting = false; if(ctx) ctx.beginPath(); }
function draw(e) {
    if (!painting || !isDrawingMode || !ctx) return;
    
    // Coordonatele pentru Infinite Canvas
    const x = e.clientX; 
    const y = e.clientY + sheet.scrollTop; // + Scroll offset

    if(y < 65) return; // Protecție toolbar

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
        if(confirm("Ștergi desenul?")) {
            if(ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
            saveDrawing();
        }
    };
}

// --- 5. HELPERS (ADAPTAȚI PT FULL SCREEN) ---

function resizeCanvas(preserve = false) {
    if (!canvas || !sheet) return;
    
    // Calculăm înălțimea totală (inclusiv ce e ascuns de scroll)
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
            if(ctx) ctx.drawImage(img, 0, 0);
        };
    } else {
        canvas.width = newWidth;
        canvas.height = newHeight;
    }
}

async function saveNote() {
    if (!currentNote || !editor) return;
    const db = await dbPromise;
    const note = await db.get('notebooks', noteId);
    note.content = editor.getHTML(); 
    if(titleInput) note.title = titleInput.value;
    note.updatedAt = new Date();
    await db.put('notebooks', note);
}

async function saveDrawing() {
    if (!currentNote || !canvas) return;
    const db = await dbPromise;
    const note = await db.get('notebooks', noteId);
    note.drawing = canvas.toDataURL();
    await db.put('notebooks', note);
}

// START
init();