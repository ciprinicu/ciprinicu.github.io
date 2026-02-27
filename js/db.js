// js/db.js
import { openDB } from 'https://cdn.jsdelivr.net/npm/idb@7/+esm';

const DB_NAME = 'TraduCipriDB';
const STORE_NOTEBOOKS = 'notebooks';

const TUTORIAL_CONTENT = `
# Welcome to TraduCipri! 🚀

This is your first smart notebook. Here you can see how everything works.

## How to use the app:
1. **Recording:** Tap the microphone at the bottom. The app will listen (in Portuguese) and automatically write it down here.
2. **Editing:** You can delete or edit the text anytime, even while the Smart Engine is typing.
3. **Drawing:** Hit the "Pen" icon to draw diagrams or highlight ideas right over the text.
4. **Offline:** Once installed, the app works flawlessly without an internet connection.

Happy learning!
`;

export const dbPromise = openDB(DB_NAME, 1, {
    upgrade(db) {
        if (!db.objectStoreNames.contains(STORE_NOTEBOOKS)) {
            const store = db.createObjectStore(STORE_NOTEBOOKS, { keyPath: 'id', autoIncrement: true });
            store.createIndex('updatedAt', 'updatedAt');

            store.add({
                title: 'Usage guide',
                content: TUTORIAL_CONTENT,
                createdAt: new Date(),
                updatedAt: new Date(),
                isTutorial: true,
                theme: 'blue'
            });
        }
    },
});

export const NotebookManager = {
    async getAll() {
        const db = await dbPromise;
        return await db.getAllFromIndex(STORE_NOTEBOOKS, 'updatedAt');
    },

    async getById(id) {
        const db = await dbPromise;
        return await db.get(STORE_NOTEBOOKS, id);
    },

    async create(title) {
        const db = await dbPromise;
        return await db.add(STORE_NOTEBOOKS, {
            title,
            content: '',
            createdAt: new Date(),
            updatedAt: new Date(),
            theme: 'gray'
        });
    },

    async add(notebookObject) {
        const db = await dbPromise;
        return await db.add(STORE_NOTEBOOKS, notebookObject);
    },

    // Updated save function in js/db.js
    async save(id, content) {
        const db = await dbPromise;
        const note = await db.get(STORE_NOTEBOOKS, id);
        if (note) {
            // 'content' can now be an array of blocks: 
            // [{ p: 'Portuguese', e: 'English', id: 123 }, ...]
            note.content = content;
            note.updatedAt = new Date();
            await db.put(STORE_NOTEBOOKS, note);
        }
    },

    // js/db.js
    async purgePortuguese(id) {
        const db = await dbPromise;
        const note = await db.get('notebooks', id);

        // Check if content exists and is in the new block format
        if (note && note.content.includes('note-block')) {
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = note.content;

            // Find all Portuguese source divs and empty them
            const sources = tempDiv.querySelectorAll('.source-pt');
            sources.forEach(src => {
                src.innerText = ""; // Wipe the text
                src.style.display = "none"; // Ensure it doesn't take up space
            });

            note.content = tempDiv.innerHTML;
            note.updatedAt = new Date();
            await db.put('notebooks', note);
            return true;
        }
        return false;
    },

    async delete(id) {
        const db = await dbPromise;
        await db.delete(STORE_NOTEBOOKS, id);
    },

    async exportAllData() {
        const db = await dbPromise;
        const notebooks = await db.getAll(STORE_NOTEBOOKS);
        const userData = {
            name: localStorage.getItem('traduCipriName'),
            installed: localStorage.getItem('traduCipriInstalled'),
            notebooks: notebooks
        };
        return JSON.stringify(userData);
    },

    async importData(jsonString) {
        try {
            const data = JSON.parse(jsonString);

            if (data.name) localStorage.setItem('traduCipriName', data.name);
            if (data.installed) localStorage.setItem('traduCipriInstalled', data.installed);

            const db = await dbPromise;
            const tx = db.transaction(STORE_NOTEBOOKS, 'readwrite');
            const store = tx.objectStore(STORE_NOTEBOOKS);

            // Opțional: Curățăm tot înainte de import ca să fie Mirror Sync
            // await store.clear(); 

            for (const note of data.notebooks) {
                await store.put(note);
            }

            await tx.done;
            return true;
        } catch (e) {
            console.error("Import failed:", e);
            return false;
        }
    }
};

// EXPORT GLOBAL - Important pentru ca Sync-ul din index.js să poată vedea funcțiile astea
window.NotebookManager = NotebookManager;