/**
 * js/sync.js
 * Handles AES-256-GCM encryption/decryption and GitHub Gist syncing.
 */

const SyncManager = {
    // --- Encryption / Decryption ---

    // Derive AES key from password
    async _deriveKey(password, salt) {
        const enc = new TextEncoder();
        const pwdKey = await crypto.subtle.importKey(
            "raw",
            enc.encode(password),
            { name: "PBKDF2" },
            false,
            ["deriveKey"]
        );

        return await crypto.subtle.deriveKey(
            {
                name: "PBKDF2",
                salt: salt,
                iterations: 100000,
                hash: "SHA-256"
            },
            pwdKey,
            { name: "AES-GCM", length: 256 },
            true,
            ["encrypt", "decrypt"]
        );
    },

    // ArrayBuffer to Base64 string
    _ab2b64(ab) {
        let binary = '';
        const bytes = new Uint8Array(ab);
        const len = bytes.byteLength;
        for (let i = 0; i < len; i++) {
            binary += String.fromCharCode(bytes[i]);
        }
        return window.btoa(binary);
    },

    // Base64 string to ArrayBuffer
    _b642ab(base64) {
        const binary_string = window.atob(base64);
        const len = binary_string.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
            bytes[i] = binary_string.charCodeAt(i);
        }
        return bytes.buffer;
    },

    // Encrypt JSON object
    async encryptData(dataObj, password) {
        const jsonStr = JSON.stringify(dataObj);
        const enc = new TextEncoder();
        const pt = enc.encode(jsonStr);

        const salt = crypto.getRandomValues(new Uint8Array(16));
        const iv = crypto.getRandomValues(new Uint8Array(12));

        const key = await this._deriveKey(password, salt);

        const ctBuf = await crypto.subtle.encrypt(
            { name: "AES-GCM", iv: iv },
            key,
            pt
        );

        return {
            ct: this._ab2b64(ctBuf),
            iv: this._ab2b64(iv),
            salt: this._ab2b64(salt)
        };
    },

    // Decrypt encrypted payload
    async decryptData(encryptedPayload, password) {
        try {
            const salt = this._b642ab(encryptedPayload.salt);
            const iv = this._b642ab(encryptedPayload.iv);
            const ct = this._b642ab(encryptedPayload.ct);

            const key = await this._deriveKey(password, salt);

            const ptBuf = await crypto.subtle.decrypt(
                { name: "AES-GCM", iv: new Uint8Array(iv) },
                key,
                ct
            );

            const dec = new TextDecoder();
            const jsonStr = dec.decode(ptBuf);
            return JSON.parse(jsonStr);
        } catch (e) {
            throw new Error("復号に失敗しました。パスワードが間違っているか、データが破損しています。");
        }
    },

    // --- GitHub Gist API ---
    // Filename used in Gist
    FILENAME: "thaicard_sync.json",

    // Upload entirely encrypted data to GitHub Gist
    async uploadToGist(token, gistId, dataObj, password) {
        if (!token || !gistId || !password) throw new Error("トークン、Gist ID、パスワードが必要です");

        const encrypted = await this.encryptData(dataObj, password);

        const res = await fetch(`https://api.github.com/gists/${gistId}`, {
            method: 'PATCH',
            headers: {
                'Authorization': `token ${token}`,
                'Accept': 'application/vnd.github.v3+json',
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                files: {
                    [this.FILENAME]: {
                        content: JSON.stringify(encrypted)
                    }
                }
            })
        });

        if (!res.ok) {
            let msg = 'Gistアップロード失敗';
            try { const err = await res.json(); msg = err.message || msg; } catch (e) { }
            throw new Error(msg);
        }
        return true;
    },

    // Download, decrypt, and return data from GitHub Gist
    async downloadFromGist(token, gistId, password) {
        if (!token || !gistId || !password) throw new Error("トークン、Gist ID、パスワードが必要です");

        const res = await fetch(`https://api.github.com/gists/${gistId}`, {
            headers: {
                'Authorization': `token ${token}`,
                'Accept': 'application/vnd.github.v3+json',
            }
        });

        if (!res.ok) {
            let msg = 'Gist取得失敗';
            try { const err = await res.json(); msg = err.message || msg; } catch (e) { }
            throw new Error(msg);
        }

        const gistData = await res.json();
        const file = gistData.files[this.FILENAME];
        if (!file) throw new Error("同期ファイルが見つかりません。");

        const encrypted = JSON.parse(file.content);
        return await this.decryptData(encrypted, password);
    }
};

window.SyncManager = SyncManager;
