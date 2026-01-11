// js/app.js
import { transcriber } from './transcriber.js';
import { NotebookManager } from './db.js';

if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        // Înregistrăm fișierul generat de Workbox
        navigator.serviceWorker.register('./sw.js').then(registration => {
            console.log('✅ Service Worker înregistrat cu succes:', registration.scope);

            // Ascultăm dacă apare o versiune nouă
            registration.onupdatefound = () => {
                const installingWorker = registration.installing;
                if (installingWorker == null) return;
                
                installingWorker.onstatechange = () => {
                    if (installingWorker.state === 'installed') {
                        if (navigator.serviceWorker.controller) {
                            // Update disponibil
                            console.log('🔄 Conținut nou disponibil. Se face refresh...');
                            window.location.reload();
                        } else {
                            console.log('✅ Conținutul a fost salvat pentru offline!');
                        }
                    }
                };
            };
        }).catch(error => {
            console.log('❌ Eroare la înregistrare SW:', error);
        });
    });
}

// --- 1. INITIALIZARE & ROUTING ---

async function initApp() {
    console.log("🚀 App Initializing...");
    
    const isInstalled = localStorage.getItem('traduCipriInstalled');
    const userName = localStorage.getItem('traduCipriName');

    if (!isInstalled) {
        // Modul WIZARD (Prima dată)
        document.getElementById('welcome-wizard').style.display = 'flex';
        document.getElementById('app-container').style.display = 'none';
        setupWizardEvents();
    } else {
        // Modul DASHBOARD (Normal)
        document.getElementById('welcome-wizard').style.display = 'none';
        document.getElementById('app-container').style.display = 'block';
        
        showDailyGreeting(userName || 'Studentule');
        setupDashboardEvents(); // Legăm butoanele principale
        await loadDashboard();  // Încărcăm caietele
        
        transcriber.init(); // Pornim AI-ul în background
    }
}

// --- EXPORT & IMPORT ---
// (Le-am mutat aici ca să fie activate la pornire)

