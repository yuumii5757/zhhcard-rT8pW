class Database {
    constructor() {
        this.dbName = 'ThaiCardDB';
        this.dbVersion = 1;
        this.storeName = 'cards';
        this.db = null;
    }

    async init() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, this.dbVersion);

            request.onerror = (e) => reject(`IndexedDB error: ${e.target.errorCode}`);

            request.onsuccess = (e) => {
                this.db = e.target.result;
                resolve();
            };

            request.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains(this.storeName)) {
                    const store = db.createObjectStore(this.storeName, { keyPath: 'id' });
                    store.createIndex('genre', 'genre', { multiEntry: false });
                    store.createIndex('wrongCount', 'wrongCount', { unique: false });
                    store.createIndex('favorite', 'favorite', { unique: false });
                }
            };
        });
    }

    async getAll() {
        return new Promise((resolve, reject) => {
            if(!this.db) return resolve([]);
            const tx = this.db.transaction(this.storeName, 'readonly');
            const store = tx.objectStore(this.storeName);
            const request = store.getAll();
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    async add(card) {
        return new Promise((resolve, reject) => {
            if (!card.id) card.id = crypto.randomUUID();
            if (card.favorite === undefined) card.favorite = false;
            if (card.wrongCount === undefined) card.wrongCount = 0;
            
            const tx = this.db.transaction(this.storeName, 'readwrite');
            const store = tx.objectStore(this.storeName);
            const request = store.put(card); // put serves as insert/update
            
            request.onsuccess = () => resolve(card);
            request.onerror = () => reject(request.error);
        });
    }

    async update(id, updates) {
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(this.storeName, 'readwrite');
            const store = tx.objectStore(this.storeName);
            const request = store.get(id);

            request.onsuccess = () => {
                const card = request.result;
                if (!card) return reject(new Error('Card not found'));
                
                const updatedCard = { ...card, ...updates };
                const putRequest = store.put(updatedCard);
                putRequest.onsuccess = () => resolve(updatedCard);
                putRequest.onerror = () => reject(putRequest.error);
            };
            request.onerror = () => reject(request.error);
        });
    }

    async delete(id) {
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(this.storeName, 'readwrite');
            const store = tx.objectStore(this.storeName);
            const request = store.delete(id);
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }
    
    async deleteAll() {
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(this.storeName, 'readwrite');
            const store = tx.objectStore(this.storeName);
            const request = store.clear();
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }

    async importData(dataArr) {
        if (!Array.isArray(dataArr)) throw new Error("Invalid import format. Expected array.");
        
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(this.storeName, 'readwrite');
            const store = tx.objectStore(this.storeName);
            
            let completed = 0;
            let errors = 0;
            
            if (dataArr.length === 0) return resolve();

            dataArr.forEach(card => {
                if(!card.id) card.id = crypto.randomUUID();
                const req = store.put(card);
                req.onsuccess = () => {
                    completed++;
                    if(completed + errors === dataArr.length) resolve();
                };
                req.onerror = () => {
                    errors++;
                    if(completed + errors === dataArr.length) reject(new Error(`${errors} errors occurred during import`));
                };
            });
        });
    }
}

window.appDB = new Database();
