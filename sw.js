importScripts('https://storage.googleapis.com/workbox-cdn/releases/6.4.1/workbox-sw.js');

// Verificăm dacă s-a încărcat Workbox
if (workbox) {
    console.log(`Yay! Workbox is loaded 🎉`);

    // 1. Setări standard ca să preia controlul rapid
    workbox.core.skipWaiting();
    workbox.core.clientsClaim();

    // --- 2. MODIFICAREA MAGICĂ PENTRU UPDATE-URI INSTANT ---
    // Luăm lista de fișiere generată de Workbox
    const manifest = [{"revision":"e0851b38cf3e25d793f243b80965f2fb","url":"workbox-46bb8fb4.js"},{"revision":"aaf360abb7c182900fe2890c91d231dd","url":"style.css"},{"revision":"cc2df2a6ed0d7501fbd637d1a4c59768","url":"package.json"},{"revision":"12df9cabd951a46aea2f3eec77b9054a","url":"package-lock.json"},{"revision":"62be583a8153e69f62d497913523c0d3","url":"manifest.json"},{"revision":"7eac9983eb8d7257ccfe2a7254049e31","url":"index.js"},{"revision":"b6620c17b2be778086a6b46dd93556c1","url":"index.html"},{"revision":"e07abbe10eb5455552f4b3b3e4769e3e","url":"editor.html"},{"revision":"f427b037aa504305c0049c654708e939","url":"js/worker.js"},{"revision":"dc55e1ad45e52aa67fa9661d1e22e16e","url":"js/transcriber.js"},{"revision":"91a1a0cd64b5680ab3db9a8b030821da","url":"js/editor.js"},{"revision":"0727cf2f7cc9578e3c24d03d7b16fe16","url":"js/db.js"},{"revision":"bfca72173e8d81546153b277ae75c49f","url":"js/app.js"},{"revision":"85bfb36aa6e702d56355b283e5573096","url":"assets/icon-512.png"},{"revision":"eb08b90f2f9bdf1bd3955e420b395e1b","url":"assets/icon-256.png"},{"revision":"b7a9164fd0028248d4aad72c6a7ae794","url":"assets/icon-128.png"}];

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