const btnExport = document.getElementById('btn-export');
if (btnExport) {
    btnExport.onclick = async () => {
        const data = await NotebookManager.exportAllData();
        const blob = new Blob([data], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        
        const a = document.createElement('a');
        a.href = url;
        a.download = `TraduCipri_Backup_${new Date().toISOString().slice(0,10)}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    };
}

const fileInput = document.getElementById('file-import');
const btnImport = document.getElementById('btn-import-trigger');

if (btnImport && fileInput) {
    btnImport.onclick = () => fileInput.click();

    fileInput.onchange = (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = async (event) => {
            const jsonContent = event.target.result;
            const success = await NotebookManager.importData(jsonContent);
            
            if (success) {
                alert("Date restaurate cu succes! Pagina se va reîncărca.");
                location.reload();
            } else {
                alert("Fișier corupt sau invalid.");
            }
        };
        reader.readAsText(file);
    };
}


// --- 2. LOGICA DASHBOARD (Caiete, Modal, Duplicate, Delete) ---

function setupDashboardEvents() {
    console.log("Setting up dashboard events...");

    // 1. Butonul Plutitor (+)
    const btnNew = document.getElementById('btn-new-notebook');
    if(btnNew) {
        btnNew.onclick = openCreateModal;
    }

    // 2. Butonul Anulează (din Modal)
    const btnCancel = document.getElementById('btn-cancel-modal');
    if(btnCancel) {
        btnCancel.onclick = closeCreateModal;
    }

    // 3. Butonul Confirmă (din Modal)
    const btnConfirm = document.getElementById('btn-confirm-create');
    if(btnConfirm) {
        btnConfirm.onclick = async () => {
            const input = document.getElementById('notebook-title');
            const title = input.value.trim() || "Caiet Fără Titlu";
            
            await NotebookManager.create(title);
            closeCreateModal();
            await loadDashboard(); 
        };
    }
}   

// Funcții Modal
function openCreateModal() {
    const modal = document.getElementById('create-modal');
    const input = document.getElementById('notebook-title');
    modal.style.display = 'flex';
    input.value = ''; 
    input.focus();
}

function closeCreateModal() {
    document.getElementById('create-modal').style.display = 'none';
}

// Variabilă globală să ținem minte pe ce caiet am ținut apăsat
let activeNotebookId = null;

// --- Funcția de randare actualizată ---
export async function loadDashboard() {
    const listContainer = document.getElementById('notebook-list');
    if (!listContainer) return;

    listContainer.innerHTML = ''; 
    const notebooks = await NotebookManager.getAll();
    
    if (notebooks.length === 0) {
        listContainer.innerHTML = '<p style="color:white; opacity:0.6; text-align:center;">Nu ai niciun caiet. Apasă pe +</p>';
        return;
    }

    notebooks.reverse().forEach(note => {
        const card = document.createElement('div');
        card.className = `notebook-card theme-${note.theme || 'default'}`;
        // Salvăm ID-ul direct pe element ca să-l găsim ușor
        card.dataset.id = note.id; 
        
        // Păstrăm butoanele VECHI doar pentru Desktop (ascunse din CSS pe mobil)
        card.innerHTML = `
            <div class="card-actions desktop-only">
                <button class="action-btn btn-dup">❐</button>
                <button class="action-btn btn-delete">🗑️</button>
            </div>
            <div class="card-icon">📓</div>
            <div class="card-info">
                <h3>${note.title}</h3>
                <span class="date">${new Date(note.updatedAt).toLocaleDateString('ro-RO')}</span>
            </div>
        `;
        
        // Logică Click Normal (Deschide)
        card.onclick = () => openEditor(note.id);

        // Logică Butoane Desktop (Event Bubbling)
        const btnDup = card.querySelector('.btn-dup');
        const btnDel = card.querySelector('.btn-delete');
        
        btnDup.onclick = (e) => { e.stopPropagation(); duplicateNotebook(note); };
        btnDel.onclick = (e) => { 
            e.stopPropagation(); 
            if(confirm(`Stergi "${note.title}"?`)) { NotebookManager.delete(note.id).then(loadDashboard); }
        };
        
        listContainer.appendChild(card);
    });

    // Activăm senzorii de atingere
    activateMobileLongPress();
}


// --- LOGICA DE BOTTOM SHEET (NOUA) ---

function activateMobileLongPress() {
    if (!('ontouchstart' in window)) return; // Doar pe mobil

    const cards = document.querySelectorAll('.notebook-card');
    const sheetOverlay = document.getElementById('mobile-sheet-overlay');

    // Setup butoane din Meniul de Jos (o singură dată)
    if (!sheetOverlay.dataset.init) {
        sheetOverlay.dataset.init = "true"; // Marcam că le-am legat deja
        
        document.getElementById('sheet-cancel').onclick = closeSheet;
        sheetOverlay.onclick = (e) => {
            if(e.target === sheetOverlay) closeSheet(); // Click pe fundal închide
        };

        // BUTON DUPLICĂ (DIN SHEET)
        document.getElementById('sheet-dup').onclick = async () => {
            if (!activeNotebookId) return;
            const notes = await NotebookManager.getAll();
            const targetNote = notes.find(n => n.id === activeNotebookId);
            if(targetNote) await duplicateNotebook(targetNote);
            closeSheet();
        };

        // BUTON ȘTERGE (DIN SHEET)
        document.getElementById('sheet-del').onclick = async () => {
            if (!activeNotebookId) return;
            if (confirm("Sigur ștergi acest caiet?")) {
                await NotebookManager.delete(activeNotebookId);
                await loadDashboard();
            }
            closeSheet();
        };
    }

    // Loop pe carduri pentru Long Press
    cards.forEach(card => {
        let pressTimer;
        
        card.addEventListener('touchstart', (e) => {
            pressTimer = setTimeout(() => {
                // S-a declanșat Long Press!
                if (navigator.vibrate) navigator.vibrate(50);
                
                activeNotebookId = parseInt(card.dataset.id); // Salvăm ID-ul
                openSheet(); // Deschidem meniul
                
            }, 600);
        }, { passive: true });

        const cancel = () => clearTimeout(pressTimer);
        card.addEventListener('touchend', cancel);
        card.addEventListener('touchmove', cancel);
        
        // Blocăm click-ul normal dacă meniul e deschis
        card.addEventListener('contextmenu', e => {
            e.preventDefault(); // Oprește meniul de click dreapta al browserului
        });
    });
}

// Helper Functions pentru Sheet
function openSheet() {
    const sheet = document.getElementById('mobile-sheet-overlay');
    sheet.style.display = 'flex'; // Asigurăm că e vizibil
    // Mic delay ca să prindă animația CSS
    setTimeout(() => { sheet.classList.add('active'); }, 10);
}

function closeSheet() {
    const sheet = document.getElementById('mobile-sheet-overlay');
    sheet.classList.remove('active');
    setTimeout(() => { sheet.style.display = 'none'; }, 300); // Așteptăm animația
}

// Funcția de Duplicare
async function duplicateNotebook(originalNote) {
    const copy = { ...originalNote }; 
    delete copy.id; 
    
    copy.title = `${copy.title} (Copie)`;
    copy.updatedAt = new Date();
    copy.createdAt = new Date();
    
    await NotebookManager.add(copy); 
    await loadDashboard();
}

function showDailyGreeting(name) {
    const hour = new Date().getHours();
    let greeting = "Salut";
    if (hour >= 5 && hour < 12) greeting = "Neața";
    else if (hour >= 12 && hour < 18) greeting = "Salutare";
    else if (hour >= 18 && hour < 22) greeting = "Bună seara";
    
    const el = document.getElementById('app-greeting');
    if(el) el.innerText = `${greeting}, ${name}! 👋`;
}

function openEditor(id) {
    window.location.href = `editor.html?id=${id}`;
}

// --- 3. LOGICA WIZARD (Instalare) ---

function setupWizardEvents() {
    // Pasul 1
    document.getElementById('btn-step-1').onclick = () => {
        const savedName = localStorage.getItem('traduCipriName');
        if (savedName) {
            nextStep(3);
            triggerAIInstall(); 
        } else {
            nextStep(2);
        }
    };

    // Pasul 2
    document.getElementById('btn-step-2').onclick = () => {
        saveNameAndStart(); 
    };

    // Pasul 4
    document.getElementById('btn-step-4').onclick = () => closeWizard();
}

function nextStep(stepNumber) {
    document.querySelectorAll('.wizard-step').forEach(el => el.classList.remove('active'));
    const nextEl = document.getElementById(`step-${stepNumber}`);
    if(nextEl) nextEl.classList.add('active');
}

async function saveNameAndStart() {
    const input = document.getElementById('user-name-input');
    const name = input.value.trim() || 'Studentule';
    localStorage.setItem('traduCipriName', name);
    nextStep(3);
    await triggerAIInstall();
}

async function triggerAIInstall() {
    const listContainer = document.getElementById('download-list');
    const statusText = document.getElementById('install-status');

    statusText.innerText = "Conectare Worker...";

    const filesTracker = {}; 

    const success = await transcriber.install((percent, fileName) => {
        if (!fileName) return;

        if (!filesTracker[fileName]) {
            const rowId = `file-${fileName.replace(/[^a-zA-Z0-9]/g, '')}`;
            filesTracker[fileName] = rowId;
            
            let friendlyName = fileName;
            if(fileName.includes('onnx')) friendlyName = "🧠 Creier AI (Model)";
            else if(fileName.includes('tokenizer')) friendlyName = "📖 Dicționar";
            
            const html = `
                <div id="${rowId}" class="file-row">
                    <div class="file-info">
                        <span>${friendlyName}</span>
                        <span class="percent-label">0%</span>
                    </div>
                    <div class="file-track">
                        <div class="file-bar"></div>
                    </div>
                </div>
            `;
            listContainer.insertAdjacentHTML('beforeend', html);
        }

        const rowId = filesTracker[fileName];
        const rowEl = document.getElementById(rowId);
        if (rowEl) {
            const bar = rowEl.querySelector('.file-bar');
            const label = rowEl.querySelector('.percent-label');
            
            bar.style.width = `${percent}%`;
            label.innerText = `${Math.round(percent)}%`;

            if (Math.round(percent) >= 100) {
                bar.classList.add('done');
                label.innerText = "Gata";
                label.style.color = "#10b981";
            }
        }
    });

    if (success) {
        localStorage.setItem('traduCipriInstalled', 'true');
        statusText.innerText = "Instalare Completă! 🚀";
        statusText.style.color = "#10b981";
        setTimeout(() => nextStep(4), 1000);
    } else {
        statusText.innerText = "Eroare instalare.";
    }
}

function closeWizard() {
    const overlay = document.getElementById('welcome-wizard');
    overlay.style.opacity = '0';
    setTimeout(() => {
        overlay.style.display = 'none';
        initApp(); 
    }, 500);
}

// Start App
initApp();