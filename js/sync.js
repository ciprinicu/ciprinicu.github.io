// js/sync.js
let peer = null;
let html5QrCode = null;

export const SyncManager = {
    init() {
        // Generăm ID-ul pentru device-ul CURENT (cel care afișează QR-ul)
        const myId = Math.floor(100000 + Math.random() * 900000).toString();
        const display = document.getElementById('my-peer-id');
        if (display) display.innerText = myId;

        peer = new Peer(myId);

        peer.on('open', (id) => {
            const qrContainer = document.getElementById('qr-container');
            if (qrContainer && window.QRCode) {
                qrContainer.innerHTML = '';
                new QRCode(qrContainer, {
                    text: id,
                    width: 160,
                    height: 160,
                    correctLevel: QRCode.CorrectLevel.H // Nivel ridicat de eroare pentru scanare rapidă
                });
            }
        });

        // Ascultăm conexiunile (Device-ul care primește datele)
        peer.on('connection', (conn) => {
            conn.on('data', async (data) => {
                if (data.type === 'SYNC_ALL_DATA') {
                    // Mesaj scurt de confirmare și gata
                    if (confirm("New notebooks detected! Sync now?")) {
                        const success = await window.NotebookManager.importData(data.payload);
                        if (success) location.reload();
                    }
                }
            });
        });
    },

    // --- CAMERA SCANNER (AUTOMAT) ---
    async startScanner() {
        const qrRegion = document.getElementById('qr-reader');
        qrRegion.style.display = 'block';

        html5QrCode = new Html5Qrcode("qr-reader");

        const config = {
            fps: 15, // Mai multe cadre pe secundă pentru viteză
            qrbox: { width: 250, height: 250 }
        };

        try {
            await html5QrCode.start(
                { facingMode: "environment" },
                config,
                (decodedText) => {
                    // === AUTOMATIZAREA E AICI ===
                    console.log("Code found: " + decodedText);

                    // 1. Oprim camera imediat ca să nu consume baterie
                    this.stopScanner();

                    // 2. Ne conectăm automat la ID-ul scanat
                    this.connect(decodedText);
                }
            );
        } catch (err) {
            console.error("Camera error:", err);
            qrRegion.style.display = 'none';
        }
    },

    stopScanner() {
        if (html5QrCode) {
            html5QrCode.stop().then(() => {
                document.getElementById('qr-reader').style.display = 'none';
            }).catch(() => { });
        }
    },

    async connect(targetId) {
        if (!peer) return;

        // Feedback vizual că se întâmplă ceva
        const status = document.getElementById('my-peer-id');
        if (status) status.innerText = "CONNECTING...";

        const conn = peer.connect(targetId);

        conn.on('open', async () => {
            try {
                const allData = await window.NotebookManager.exportAllData();
                conn.send({
                    type: 'SYNC_ALL_DATA',
                    payload: allData
                });
                alert("Sync Successful! Data sent.");
            } catch (err) {
                alert("Export failed.");
            }
        });

        conn.on('error', () => alert("Connection failed. Try again."));
    }
};