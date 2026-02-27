// index.js
import { SyncManager } from './js/sync.js';

// 1. INITIAL CHECK: Check if the user has completed the setup
window.addEventListener('DOMContentLoaded', () => {
    console.log("loaded")
    const userName = localStorage.getItem('traduCipriName');
    const isInstalled = localStorage.getItem('traduCipriInstalled');
    const appContainer = document.getElementById('app-container');
    const wizardOverlay = document.getElementById('welcome-wizard');

    if (userName && isInstalled) {
        if (wizardOverlay) wizardOverlay.style.display = 'none';
        if (appContainer) appContainer.style.display = 'block';
        showDailyGreeting(userName);
    } else {
        if (wizardOverlay) wizardOverlay.style.display = 'flex';
    }

    initSettingsLogic();
});

// --- WIZARD NAVIGATION ---

window.nextStep = (stepNumber) => {
    document.querySelectorAll('.wizard-step').forEach(el => el.classList.remove('active'));
    document.getElementById(`step-${stepNumber}`).classList.add('active');
};

document.getElementById('btn-step-1')?.addEventListener('click', () => nextStep(2));

document.getElementById('btn-step-2')?.addEventListener('click', () => {
    const nameInput = document.getElementById('user-name-input');
    let name = nameInput.value.trim();
    if (!name) name = "Student";
    localStorage.setItem('traduCipriName', name);
    nextStep(3);
    triggerEngineInstall();
});

document.getElementById('btn-step-4')?.addEventListener('click', () => {
    closeWizard();
});

function triggerEngineInstall() {
    let progress = 0;
    const statusText = document.getElementById('install-status');
    const interval = setInterval(() => {
        progress += 5;
        if (statusText) statusText.innerText = `Loading Processing Engine: ${progress}%`;
        if (progress >= 100) {
            clearInterval(interval);
            localStorage.setItem('traduCipriInstalled', 'true');
            setTimeout(() => nextStep(4), 500);
        }
    }, 100);
}

function closeWizard() {
    const overlay = document.getElementById('welcome-wizard');
    const appContainer = document.getElementById('app-container');
    if (overlay) {
        overlay.style.opacity = '0';
        overlay.style.transition = 'opacity 0.5s ease';
        setTimeout(() => {
            overlay.style.display = 'none';
            if (appContainer) appContainer.style.display = 'block';
            const name = localStorage.getItem('traduCipriName');
            showDailyGreeting(name);
        }, 500);
    }
}

// --- SETTINGS & PEERJS SYNC LOGIC ---

function initSettingsLogic() {
    console.log("initsettings")
    const settingsModal = document.getElementById('settings-modal');
    const btnOpenSettings = document.getElementById('btn-open-settings');
    const btnCloseSettings = document.getElementById('btn-close-settings');
    const btnScan = document.getElementById('btn-sync-scan');
    const btnConnect = document.getElementById('btn-sync-connect');

    if (btnOpenSettings && settingsModal) {
        console.log("buttons exist")
        btnOpenSettings.onclick = () => {
            console.log("opening settings and initializing sync...");
            settingsModal.style.display = 'flex';
            SyncManager.init(); // Pornește Sync-ul, face QR-ul și Fingerprint-ul
        };
    }

    if (btnCloseSettings && settingsModal) {
        btnCloseSettings.onclick = () => {
            settingsModal.style.display = 'none';
            SyncManager.stopScanner();
        };
    }

    if (btnScan) {
        btnScan.onclick = () => {
            SyncManager.startScanner();
        };
    }

    // Butonul de conectare manuală - legat direct
    if (btnConnect) {
        btnConnect.onclick = () => {
            const inputField = document.getElementById('sync-peer-input');
            const targetId = inputField.value ? inputField.value.trim() : "";

            if (targetId.length === 6) {
                console.log("Manual connect triggered to:", targetId);
                SyncManager.connect(targetId);
            } else {
                alert("Please enter a valid 6-digit code.");
            }
        };
    }

    window.addEventListener('click', (e) => {
        if (e.target == settingsModal) {
            settingsModal.style.display = 'none';
            SyncManager.stopScanner();
        }
    });
}

// --- GREETING SYSTEM ---

function showDailyGreeting(namee) {
    const hour = new Date().getHours();
    let greeting = "Hello";
    if (hour >= 5 && hour < 12) greeting = "Good morning";
    else if (hour >= 12 && hour < 18) greeting = "Good afternoon";
    else if (hour >= 18 && hour < 22) greeting = "Good evening";
    else greeting = "Happy late-night study session";

    const greetingElement = document.getElementById('app-greeting');
    if (greetingElement) {
        greetingElement.innerText = `${greeting}, ${namee}! 👋`;
        greetingElement.style.animation = "fadeInPage 1s ease";
    }
}