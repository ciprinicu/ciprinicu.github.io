// js/app.js
import { transcriber } from './transcriber.js';
import { NotebookManager } from './db.js';

if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        // Înregistrăm fișierul generat de Workbox (sw.js, nu src-sw.js!)
        navigator.serviceWorker.register('./sw.js').then(registration => {
            console.log('✅ Service Worker înregistrat cu succes:', registration.scope);

            // Ascultăm dacă apare o versiune nouă
            registration.onupdatefound = () => {
                const installingWorker = registration.installing;
                if (installingWorker == null) {
                    return;
                }
                installingWorker.onstatechange = () => {
                    if (installingWorker.state === 'installed') {
                        if (navigator.serviceWorker.controller) {
                            // AICI E MAGIA:
                            // Dacă avem deja un SW activ și a apărut unul nou, 
                            // înseamnă că e un update. Dăm refresh!
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

    // În setupDashboardEvents() sau initApp()

// --- EXPORT ---
document.getElementById('btn-export').onclick = async () => {
    const data = await NotebookManager.exportAllData();
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    
    // Creăm un link invizibil să downloadăm fișierul
    const a = document.createElement('a');
    a.href = url;
    a.download = `TraduCipri_Backup_${new Date().toISOString().slice(0,10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
};

// --- IMPORT ---
const fileInput = document.getElementById('file-import');
const btnImport = document.getElementById('btn-import-trigger');

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
    } else {
        console.warn("Butonul 'btn-new-notebook' lipsește din HTML!");
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

// Funcția principală care randează lista
export async function loadDashboard() {
    const listContainer = document.getElementById('notebook-list');
    if (!listContainer) return;

    listContainer.innerHTML = ''; 
    
    const notebooks = await NotebookManager.getAll();
    
    if (notebooks.length === 0) {
        listContainer.innerHTML = '<p style="color:white; opacity:0.6; text-align:center; width:100%;">Nu ai niciun caiet. Apasă pe +</p>';
        return;
    }

    // Le parcurgem invers (cele noi sus)
    notebooks.reverse().forEach(note => {
        const card = document.createElement('div');
        card.className = `notebook-card theme-${note.theme || 'default'}`;
        
        card.innerHTML = `
            <div class="card-actions">
                <button class="action-btn btn-dup" title="Duplică">❐</button>
                <button class="action-btn btn-delete" title="Șterge">🗑️</button>
            </div>
            <div class="card-icon">📓</div>
            <div class="card-info">
                <h3>${note.title}</h3>
                <span class="date">${new Date(note.updatedAt).toLocaleDateString('ro-RO')}</span>
            </div>
        `;
        
        // 1. CLICK PE CARD -> Deschide Editorul
        card.onclick = () => openEditor(note.id);

        // 2. CLICK PE DUPLICATE (oprim propagarea să nu deschidă editorul)
        const btnDup = card.querySelector('.btn-dup');
        btnDup.onclick = async (e) => {
            e.stopPropagation();
            await duplicateNotebook(note);
        };

        // 3. CLICK PE DELETE
        const btnDel = card.querySelector('.btn-delete');
        btnDel.onclick = async (e) => {
            e.stopPropagation();
            if(confirm(`Sigur ștergi caietul "${note.title}"?`)) {
                await NotebookManager.delete(note.id);
                loadDashboard();
            }
        };
        
        listContainer.appendChild(card);
    });
}

// Funcția de Duplicare
async function duplicateNotebook(originalNote) {
    const copy = { ...originalNote }; // Copiem obiectul
    delete copy.id; // Ștergem ID-ul vechi (DB-ul va pune unul nou)
    
    copy.title = `${copy.title} (Copie)`;
    copy.updatedAt = new Date();
    copy.createdAt = new Date();
    
    await NotebookManager.add(copy); // Folosim metoda add din db.js
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
// Rămâne neschimbată, doar o includem pentru când e prima dată

function setupWizardEvents() {
    // Pasul 1: Bun venit -> Verificăm dacă știm numele
    document.getElementById('btn-step-1').onclick = () => {
        const savedName = localStorage.getItem('traduCipriName');
        
        if (savedName) {
            // Îl știm! Sărim direct la Pasul 3 (Download)
            console.log("Nume găsit (" + savedName + "), sărim peste pasul 2.");
            nextStep(3);
            triggerAIInstall(); // Pornim download-ul imediat
        } else {
            // Nu-l știm, mergem la Pasul 2 (Să ne zică numele)
            nextStep(2);
        }
    };

    // Pasul 2: Salvare Nume -> Pasul 3
    document.getElementById('btn-step-2').onclick = () => {
        saveNameAndStart(); // Asta salvează și apoi trece la 3 și triggerAIInstall
    };

    // Pasul 4: Final -> Închide
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

    // AICI E SCHIMBAREA: Callback-ul primește direct (percent, fileName)
    const success = await transcriber.install((percent, fileName) => {
        
        // Logica de afișare rămâne la fel, doar că folosim parametrii direcți
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
        initApp(); // Repornim aplicația să intre în dashboard
    }, 500);
}

// Start
initApp();