// wizard.js

// 1. Verificăm dacă userul a mai fost aici
window.addEventListener('DOMContentLoaded', () => {
    const userName = localStorage.getItem('traduCipriName');
    const isInstalled = localStorage.getItem('traduCipriInstalled');

    if (userName && isInstalled) {
        // Dacă e deja configurat, ascundem wizard-ul și afișăm salutul în App
        document.getElementById('welcome-wizard').style.display = 'none';
        showDailyGreeting(userName);
    } else {
        // Dacă e prima dată, arătăm wizard-ul
        document.getElementById('welcome-wizard').style.display = 'flex';
    }
});

// Navigare între pași
function nextStep(stepNumber) {
    // Ascundem tot
    document.querySelectorAll('.wizard-step').forEach(el => el.classList.remove('active'));
    // Arătăm pasul curent
    document.getElementById(`step-${stepNumber}`).classList.add('active');
}

// Salvare nume și start instalare
function saveNameAndStart() {
    const nameInput = document.getElementById('user-name-input');
    let name = nameInput.value.trim();
    
    if (!name) name = "Studentule"; // Fallback dacă nu scrie nimic
    
    localStorage.setItem('traduCipriName', name);
    
    // Trecem la pasul 3 (Instalare)
    nextStep(3);
    
    // Aici declanșăm funcția de download din transcriber.js
    // startAIInstallation() este funcția pe care am scris-o în răspunsul anterior
    // Trebuie să o adaptezi să updateze bara din #step-3
    triggerAIInstall(); 
}

// Funcție simulată pentru demo (o înlocuiești cu cea reală de pipeline)
function triggerAIInstall() {
    let progress = 0;
    const interval = setInterval(() => {
        progress += 5;
        document.getElementById('progress-fill').style.width = `${progress}%`;
        document.getElementById('percent-text').innerText = `${progress}%`;
        
        if(progress >= 100) {
            clearInterval(interval);
            localStorage.setItem('traduCipriInstalled', 'true');
            setTimeout(() => nextStep(4), 500); // Mergem la final
        }
    }, 100); // Asta e doar vizual, în realitate se leagă de download
}

function closeWizard() {
    const overlay = document.getElementById('welcome-wizard');
    overlay.style.opacity = '0';
    overlay.style.transition = 'opacity 0.5s';
    setTimeout(() => {
        overlay.style.display = 'none';
        // Afișăm salutul imediat după ce intră
        const name = localStorage.getItem('traduCipriName');
        showDailyGreeting(name);
    }, 500);
}

// --- SISTEMUL DE SALUT (Greeting System) ---
// Asta o pui în main.js să ruleze undeva în UI-ul principal (header)

function showDailyGreeting(name) {
    const hour = new Date().getHours();
    let greeting = "Salut";

    if (hour >= 5 && hour < 12) greeting = "Bună dimineața";
    else if (hour >= 12 && hour < 18) greeting = "Salutare";
    else if (hour >= 18 && hour < 22) greeting = "Bună seara";
    else greeting = "Spor la învățat noaptea";

    // Găsește un element în pagina principală unde să pui asta
    const greetingElement = document.getElementById('app-greeting');
    if (greetingElement) {
        greetingElement.innerText = `${greeting}, ${name}! 👋`;
        // Putem adăuga o animație css de fade-in pe text
        greetingElement.style.animation = "fadeIn 1s ease";
    }
}