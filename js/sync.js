// js/sync.js
let peer = null;
let html5QrCode = null;

async function getDeviceInfo() {
    const ua = navigator.userAgent;
    let deviceName = "Unknown Device";
    if (/android/i.test(ua)) deviceName = "Android Phone";
    else if (/iPad|iPhone|iPod/.test(ua)) deviceName = "iPhone/iPad";
    else if (/Macintosh/.test(ua)) deviceName = "MacBook";
    else if (/Windows/.test(ua)) deviceName = "Windows PC";
    else if (/Linux/.test(ua)) deviceName = "Linux System";
    return deviceName;
}

async function generateDeviceSeed() {
    let uniqueBrowserId = localStorage.getItem('traduCipri_unique_sid');
    if (!uniqueBrowserId) {
        uniqueBrowserId = Math.random().toString(36).substring(2, 15);
        localStorage.setItem('traduCipri_unique_sid', uniqueBrowserId);
    }
    const info = [navigator.hardwareConcurrency || 4, screen.width + "x" + screen.height, uniqueBrowserId].join('|');
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

        peer.on('open', () => {
            const qrContainer = document.getElementById('qr-container');
            if (qrContainer && window.QRCode) {
                qrContainer.innerHTML = '';
                new QRCode(qrContainer, { text: myId, width: 160, height: 160 });
            }
            this.renderQuickSyncButton();
        });

        peer.on('connection', (conn) => {
            conn.on('data', async (data) => {
                if (data.type === 'REQUEST_DATA') {
                    const allData = await window.NotebookManager.exportAllData();
                    const deviceName = await getDeviceInfo();
                    conn.send({
                        type: 'SEND_DATA_BACK',
                        payload: allData,
                        senderName: deviceName
                    });
                }
            });
        });
    },

    renderQuickSyncButton() {
        const lastId = localStorage.getItem('lastSyncPeerId');
        const lastName = localStorage.getItem('lastSyncPeerName') || "Device";
        const container = document.getElementById('quick-sync-container');
        if (!container) return;

        if (lastId) {
            container.innerHTML = `
                <div class="quick-sync-card">
                    <p class="small-label">Last Device: <strong>${lastName} (${lastId})</strong></p>
                    <button id="btn-quick-sync" class="btn-primary">⚡ Quick Sync</button>
                </div>
            `;
            document.getElementById('btn-quick-sync').onclick = () => this.connect(lastId);
        }
    },

    async connect(targetId) {
        if (!peer) return;
        const conn = peer.connect(targetId);
        conn.on('open', () => {
            localStorage.setItem('lastSyncPeerId', targetId);
            conn.send({ type: 'REQUEST_DATA' });
        });

        conn.on('data', async (data) => {
            if (data.type === 'SEND_DATA_BACK') {
                localStorage.setItem('lastSyncPeerName', data.senderName);
                this.showSyncPreview(data.payload, data.senderName);
            }
        });
    },

    showSyncPreview(jsonString, deviceName) {
        const data = JSON.parse(jsonString);
        const notebooks = data.notebooks || [];

        // Create the popup dynamically
        const overlay = document.createElement('div');
        overlay.className = 'sync-preview-overlay';

        let listHtml = notebooks.map(n => `
            <div class="preview-item">
                <span>${n.title || 'Untitled'}</span>
                <small>${new Date(n.updatedAt).toLocaleDateString()}</small>
            </div>
        `).join('');

        overlay.innerHTML = `
            <div class="sync-preview-modal">
                <h3>Sync from ${deviceName}</h3>
                <p>The following notebooks will be imported:</p>
                <div class="preview-list">${listHtml}</div>
                <div class="preview-actions">
                    <button id="confirm-sync" class="btn-primary">Import Everything</button>
                    <button id="cancel-sync" class="btn-secondary">Cancel</button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);

        document.getElementById('confirm-sync').onclick = async () => {
            const success = await window.NotebookManager.importData(jsonString);
            if (success) location.reload();
        };
        document.getElementById('cancel-sync').onclick = () => overlay.remove();
    },

    async startScanner() {
        const qrRegion = document.getElementById('qr-reader');
        qrRegion.style.display = 'block';
        html5QrCode = new Html5Qrcode("qr-reader");
        try {
            await html5QrCode.start({ facingMode: "environment" }, { fps: 15, qrbox: 250 },
                (decodedText) => { this.stopScanner(); this.connect(decodedText); });
        } catch (err) { qrRegion.style.display = 'none'; }
    },

    stopScanner() {
        if (html5QrCode) {
            html5QrCode.stop().then(() => {
                document.getElementById('qr-reader').style.display = 'none';
            }).catch(() => { });
        }
    }
};