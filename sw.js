importScripts('https://storage.googleapis.com/workbox-cdn/releases/6.4.1/workbox-sw.js');

const CACHE_VERSION = 'v0.3.7';

// Verificăm dacă s-a încărcat Workbox
if (workbox) {
    console.log(`Yay! Workbox is loaded 🎉`);

    // 1. Setări standard ca să preia controlul rapid
    workbox.core.skipWaiting();
    workbox.core.clientsClaim();

    // --- 2. MODIFICAREA MAGICĂ PENTRU UPDATE-URI INSTANT ---
    // Luăm lista de fișiere generată de Workbox
    const manifest = [{"revision":"d794a0a67ed3f30d162bc1839099abd6","url":"assets/apple-touch-icon.png"},{"revision":"b7a9164fd0028248d4aad72c6a7ae794","url":"assets/icon-128.png"},{"revision":"77527ff41aa249dddfee5e56f5a14e2a","url":"assets/icon-192-maskable.png"},{"revision":"75c57c3e679bf4f564d97f31052387d2","url":"assets/icon-192.png"},{"revision":"eb08b90f2f9bdf1bd3955e420b395e1b","url":"assets/icon-256.png"},{"revision":"bff23c735310c8849743627200069bc9","url":"assets/icon-512-maskable.png"},{"revision":"0b1985a79c86ccb329229039d251b45b","url":"assets/icon-512.png"},{"revision":"87dd15af692f4df952a6a015c3c3d734","url":"assets/TC_Dashboard.png"},{"revision":"f930b0f00034024655779787873512e0","url":"assets/TC_Notebook.png"},{"revision":"dc354d7e3a6b716c659c47e049c8cf88","url":"editor.html"},{"revision":"1533072812542393aa372790efa8ca9a","url":"index.html"},{"revision":"65e91d7303e291c728df4de6de43c615","url":"index.js"},{"revision":"5685f8d851aa231b01a32b876d764aca","url":"js/app.js"},{"revision":"d88506fbc1ef638ba81b71354b46340a","url":"js/db.js"},{"revision":"2dc85a12c653c8a50672426bbfc6c0ca","url":"js/editor.js"},{"revision":"ad8f43dbd9b2742cacbf1694de141676","url":"js/sync.js"},{"revision":"70664bc05060f27bf46d68e9a1629e36","url":"js/transcriber.js"},{"revision":"907acbd31d5a654071d0b80f9aa90fbf","url":"js/worker.js"},{"revision":"334e4e948f593582eabafac2c562540f","url":"manifest.json"},{"revision":"f394ba4da33d0a1fd12704b85d8fa22d","url":"package-lock.json"},{"revision":"0d0f0c241a8069c0858fb38f4010ca05","url":"package.json"},{"revision":"a3424b9930a8b24b06cf0c51f5dcd32d","url":"style.css"},{"revision":"87cfc88a08cece82230887074d203f6a","url":"TraduCipri_logo.png"},{"revision":"e0851b38cf3e25d793f243b80965f2fb","url":"workbox-46bb8fb4.js"}];

    if (manifest) {
        // A. Le punem în "Seif" la instalare (pentru Offline garantat)
        workbox.precaching.precache(manifest);

        // B. Le servim cu prioritate de pe NET (NetworkFirst)
        // Asta rezolvă problema ta: vede modificările la CSS/JS imediat!
        workbox.routing.registerRoute(
            ({ url }) => {
                // Verificăm dacă fișierul cerut e unul din lista noastră (index.html, style.css, etc.)
                return manifest.some(entry => url.pathname.endsWith(entry.url));
            },
            new workbox.strategies.NetworkFirst({
                cacheName: 'tradu-cipri-live-files',
                plugins: [
                    new workbox.cacheableResponse.CacheableResponsePlugin({
                        statuses: [0, 200],
                    }),
                ],
            })
        );
    }

    // --- 3. Strategiile Vechi (Rămân la fel, sunt bune) ---

    // Navigare (HTML) -> Network First (Siguranță extra)
    workbox.routing.registerRoute(
        ({request}) => request.mode === 'navigate',
        new workbox.strategies.NetworkFirst({
            cacheName: 'pages-cache',
        })
    );

    // Librării externe (CDN) -> Cache First (Viteză maximă, nu se schimbă des)
    workbox.routing.registerRoute(
        ({url}) => url.origin === 'https://esm.sh' || 
                   url.origin === 'https://fonts.googleapis.com' || 
                   url.origin === 'https://cdn.jsdelivr.net',
        new workbox.strategies.CacheFirst({
            cacheName: 'libs-cache',
            plugins: [
                new workbox.expiration.ExpirationPlugin({
                    maxEntries: 30,
                }),
            ],
        })
    );

    // Modelul AI (HuggingFace) -> Cache First (Să nu-l descarce mereu, e mare)
    // 4. Modelul AI (HuggingFace) -> StaleWhileRevalidate + Plugin-uri Opaque
    // Schimbăm strategia ca să fie mai robustă la descărcare
    workbox.routing.registerRoute(
        ({url}) => url.href.includes('huggingface') || url.href.includes('onnx'),
        new workbox.strategies.StaleWhileRevalidate({
            cacheName: 'ai-models-cache',
            plugins: [
                new workbox.expiration.ExpirationPlugin({
                    maxEntries: 100, // Mai multe fișiere
                    maxAgeSeconds: 365 * 24 * 60 * 60, // 1 an
                }),
                // ASTA E CHEIA: Acceptăm și răspunsuri "Opaque" (status 0)
                new workbox.cacheableResponse.CacheableResponsePlugin({
                    statuses: [0, 200], 
                }),
            ],
        })
    );

} else {
    console.log(`Boo! Workbox didn't load 😬`);
}