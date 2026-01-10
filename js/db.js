// js/db.js
import { openDB } from 'https://cdn.jsdelivr.net/npm/idb@7/+esm';

const DB_NAME = 'TraduCipriDB';
const STORE_NOTEBOOKS = 'notebooks';

// Conținutul tutorialului
const TUTORIAL_CONTENT = `
# Bine ai venit în TraduCipri! 🚀

Acesta este primul tău caiet inteligent. Aici poți vedea cum funcționează totul.

## Cum să folosești aplicația:
1. **Înregistrare:** Apasă pe microfonul de jos. Aplicația va asculta (în portugheză) și va scrie automat aici.
2. **Editare:** Poți șterge sau modifica textul oricând, chiar în timp ce AI-ul scrie.
3. **Desen:** Apasă pe iconița "Stilou" pentru a desena scheme sau a sublinia idei direct peste text.
4. **Offline:** Odată instalată, aplicația merge perfect și fără internet.

Spor la învățat!
`;

export const dbPromise = openDB(DB_NAME, 1, {
    upgrade(db) {
        if (!db.objectStoreNames.contains(STORE_NOTEBOOKS)) {
            const store = db.createObjectStore(STORE_NOTEBOOKS, { keyPath: 'id', autoIncrement: true });
            store.createIndex('updatedAt', 'updatedAt');
            
            // Seed Data (Tutorial)
            store.add({
                title: 'Ghid de Utilizare',
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
            theme: 'gray' // gray, blue, red
        });
    },

    async add(notebookObject) {
        // Folosit pentru duplicare
        const db = await dbPromise;
        return await db.add(STORE_NOTEBOOKS, notebookObject);
    },
    
    async save(id, content) {
        const db = await dbPromise;
        const note = await db.get(STORE_NOTEBOOKS, id);
        if(note) {
            note.content = content;
            note.updatedAt = new Date();
            await db.put(STORE_NOTEBOOKS, note);
        }
    },

    // Asta lipsea!
    async delete(id) {
        const db = await dbPromise;
        await db.delete(STORE_NOTEBOOKS, id);
    },

    // În obiectul NotebookManager din db.js adaugă metodele astea:

    // ... restul funcțiilor (getAll, create, etc.) ...

    // Exportă totul ca un JSON string
    async exportAllData() {
        const db = await dbPromise;
        const notebooks = await db.getAllFromIndex(STORE_NOTEBOOKS, 'updatedAt');
        const userData = {
            name: localStorage.getItem('traduCipriName'),
            installed: localStorage.getItem('traduCipriInstalled'),
            notebooks: notebooks
        };
        return JSON.stringify(userData);
    },

    // Importă date dintr-un JSON
    async importData(jsonString) {
        try {
            const data = JSON.parse(jsonString);
            
            // 1. Restaurăm setările de user
            if(data.name) localStorage.setItem('traduCipriName', data.name);
            if(data.installed) localStorage.setItem('traduCipriInstalled', data.installed);

            // 2. Restaurăm caietele
            const db = await dbPromise;
            const tx = db.transaction(STORE_NOTEBOOKS, 'readwrite');
            const store = tx.objectStore(STORE_NOTEBOOKS);

            // Le adăugăm pe toate (sau le suprascriem dacă există logica de ID, 
            // dar pentru simplitate le adăugăm ca noi sau curățăm tot înainte)
            
            // Opțional: Ștergem tot ce e curent ca să nu se dubleze? 
            // await store.clear(); 
            
            for (const note of data.notebooks) {
                // Ștergem ID-ul ca să nu facă conflict, DB-ul va genera ID-uri noi
                // Sau păstrăm ID-ul dacă vrem exact aceeași stare
                // delete note.id; 
                await store.put(note); // put() face update dacă există ID, add() crăpă
            }
            
            await tx.done;
            return true;
        } catch (e) {
            console.error("Import failed:", e);
            return false;
        }
    }
};