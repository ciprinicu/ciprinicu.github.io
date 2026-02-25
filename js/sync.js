// js/sync.js
let peer = null;
let html5QrCode = null;

async function generateDeviceSeed() {
    let uniqueBrowserId = localStorage.getItem('traduCipri_unique_sid');
    if (!uniqueBrowserId) {
        uniqueBrowserId = Math.random().toString(36).substring(2, 15);
        localStorage.setItem('traduCipri_unique_sid', uniqueBrowserId);
    }

    const info = [
        navigator.hardwareConcurrency || 4,
        screen.width + "x" + screen.height,
        uniqueBrowserId
    ].join('|');

    let hash = 0;
    for (let i = 0; i < info.length; i++) {
        hash = ((hash << 5) - hash) + info.charCodeAt(i);
        hash |= 0;
    }
    return Math.abs(hash).toString().substring(0, 6).padEnd(6, '0');
}

export const SyncManager = {
    async init() {
        const myId = await generateDeviceSeed();
        const display = document.getElementById('my-peer-id');
        if (display) display.innerText = myId;

        if (peer && !peer.destroyed) return;

        peer = new Peer(myId);

        peer.on('open', (id) => {
            const qrContainer = document.getElementById('qr-container');
            if (qrContainer && window.QRCode) {
                qrContainer.innerHTML = '';
                new QRCode(qrContainer, {
                    text: id,
                    width: 160,
                    height: 160,
                    correctLevel: QRCode.CorrectLevel.H
                });
            }
            this.renderQuickSyncButton();
        });

        peer.on('connection', (conn) => {
            conn.on('data', async (data) => {
                if (data.type === 'REQUEST_DATA') {
                    const allData = await window.NotebookManager.exportAllData();
                    conn.send({ type: 'SEND_DATA_BACK', payload: allData });
                }
            });
        });
    },

    // Aici e șmecheria: randează butonul dacă avem "memorie"
    renderQuickSyncButton() {
        const lastId = localStorage.getItem('lastSyncPeerId');
        const container = document.getElementById('quick-sync-container');
        if (!container) return;

        if (lastId) {
            container.innerHTML = `
                <div style="margin-top: 20px; padding: 15px; background: rgba(255,255,255,0.05); border-radius: 12px; text-align: center;">
                    <p style="font-size: 0.8rem; opacity: 0.7; margin-bottom: 10px;">Ultimul device: ${lastId}</p>
                    <button id="btn-quick-sync" class="btn-primary" style="width: 100%;">
                        ⚡ Quick Sync
                    </button>
                </div>
            `;
            document.getElementById('btn-quick-sync').onclick = () => this.connect(lastId);
        } else {
            container.innerHTML = '';
        }
    },

    async connect(targetId) {
        if (!peer) return;

        // Feedback vizual
        const btn = document.getElementById('btn-quick-sync');
        if (btn) btn.innerText = "Connecting...";

        const conn = peer.connect(targetId);

        conn.on('open', () => {
            localStorage.setItem('lastSyncPeerId', targetId);
            conn.send({ type: 'REQUEST_DATA' });
        });

        conn.on('data', async (data) => {
            if (data.type === 'SEND_DATA_BACK') {
                const confirmSync = confirm("Am primit datele. Le importăm?");
                if (confirmSync) {
                    const success = await window.NotebookManager.importData(data.payload);
                    if (success) location.reload();
                }
            }
        });

        conn.on('error', () => {
            alert("Nu mă pot conecta. Verifică dacă laptopul are setările deschise.");
            if (btn) btn.innerText = "⚡ Quick Sync";
        });
    },

    async startScanner() {
        const qrRegion = document.getElementById('qr-reader');
        qrRegion.style.display = 'block';
        html5QrCode = new Html5Qrcode("qr-reader");

        try {
            await html5QrCode.start(
                { facingMode: "environment" },
                { fps: 15, qrbox: 250 },
                (decodedText) => {
                    this.stopScanner();
                    this.connect(decodedText);
                }
            );
        } catch (err) {
            qrRegion.style.display = 'none';
        }
    },

    stopScanner() {
        if (html5QrCode) {
            html5QrCode.stop().then(() => {
                document.getElementById('qr-reader').style.display = 'none';
            }).catch(() => { });
        }
    }
};