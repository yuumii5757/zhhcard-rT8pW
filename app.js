const App = {
    data: {
        cards: [],
        genres: [],
        currentQuiz: {
            cards: [],
            currentIndex: 0,
            correct: 0,
            wrongCards: [],
            mode: 'jp-zhh'
        }
    },
    settings: {
        theme: 'dark',
        voiceUri: '',
        voiceRate: 1.0,
        syncToken: '',
        syncGistId: ''
    },

    async init() {
        await appDB.init();
        this.loadSettings();
        this.applyTheme();
        await this.loadData();

        this.setupRouter();
        this.setupEventListeners();

        window.addEventListener('hashchange', () => this.handleRoute());
        this.handleRoute(); // initial render

        this.initTTS();

        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.register('sw.js')
                .catch(err => console.error('ServiceWorker req failed:', err));
        }
    },

    loadSettings() {
        const saved = localStorage.getItem('zhhcard_settings');
        if (saved) {
            this.settings = { ...this.settings, ...JSON.parse(saved) };
        }
    },

    saveSettings() {
        localStorage.setItem('zhhcard_settings', JSON.stringify(this.settings));
        this.applyTheme();
    },

    applyTheme() {
        document.documentElement.setAttribute('data-theme', this.settings.theme);
    },

    toggleTheme() {
        this.settings.theme = this.settings.theme === 'dark' ? 'light' : 'dark';
        this.saveSettings();
    },

    async loadData() {
        this.data.cards = await appDB.getAll();

        // Extract unique genres
        const genreSet = new Set();
        this.data.cards.forEach(c => {
            if (c.genre) {
                const gs = c.genre.split(/[,、]/).map(g => g.trim()).filter(g => g);
                gs.forEach(g => genreSet.add(g));
            }
        });
        this.data.genres = Array.from(genreSet).sort();
    },

    // --- Routing & Rendering ---

    setupRouter() {
        this.appEl = document.getElementById('app');
    },

    handleRoute() {
        const hash = window.location.hash || '#/';
        const path = hash.split('?')[0];
        const rawParams = hash.split('?')[1] || '';
        const params = new URLSearchParams(rawParams);

        // Update nav UI
        document.querySelectorAll('.nav-item').forEach(el => {
            el.classList.toggle('active', path === `/#/${el.dataset.nav}` || (path === '#/' && el.dataset.nav === 'home'));
        });

        this.appEl.innerHTML = ''; // basic clear

        switch (path) {
            case '#/':
                this.renderHome();
                break;
            case '#/manage':
                this.renderManage(params);
                break;
            case '#/quiz-setup':
                this.renderQuizSetup();
                break;
            case '#/quiz':
                this.renderQuiz(params);
                break;
            case '#/result':
                this.renderResult();
                break;
            case '#/settings':
                this.renderSettings();
                break;
            case '#/weak':
                this.renderSpecificList('weak');
                break;
            case '#/favorite':
                this.renderSpecificList('favorite');
                break;
            default:
                this.renderHome();
        }
    },

    renderTemplate(id) {
        const tmpl = document.getElementById(`tpl-${id}`);
        if (!tmpl) return;
        this.appEl.appendChild(tmpl.content.cloneNode(true));
    },

    // --- Home View ---

    renderHome() {
        this.renderTemplate('home');

        const weakCount = this.data.cards.filter(c => c.wrongCount > 0).length;
        const favCount = this.data.cards.filter(c => c.favorite).length;

        document.getElementById('statTotalCards').textContent = this.data.cards.length;
        document.getElementById('statGenres').textContent = this.data.genres.length;
        document.getElementById('statWeakCards').textContent = weakCount;
        document.getElementById('statFavCards').textContent = favCount;
    },

    // --- Manage View ---

    renderManage(params) {
        this.renderTemplate('manage');

        const cardListEl = document.getElementById('cardList');
        const searchInput = document.getElementById('searchInput');
        const genreFilter = document.getElementById('genreFilter');

        // Populate genre filter
        this.data.genres.forEach(g => {
            const opt = document.createElement('option');
            opt.value = g; opt.textContent = g;
            genreFilter.appendChild(opt);
        });

        const renderList = () => {
            const q = searchInput.value.toLowerCase();
            const gFilter = genreFilter.value;

            let filtered = this.data.cards.filter(c => {
                const matchQ = !q || (c.native_text.toLowerCase().includes(q) || c.target_text.toLowerCase().includes(q) || (c.pronunciation && c.pronunciation.toLowerCase().includes(q)));
                const matchG = !gFilter || (c.genre && c.genre.includes(gFilter));
                return matchQ && matchG;
            });

            cardListEl.innerHTML = '';
            document.getElementById('emptyState').style.display = filtered.length ? 'none' : 'block';

            filtered.forEach(c => {
                const el = document.createElement('div');
                el.className = `list-item ${c.favorite ? 'fav' : ''}`;
                el.innerHTML = `
                    <div class="list-item-title">${c.native_text}</div>
                    <div class="list-item-sub zhh-font text-primary flex align-center gap-2">
                        ${c.target_text} 
                        <span class="text-muted text-xs">${c.pronunciation || ''}</span>
                        <button class="icon-btn text-xs list-tts-btn" style="width:24px; height:24px; min-width: 24px;" title="再生">🔊</button>
                    </div>
                    <div class="text-xs text-muted mt-2">${c.genre || '未分類'}</div>
                `;

                // Add quick TTS
                const ttsBtn = el.querySelector('.list-tts-btn');
                ttsBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.speakText(c.target_text);
                });

                // Add quick favorite toggle
                const favBtn = document.createElement('button');
                favBtn.className = `icon-btn text-sm ${c.favorite ? 'text-warning' : 'text-muted'}`;
                favBtn.style.position = 'absolute';
                favBtn.style.top = '1rem';
                favBtn.style.right = '1rem';
                favBtn.style.width = '32px';
                favBtn.style.height = '32px';
                favBtn.textContent = '☆';
                if (c.favorite) favBtn.innerHTML = '⭐';
                favBtn.addEventListener('click', async (e) => {
                    e.stopPropagation();
                    c.favorite = !c.favorite;
                    await appDB.update(c.id, { favorite: c.favorite });
                    await this.loadData();
                    renderList();
                });
                el.appendChild(favBtn);

                el.addEventListener('click', () => this.showCardModal(c));
                cardListEl.appendChild(el);
            });
        };

        searchInput.addEventListener('input', renderList);
        genreFilter.addEventListener('change', renderList);

        document.getElementById('btnAddNew').addEventListener('click', () => this.showCardModal());

        document.getElementById('btnFetchServer').addEventListener('click', async () => {
            if (confirm('サーバーの初期データを読み込みますか？\n現在のカードの学習記録（ミス回数など）は維持されますが、同じプロンプトのカードは上書きされる可能性があります。')) {
                try {
                    // 実際には外部サーバーURLを指定します
                    // ここではモックとして同ディレクトリの preset.json があると仮定します
                    const res = await fetch('preset.json');
                    if (!res.ok) throw new Error('プリセットファイルが見つかりません');
                    const data = await res.json();
                    await appDB.importData(data);
                    await this.loadData();
                    renderList();
                    alert(`サーバーから ${data.length} 件のカードを読み込みました`);
                } catch (e) {
                    alert('読込失敗: ' + e.message);
                }
            }
        });

        document.getElementById('btnExport').addEventListener('click', () => {
            const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(this.data.cards));
            const downloadAnchorNode = document.createElement('a');
            downloadAnchorNode.setAttribute("href", dataStr);
            downloadAnchorNode.setAttribute("download", "zhhcard_backup.json");
            document.body.appendChild(downloadAnchorNode);
            downloadAnchorNode.click();
            downloadAnchorNode.remove();
        });

        document.getElementById('importFile').addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = async (e) => {
                try {
                    const data = JSON.parse(e.target.result);
                    await appDB.importData(data);
                    await this.loadData();
                    renderList();
                    alert(`インポート完了: ${data.length}件`);
                } catch (err) {
                    alert('インポート失敗: ' + err.message);
                }
            };
            reader.readAsText(file);
        });

        renderList();

        if (params.get('action') === 'new') {
            this.showCardModal();
        }
    },

    // --- Modal Logic ---

    showCardModal(card = null) {
        const isNew = !card;
        const c = card || { native_text: '', target_text: '', pronunciation: '', genre: '', memo: '', favorite: false, wrongCount: 0 };

        const modalHtml = `
            <div class="modal-overlay active" id="cardModal">
                <div class="modal-content">
                    <div class="flex-between mb-4">
                        <h3 class="m-0">${isNew ? '新規カード登録' : 'カード編集'}</h3>
                        <button class="icon-btn" id="btnCloseModal">✕</button>
                    </div>
                    
                    <div class="form-group mb-3">
                        <label class="block mb-1 text-sm font-bold">日本語 (プロンプト) <span class="text-danger">*</span></label>
                        <textarea id="mNative" class="form-control" placeholder="例: こんにちは">${c.native_text}</textarea>
                    </div>
                    
                    <div class="form-group mb-3">
                        <label class="block mb-1 text-sm font-bold">広東語 (正解) <span class="text-danger">*</span></label>
                        <input type="text" id="mTarget" class="form-control zhh-font text-lg" placeholder="例: 你好" value="${c.target_text}">
                    </div>

                    <div class="form-group mb-3">
                        <label class="block mb-1 text-sm font-bold">発音記号</label>
                        <input type="text" id="mPronunciation" class="form-control" placeholder="例: nei5 hou2" value="${c.pronunciation || ''}">
                    </div>
                    
                    <div class="form-group mb-3">
                        <label class="block mb-1 text-sm font-bold">ジャンル (カンマ区切り)</label>
                        <input type="text" id="mGenre" class="form-control" placeholder="例: 挨拶, 基本" value="${c.genre}">
                    </div>
                    
                    <div class="form-group mb-4">
                        <label class="block mb-1 text-sm font-bold">メモ (任意)</label>
                        <textarea id="mMemo" class="form-control" placeholder="覚えるコツや文法など">${c.memo || ''}</textarea>
                    </div>
                    
                    <div class="flex gap-2">
                        <button class="btn btn-primary flex-1" id="btnSaveCard">保存する</button>
                        ${!isNew ? `<button class="btn btn-danger" id="btnDeleteCard">🗑️ 削除</button>` : ''}
                    </div>
                </div>
            </div>
        `;

        document.getElementById('modalContainer').innerHTML = modalHtml;

        const closeModal = () => {
            document.getElementById('cardModal').classList.remove('active');
            setTimeout(() => document.getElementById('modalContainer').innerHTML = '', 300);
        };

        document.getElementById('btnCloseModal').addEventListener('click', closeModal);

        document.getElementById('btnSaveCard').addEventListener('click', async () => {
            const native = document.getElementById('mNative').value.trim();
            const target = document.getElementById('mTarget').value.trim();
            const pronunciation = document.getElementById('mPronunciation').value.trim();
            const genre = document.getElementById('mGenre').value.trim();
            const memo = document.getElementById('mMemo').value.trim();

            if (!native || !target) {
                alert('日本語と広東語は必須です');
                return;
            }

            const updatedCard = { ...c, native_text: native, target_text: target, pronunciation, genre, memo };

            if (isNew) {
                await appDB.add(updatedCard);
            } else {
                await appDB.update(c.id, updatedCard);
            }

            await this.loadData();
            closeModal();
            if (window.location.hash.includes('#/manage')) this.renderManage(new URLSearchParams());
        });

        if (!isNew) {
            document.getElementById('btnDeleteCard').addEventListener('click', async () => {
                if (confirm('本当に削除しますか？')) {
                    await appDB.delete(c.id);
                    await this.loadData();
                    closeModal();
                    if (window.location.hash.includes('#/manage')) this.renderManage(new URLSearchParams());
                }
            });
        }
    },

    // --- Specific Lists View ---
    renderSpecificList(type) {
        this.renderTemplate('manage');
        document.querySelector('.manage-view h2').textContent = type === 'weak' ? '要注意カード (ミスあり)' : 'お気に入りリスト';
        document.getElementById('btnAddNew').style.display = 'none';
        document.querySelector('.io-controls').style.display = 'none';

        const actionsHtml = `
            <div class="flex gap-2 mb-3">
                <a href="#/quiz?genre=${type === 'weak' ? '_weak' : '_fav'}" class="btn btn-primary flex-1">🚀 このリストでクイズ開始</a>
                ${type === 'weak' ? `<button id="btnResetWeak" class="btn btn-secondary text-sm">🔄 ミス回数をリセット</button>` : ''}
            </div>
        `;
        document.querySelector('.search-bar').insertAdjacentHTML('afterend', actionsHtml);

        if (type === 'weak') {
            document.getElementById('btnResetWeak').addEventListener('click', async () => {
                const weakCards = this.data.cards.filter(c => c.wrongCount > 0);
                if (weakCards.length === 0) return;
                if (confirm(`本当に ${weakCards.length} 件のカードのミス回数を 0 にリセットしますか？`)) {
                    for (const c of weakCards) {
                        await appDB.update(c.id, { wrongCount: 0 });
                    }
                    await this.loadData();
                    renderList();
                    alert('リセットしました。');
                }
            });
        }

        const cardListEl = document.getElementById('cardList');
        const searchInput = document.getElementById('searchInput');
        const genreFilter = document.getElementById('genreFilter');

        // Populate filter
        this.data.genres.forEach(g => {
            const opt = document.createElement('option');
            opt.value = g; opt.textContent = g;
            genreFilter.appendChild(opt);
        });

        const renderList = () => {
            const q = searchInput.value.toLowerCase();
            const gFilter = genreFilter.value;

            let sourceCards = type === 'weak' ? this.data.cards.filter(c => c.wrongCount > 0).sort((a, b) => b.wrongCount - a.wrongCount) : this.data.cards.filter(c => c.favorite);

            let filtered = sourceCards.filter(c => {
                const matchQ = !q || (c.native_text.toLowerCase().includes(q) || c.target_text.toLowerCase().includes(q) || (c.pronunciation && c.pronunciation.toLowerCase().includes(q)));
                const matchG = !gFilter || (c.genre && c.genre.includes(gFilter));
                return matchQ && matchG;
            });

            cardListEl.innerHTML = '';
            document.getElementById('emptyState').style.display = filtered.length ? 'none' : 'block';

            filtered.forEach(c => {
                const el = document.createElement('div');
                el.className = `list-item ${c.favorite ? 'fav' : ''}`;
                el.innerHTML = `
                    <div class="list-item-title">${c.native_text} ${type === 'weak' ? `<span class="text-danger text-xs ml-2">❌ ${c.wrongCount}</span>` : ''}</div>
                    <div class="list-item-sub zhh-font text-primary flex align-center gap-2">
                        ${c.target_text} 
                        <span class="text-muted text-xs">${c.pronunciation || ''}</span>
                        <button class="icon-btn text-xs list-tts-btn" style="width:24px; height:24px; min-width: 24px;" title="再生">🔊</button>
                    </div>
                `;

                // Add quick TTS
                const ttsBtn = el.querySelector('.list-tts-btn');
                ttsBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.speakText(c.target_text);
                });

                // Add quick favorite toggle
                const favBtn = document.createElement('button');
                favBtn.className = `icon-btn text-sm ${c.favorite ? 'text-warning' : 'text-muted'}`;
                favBtn.style.position = 'absolute';
                favBtn.style.top = '1rem';
                favBtn.style.right = '1rem';
                favBtn.style.width = '32px';
                favBtn.style.height = '32px';
                favBtn.textContent = '☆';
                if (c.favorite) favBtn.innerHTML = '⭐';
                favBtn.addEventListener('click', async (e) => {
                    e.stopPropagation();
                    c.favorite = !c.favorite;
                    await appDB.update(c.id, { favorite: c.favorite });
                    await this.loadData();
                    renderList();
                });
                el.appendChild(favBtn);

                el.addEventListener('click', () => this.showCardModal(c));
                cardListEl.appendChild(el);
            });
        };

        searchInput.addEventListener('input', renderList);
        genreFilter.addEventListener('change', renderList);
        renderList();
    },

    // --- Quiz Setup ---

    renderQuizSetup() {
        this.renderTemplate('quiz-setup');
        const listEl = document.getElementById('quizGenreList');

        const renderGenreBtn = (label, value, count, extraClass = '') => {
            if (count === 0) return;
            const a = document.createElement('a');
            a.href = 'javascript:void(0)';
            a.className = `genre-btn ${extraClass}`;
            a.innerHTML = `
                <div class="font-bold">${label}</div>
                <div class="genre-btn-count">${count}枚</div>
            `;
            a.addEventListener('click', () => {
                const modeSelect = document.getElementById('quizModeSelect');
                const mode = modeSelect ? modeSelect.value : 'jp-zhh';
                window.location.hash = `#/quiz?genre=${encodeURIComponent(value)}&mode=${mode}`;
            });
            listEl.appendChild(a);
        };

        // Special genres
        const favCount = this.data.cards.filter(c => c.favorite).length;
        const weakCount = this.data.cards.filter(c => c.wrongCount > 0).length;

        renderGenreBtn('全カード (ランダム)', 'all', this.data.cards.length, 'border-primary');
        renderGenreBtn('⭐ お気に入り', '_fav', favCount);
        renderGenreBtn('⚠️ 要注意 (ミスあり)', '_weak', weakCount);

        // Standard genres
        this.data.genres.forEach(g => {
            const count = this.data.cards.filter(c => c.genre && c.genre.includes(g)).length;
            renderGenreBtn(g, g, count);
        });

        if (this.data.cards.length === 0) {
            listEl.innerHTML = '<p class="text-center text-muted" style="grid-column: 1/-1;">カードがありません。<a href="#/manage">追加してください</a></p>';
        }
    },

    // --- Quiz Logic ---

    renderQuiz(params) {
        let mode = document.getElementById('quizModeSelect') ? document.getElementById('quizModeSelect').value : 'jp-zhh';
        // Check if mode was passed through URL params (e.g., from result screen)
        if (params.get('mode')) mode = params.get('mode');

        const genreQuery = params.get('genre') || 'all';
        let targetQueue = [];

        if (genreQuery === 'all') {
            targetQueue = [...this.data.cards];
        } else if (genreQuery === '_fav') {
            targetQueue = this.data.cards.filter(c => c.favorite);
        } else if (genreQuery === '_weak') {
            targetQueue = this.data.cards.filter(c => c.wrongCount > 0);
        } else {
            targetQueue = this.data.cards.filter(c => c.genre && c.genre.includes(genreQuery));
        }

        if (targetQueue.length === 0) {
            alert('対象のカードがありません');
            window.location.hash = '#/quiz-setup';
            return;
        }

        // Apply weighted random selection (Max 20 cards per session for UX)
        const sessionSize = Math.min(targetQueue.length, 20);
        const selected = [];

        while (selected.length < sessionSize && targetQueue.length > 0) {
            const totalWeight = targetQueue.reduce((sum, c) => sum + (1 + (c.wrongCount * 2)), 0);
            let rand = Math.random() * totalWeight;
            for (let i = 0; i < targetQueue.length; i++) {
                const w = 1 + (targetQueue[i].wrongCount * 2);
                if (rand < w) {
                    selected.push(targetQueue[i]);
                    targetQueue.splice(i, 1);
                    break;
                }
                rand -= w;
            }
        }

        this.data.currentQuiz = {
            cards: selected,
            currentIndex: 0,
            correct: 0,
            wrongCards: [],
            mode: mode
        };

        this.renderTemplate('quiz');
        this.updateQuizUI();

        // Optional update of result button to preserve mode
        this.data.currentQuiz.genreQuery = genreQuery;

        // Events
        document.getElementById('btnQuitQuiz').addEventListener('click', () => window.location.hash = '#/quiz-setup');

        document.getElementById('btnShowHint').addEventListener('click', () => {
            const c = this.data.currentQuiz.cards[this.data.currentQuiz.currentIndex];
            const ansEl = document.getElementById('qAnswerContainer');
            const tarEl = document.getElementById('qAnswer');

            if (this.data.currentQuiz.mode === 'jp-zhh') {
                // Just show the target text
                tarEl.textContent = c.target_text;
                tarEl.classList.add('zhh-font', 'text-2xl', 'text-primary');
                ansEl.style.visibility = 'visible';
            } else {
                // zhh-jp mode hint: Show pronunciation below the prompt, beautifully.
                const promptHintEl = document.getElementById('qPromptHint');
                promptHintEl.textContent = `💡 ヒント: ${c.pronunciation || '発音記号がありません'}`;
                promptHintEl.style.display = 'block';
                // we don't make ansEl visible yet!
            }

            document.getElementById('btnShowHint').disabled = true;
        });

        document.getElementById('btnShowAnswer').addEventListener('click', () => {
            const c = this.data.currentQuiz.cards[this.data.currentQuiz.currentIndex];
            const ansEl = document.getElementById('qAnswerContainer');
            const tarEl = document.getElementById('qAnswer');

            if (this.data.currentQuiz.mode === 'jp-zhh') {
                tarEl.textContent = c.target_text;
                tarEl.classList.add('zhh-font', 'text-2xl', 'text-primary');
                tarEl.classList.remove('text-lg', 'text-muted');
                if (c.pronunciation) {
                    const pronEl = document.getElementById('qPronunciation');
                    pronEl.textContent = c.pronunciation;
                    pronEl.style.display = 'block';
                }
            } else {
                tarEl.textContent = c.native_text;
                tarEl.classList.remove('zhh-font', 'text-primary');
                tarEl.classList.add('text-xl');

                // Show pronunciation just below the Zhh text (which is the prompt)
                if (c.pronunciation) {
                    const promptHintEl = document.getElementById('qPromptHint');
                    promptHintEl.textContent = c.pronunciation;
                    promptHintEl.style.display = 'block';

                    document.getElementById('qPronunciation').style.display = 'none';
                }
            }

            if (c.memo) {
                document.getElementById('qMemo').textContent = c.memo;
                document.getElementById('qMemoBox').style.display = 'block';
            }

            ansEl.style.visibility = 'visible';
            document.getElementById('qCardActions').style.display = 'flex';

            document.getElementById('controls-hint').style.display = 'none';
            document.getElementById('controls-judge').style.display = 'flex';

            const btnTTS = document.getElementById('btnTTS');
            btnTTS.disabled = false;

            // Auto TTS
            this.speakText(c.target_text);
        });

        document.getElementById('btnTTS').addEventListener('click', () => {
            const c = this.data.currentQuiz.cards[this.data.currentQuiz.currentIndex];
            this.speakText(c.target_text);
        });

        document.getElementById('btnCopyAnswer').addEventListener('click', async () => {
            const c = this.data.currentQuiz.cards[this.data.currentQuiz.currentIndex];
            try {
                await navigator.clipboard.writeText(c.target_text);
                alert('広東語をコピーしました！');
            } catch (err) {
                alert('コピーに失敗しました');
            }
        });

        document.getElementById('btnEditCard').addEventListener('click', () => {
            const c = this.data.currentQuiz.cards[this.data.currentQuiz.currentIndex];
            this.showCardModal(c);
        });

        document.getElementById('btnToggleFavCard').addEventListener('click', async (e) => {
            const c = this.data.currentQuiz.cards[this.data.currentQuiz.currentIndex];
            c.favorite = !c.favorite;
            e.target.classList.toggle('active', c.favorite);
            await appDB.update(c.id, { favorite: c.favorite });
            await this.loadData();
        });

        const handleJudge = async (isCorrect) => {
            const c = this.data.currentQuiz.cards[this.data.currentQuiz.currentIndex];

            if (isCorrect) {
                this.data.currentQuiz.correct++;
                // Decrease wrong count but keep floor at 0
                await appDB.update(c.id, { wrongCount: Math.max(0, c.wrongCount - 1), lastAnswered: new Date().toISOString() });
            } else {
                this.data.currentQuiz.wrongCards.push(c);
                await appDB.update(c.id, { wrongCount: c.wrongCount + 1, lastAnswered: new Date().toISOString() });
            }

            this.data.currentQuiz.currentIndex++;
            if (this.data.currentQuiz.currentIndex >= this.data.currentQuiz.cards.length) {
                await this.loadData(); // reload to reflect new wrongCounts
                window.location.hash = '#/result';
            } else {
                this.updateQuizUI();
            }
        };

        document.getElementById('btnCorrect').addEventListener('click', () => handleJudge(true));
        document.getElementById('btnWrong').addEventListener('click', () => handleJudge(false));
    },

    updateQuizUI() {
        const cq = this.data.currentQuiz;
        const c = cq.cards[cq.currentIndex];

        // Progress status
        document.getElementById('qCount').textContent = cq.currentIndex + 1;
        document.getElementById('qTotal').textContent = cq.cards.length;
        document.getElementById('quizProgress').style.width = `${((cq.currentIndex) / cq.cards.length) * 100}%`;

        // Card content
        const promptEl = document.getElementById('qPrompt');
        const promptLabelEl = document.getElementById('qPromptLabel');
        const answerLabelEl = document.getElementById('qAnswerLabel');

        if (cq.mode === 'jp-zhh') {
            promptLabelEl.textContent = '日本語';
            promptEl.textContent = c.native_text;
            promptEl.className = 'native-text text-xl';
            answerLabelEl.textContent = '広東語';
        } else {
            promptLabelEl.textContent = '広東語';
            promptEl.textContent = c.target_text;
            promptEl.className = 'zhh-font text-2xl text-primary font-bold';
            answerLabelEl.textContent = '日本語';

            // Auto TTS when showing Zhh prompt!
            this.speakText(c.target_text);
        }

        document.getElementById('qAnswer').textContent = '';
        document.getElementById('qPronunciation').style.display = 'none';
        document.getElementById('qPromptHint').style.display = 'none';
        document.getElementById('qMemoBox').style.display = 'none';

        const favBtn = document.getElementById('btnToggleFavCard');
        favBtn.classList.toggle('active', c.favorite);
        favBtn.textContent = '☆';
        if (c.favorite) favBtn.textContent = '⭐';

        // Reset visibility
        document.getElementById('qAnswerContainer').style.visibility = 'hidden';
        document.getElementById('qCardActions').style.display = 'none';
        document.getElementById('controls-hint').style.display = 'flex';
        document.getElementById('btnShowHint').disabled = false;
        document.getElementById('controls-judge').style.display = 'none';
        document.getElementById('btnTTS').disabled = true;
    },

    // --- Result View ---

    renderResult() {
        if (!this.data.currentQuiz.cards.length) {
            window.location.hash = '#/';
            return;
        }

        this.renderTemplate('result');
        const cq = this.data.currentQuiz;
        const total = cq.cards.length;
        const percent = Math.round((cq.correct / total) * 100);

        document.getElementById('scorePercent').textContent = percent;
        document.getElementById('scoreCorrect').textContent = cq.correct;
        document.getElementById('scoreWrong').textContent = total - cq.correct;

        const replayLink = document.querySelector('.result-actions a[href="#/quiz-setup"]');
        if (replayLink && cq.genreQuery) {
            // Keep same genre and mode
            replayLink.href = `#/quiz?genre=${encodeURIComponent(cq.genreQuery)}&mode=${cq.mode}`;
        }

        if (cq.wrongCards.length > 0) {
            const listEl = document.getElementById('resultCards');
            cq.wrongCards.forEach(c => {
                const el = document.createElement('div');
                el.className = 'list-item';
                el.innerHTML = `
                    <div class="list-item-title">${c.native_text}</div>
                    <div class="list-item-sub zhh-font text-primary">${c.target_text} <span class="text-muted ml-2">${c.pronunciation || ''}</span></div>
                `;
                listEl.appendChild(el);
            });
            document.getElementById('resultWeakList').style.display = 'block';
        }
    },

    // --- Settings View ---

    renderSettings() {
        this.renderTemplate('settings');

        const voiceSelect = document.getElementById('voiceSelect');
        const voiceRate = document.getElementById('voiceRate');
        const rateValue = document.getElementById('rateValue');

        voiceRate.value = this.settings.voiceRate;
        rateValue.textContent = `${this.settings.voiceRate}x`;

        const populateVoices = () => {
            const voices = window.speechSynthesis.getVoices();
            // Filter primarily for Cantonese (zh-HK), but keep others as fallback
            const zhhVoices = voices.filter(v => v.lang.startsWith('zh-HK') || v.lang.startsWith('yue'));
            const showVoices = zhhVoices.length > 0 ? zhhVoices : voices;

            voiceSelect.innerHTML = '';
            showVoices.forEach((v, i) => {
                const opt = document.createElement('option');
                opt.value = v.voiceURI;
                opt.textContent = `${v.name} (${v.lang})`;
                if (this.settings.voiceUri === v.voiceURI || (i === 0 && !this.settings.voiceUri)) {
                    opt.selected = true;
                }
                voiceSelect.appendChild(opt);
            });
        };

        if (window.speechSynthesis.onvoiceschanged !== undefined) {
            window.speechSynthesis.onvoiceschanged = populateVoices;
        }
        populateVoices();

        voiceSelect.addEventListener('change', (e) => {
            this.settings.voiceUri = e.target.value;
            this.saveSettings();
        });

        voiceRate.addEventListener('input', (e) => {
            this.settings.voiceRate = e.target.value;
            rateValue.textContent = `${e.target.value}x`;
        });

        voiceRate.addEventListener('change', (e) => {
            this.saveSettings();
        });

        document.getElementById('btnTestVoice').addEventListener('click', () => {
            this.speakText('大家早晨，很高興認識你');
        });

        // --- Cloud Sync Logic ---
        const syncToken = document.getElementById('syncToken');
        const syncGistId = document.getElementById('syncGistId');
        const syncPassword = document.getElementById('syncPassword');
        const syncStatus = document.getElementById('syncStatus');

        syncToken.value = this.settings.syncToken;
        syncGistId.value = this.settings.syncGistId;

        const saveSyncSettings = () => {
            this.settings.syncToken = syncToken.value.trim();
            this.settings.syncGistId = syncGistId.value.trim();
            this.saveSettings();
        };

        syncToken.addEventListener('change', saveSyncSettings);
        syncGistId.addEventListener('change', saveSyncSettings);

        document.getElementById('btnSyncUpload').addEventListener('click', async () => {
            saveSyncSettings();
            const pwd = syncPassword.value;
            if (!this.settings.syncToken || !this.settings.syncGistId || !pwd) {
                syncStatus.innerHTML = '<span class="text-danger">トークン、Gist ID、パスワードの全てを入力してください</span>';
                return;
            }

            try {
                syncStatus.innerHTML = 'アップロード中...';
                const dataObj = await appDB.getAll();
                await window.SyncManager.uploadToGist(this.settings.syncToken, this.settings.syncGistId, dataObj, pwd);
                syncStatus.innerHTML = '<span class="text-success">アップロード成功（暗号化済み）</span>';
            } catch (e) {
                syncStatus.innerHTML = `<span class="text-danger">エラー: ${e.message}</span>`;
            }
        });

        document.getElementById('btnSyncDownload').addEventListener('click', async () => {
            saveSyncSettings();
            const pwd = syncPassword.value;
            if (!this.settings.syncToken || !this.settings.syncGistId || !pwd) {
                syncStatus.innerHTML = '<span class="text-danger">トークン、Gist ID、パスワードの全てを入力してください</span>';
                return;
            }

            if (!confirm('クラウドのデータで現在のすべてのカードが上書きされます。よろしいですか？')) return;

            try {
                syncStatus.innerHTML = 'ダウンロード中...';
                const dataObj = await window.SyncManager.downloadFromGist(this.settings.syncToken, this.settings.syncGistId, pwd);
                await appDB.deleteAll();
                await appDB.importData(dataObj);
                await this.loadData();
                syncStatus.innerHTML = `<span class="text-success">ダウンロード成功: ${dataObj.length}件を復元しました</span>`;
            } catch (e) {
                syncStatus.innerHTML = `<span class="text-danger">エラー: ${e.message}</span>`;
            }
        });

        document.getElementById('btnUpdateApp').addEventListener('click', async () => {
            if (confirm('最新のアプリデータを取得し、画面をリロードします。よろしいですか？')) {
                if ('serviceWorker' in navigator) {
                    const registrations = await navigator.serviceWorker.getRegistrations();
                    for (let reg of registrations) {
                        await reg.unregister();
                    }
                }
                if ('caches' in window) {
                    const keys = await caches.keys();
                    for (let key of keys) {
                        await caches.delete(key);
                    }
                }
                window.location.reload(true);
            }
        });

        document.getElementById('btnEraseAll').addEventListener('click', async () => {
            if (confirm('本当にすべてのデータを削除しますか？\nこの操作は元に戻せません。')) {
                const check = prompt("確認のため 'DELETE' と入力してください。");
                if (check === 'DELETE') {
                    await appDB.deleteAll();
                    await this.loadData();
                    alert('全データを削除しました。');
                    window.location.hash = '#/';
                }
            }
        });
    },

    // --- TTS Logic ---

    initTTS() {
        if (!('speechSynthesis' in window)) {
            console.warn("TTS not supported in this browser");
        }
    },

    speakText(text) {
        if (!('speechSynthesis' in window)) return;

        window.speechSynthesis.cancel(); // stop current

        const u = new SpeechSynthesisUtterance(text);
        u.lang = 'th-TH';
        u.rate = this.settings.voiceRate;

        const voices = window.speechSynthesis.getVoices();
        if (this.settings.voiceUri) {
            const v = voices.find(v => v.voiceURI === this.settings.voiceUri);
            if (v) u.voice = v;
        } else {
            const thVoice = voices.find(v => v.lang.startsWith('th'));
            if (thVoice) u.voice = thVoice;
        }

        window.speechSynthesis.speak(u);
    },

    // --- Global Events ---
    setupEventListeners() {
        document.getElementById('themeToggleBtn').addEventListener('click', () => this.toggleTheme());
    }
};

document.addEventListener('DOMContentLoaded', () => App.init());
