(() => {
  'use strict';

  if (!window.Phaser) {
    return;
  }

  const GAME_WIDTH = 960;
  const GAME_HEIGHT = 540;

  const STORAGE_KEYS = {
    token: 'space_strike_token',
    settings: 'space_strike_settings'
  };

  const DEFAULT_SETTINGS = {
    music: true,
    sound: true,
    volume: 0.7,
    quality: 'high',
    control: 'keyboard',
    autoFire: false
  };

  const DEFAULT_CONFIG = {
    game: {
      playerHp: 3,
      playerSpeed: 320,
      enemyBaseSpeed: 120,
      enemySpawnInterval: 1000,
      difficultyIncreaseInterval: 30000
    },
    score: {
      normalEnemy: 100,
      fastEnemy: 150,
      heavyEnemy: 500,
      shooterEnemy: 350
    }
  };

  const APP = {
    auth: {
      token: '',
      user: null
    },
    settings: loadSettings(),
    config: DEFAULT_CONFIG,
    pendingSaveResult: null,
    lastResult: null
  };

  const EVENTS = new Phaser.Events.EventEmitter();

  const DOM = {
    backdrop: document.getElementById('modal-backdrop'),
    authModal: document.getElementById('auth-modal'),
    panelModal: document.getElementById('panel-modal'),
    settingsModal: document.getElementById('settings-modal'),
    authStatus: document.getElementById('auth-status'),
    authOpenBtn: document.getElementById('auth-open'),
    authLogoutBtn: document.getElementById('auth-logout'),
    tabLogin: document.getElementById('tab-login'),
    tabRegister: document.getElementById('tab-register'),
    loginForm: document.getElementById('login-form'),
    registerForm: document.getElementById('register-form'),
    authError: document.getElementById('auth-error'),
    panelTitle: document.getElementById('panel-title'),
    panelBody: document.getElementById('panel-body'),
    toastArea: document.getElementById('toast-area'),
    setMusic: document.getElementById('set-music'),
    setSound: document.getElementById('set-sound'),
    setAutoFire: document.getElementById('set-autofire'),
    setVolume: document.getElementById('set-volume'),
    setControl: document.getElementById('set-control'),
    saveSettingsBtn: document.getElementById('save-settings')
  };

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function nowMs() {
    return Date.now();
  }

  function fmtScore(value) {
    return Number(value || 0).toLocaleString('en-US');
  }

  function fmtTime(sec) {
    const seconds = Math.max(0, Math.floor(sec || 0));
    const m = String(Math.floor(seconds / 60)).padStart(2, '0');
    const s = String(seconds % 60).padStart(2, '0');
    return `${m}:${s}`;
  }

  function loadSettings() {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.settings);
      if (!raw) {
        return { ...DEFAULT_SETTINGS };
      }
      const parsed = JSON.parse(raw);
      return {
        ...DEFAULT_SETTINGS,
        ...parsed
      };
    } catch {
      return { ...DEFAULT_SETTINGS };
    }
  }

  function persistSettings() {
    localStorage.setItem(STORAGE_KEYS.settings, JSON.stringify(APP.settings));
  }

  function showToast(message, type = 'ok') {
    const toast = document.createElement('div');
    toast.className = `toast ${type === 'err' ? 'err' : 'ok'}`;
    toast.textContent = message;
    DOM.toastArea.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(8px)';
      toast.style.transition = 'all 0.2s ease';
      setTimeout(() => toast.remove(), 220);
    }, 2200);
  }

  function hideAllModals() {
    DOM.backdrop.classList.add('hidden');
    DOM.authModal.classList.add('hidden');
    DOM.panelModal.classList.add('hidden');
    DOM.settingsModal.classList.add('hidden');
    DOM.authError.textContent = '';
  }

  function openModal(modalId) {
    hideAllModals();
    DOM.backdrop.classList.remove('hidden');
    document.getElementById(modalId).classList.remove('hidden');
  }

  function setAuth(token, user) {
    APP.auth.token = token || '';
    APP.auth.user = user || null;

    if (token) {
      localStorage.setItem(STORAGE_KEYS.token, token);
    } else {
      localStorage.removeItem(STORAGE_KEYS.token);
    }

    updateAuthUi();
    EVENTS.emit('auth-changed', APP.auth.user);
  }

  function updateAuthUi() {
    if (APP.auth.user) {
      DOM.authStatus.classList.add('logged');
      DOM.authStatus.textContent = `当前状态: ${APP.auth.user.nickname}`;
      DOM.authOpenBtn.textContent = '切换账号';
      DOM.authLogoutBtn.classList.remove('hidden');
      return;
    }

    DOM.authStatus.classList.remove('logged');
    DOM.authStatus.textContent = '当前状态: 游客';
    DOM.authOpenBtn.textContent = '登录 / 注册';
    DOM.authLogoutBtn.classList.add('hidden');
  }

  async function apiRequest(pathname, options = {}) {
    const headers = {
      'Content-Type': 'application/json',
      ...(options.headers || {})
    };

    if (APP.auth.token) {
      headers.Authorization = `Bearer ${APP.auth.token}`;
    }

    const response = await fetch(pathname, {
      method: options.method || 'GET',
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined
    });

    let data = {};
    try {
      data = await response.json();
    } catch {
      data = { success: false, message: '服务器返回异常' };
    }

    if (!response.ok || data.success === false) {
      throw new Error(data.message || '请求失败');
    }

    return data;
  }

  function switchAuthTab(tab) {
    const isLogin = tab !== 'register';
    DOM.tabLogin.classList.toggle('active', isLogin);
    DOM.tabRegister.classList.toggle('active', !isLogin);
    DOM.loginForm.classList.toggle('hidden', !isLogin);
    DOM.registerForm.classList.toggle('hidden', isLogin);
    DOM.authError.textContent = '';
  }

  function openAuthModal(defaultTab = 'login') {
    switchAuthTab(defaultTab);
    openModal('auth-modal');
  }

  async function tryConsumePendingSave() {
    if (!APP.pendingSaveResult || !APP.auth.token) {
      return;
    }

    const result = APP.pendingSaveResult;
    APP.pendingSaveResult = null;

    try {
      const saved = await apiRequest('/api/scores', {
        method: 'POST',
        body: {
          score: result.score,
          kills: result.kills,
          survivalTime: result.survivalTime,
          maxCombo: result.maxCombo
        }
      });

      showToast(`成绩已保存，当前最佳 ${fmtScore(saved.myBest ? saved.myBest.score : result.score)}`, 'ok');
      EVENTS.emit('score-saved', saved);
    } catch (error) {
      APP.pendingSaveResult = result;
      showToast(error.message || '成绩保存失败', 'err');
    }
  }

  async function restoreSession() {
    const token = localStorage.getItem(STORAGE_KEYS.token) || '';
    if (!token) {
      updateAuthUi();
      return;
    }

    APP.auth.token = token;

    try {
      const data = await apiRequest('/api/me');
      setAuth(token, data.user);
    } catch {
      setAuth('', null);
    }
  }

  async function fetchGameConfig() {
    try {
      const data = await apiRequest('/api/config');
      APP.config = {
        ...DEFAULT_CONFIG,
        ...(data.config || {})
      };
    } catch {
      APP.config = { ...DEFAULT_CONFIG };
      showToast('读取服务器配置失败，已使用默认配置', 'err');
    }
  }

  async function openLeaderboardPanel() {
    DOM.panelTitle.textContent = '排行榜 TOP 50';
    DOM.panelBody.innerHTML = '<p class="tip">读取排行榜中...</p>';
    openModal('panel-modal');

    try {
      const data = await apiRequest('/api/leaderboard');
      const list = data.list || [];

      if (list.length === 0) {
        DOM.panelBody.innerHTML = '<p class="tip">暂无成绩，快去打出第一条记录。</p>';
        return;
      }

      const rows = list
        .map((item) => {
          const classes = [];
          if (item.rank === 1) classes.push('rank-1');
          if (item.rank === 2) classes.push('rank-2');
          if (item.rank === 3) classes.push('rank-3');
          if (APP.auth.user && item.userId === APP.auth.user.id) classes.push('me');

          const className = classes.length ? ` class="${classes.join(' ')}"` : '';

          return `<tr${className}><td>${item.rank}</td><td>${item.nickname}</td><td>${fmtScore(item.score)}</td><td>${item.kills}</td><td>${fmtTime(item.survivalTime)}</td></tr>`;
        })
        .join('');

      const myRankHtml = data.myRank
        ? `<p class="tip">我的当前排名: 第 ${data.myRank.rank} 名，最佳分数 ${fmtScore(data.myRank.score)}</p>`
        : '<p class="tip">游客状态下不展示个人排名。</p>';

      DOM.panelBody.innerHTML = `
        <div class="table-wrap">
          <table>
            <thead>
              <tr><th>排名</th><th>昵称</th><th>分数</th><th>击毁</th><th>生存</th></tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
        ${myRankHtml}
      `;
    } catch (error) {
      DOM.panelBody.innerHTML = `<p class="tip" style="color:#fda4af;">${error.message || '读取排行榜失败'}</p>`;
    }
  }

  async function openMyScoresPanel() {
    if (!APP.auth.token) {
      showToast('请先登录后查看战绩', 'err');
      openAuthModal('login');
      return;
    }

    DOM.panelTitle.textContent = '我的历史战绩';
    DOM.panelBody.innerHTML = '<p class="tip">读取战绩中...</p>';
    openModal('panel-modal');

    try {
      const data = await apiRequest('/api/my-scores');
      const list = data.list || [];

      if (list.length === 0) {
        DOM.panelBody.innerHTML = '<p class="tip">你还没有历史记录，先来一局吧。</p>';
        return;
      }

      const rows = list
        .map(
          (item, index) =>
            `<tr><td>${index + 1}</td><td>${fmtScore(item.score)}</td><td>${item.kills}</td><td>${fmtTime(item.survivalTime)}</td><td>${new Date(item.createdAt).toLocaleString()}</td></tr>`
        )
        .join('');

      DOM.panelBody.innerHTML = `
        <div class="table-wrap">
          <table>
            <thead>
              <tr><th>#</th><th>分数</th><th>击毁</th><th>生存</th><th>时间</th></tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      `;
    } catch (error) {
      DOM.panelBody.innerHTML = `<p class="tip" style="color:#fda4af;">${error.message || '读取战绩失败'}</p>`;
    }
  }

  function openSettingsModal() {
    DOM.setMusic.checked = !!APP.settings.music;
    DOM.setSound.checked = !!APP.settings.sound;
    DOM.setAutoFire.checked = !!APP.settings.autoFire;
    DOM.setVolume.value = String(Math.round((APP.settings.volume || 0.7) * 100));
    DOM.setControl.value = APP.settings.control || 'keyboard';
    openModal('settings-modal');
  }

  function saveSettingsFromModal() {
    APP.settings = {
      ...APP.settings,
      music: DOM.setMusic.checked,
      sound: DOM.setSound.checked,
      autoFire: DOM.setAutoFire.checked,
      volume: clamp(Number(DOM.setVolume.value) / 100, 0, 1),
      control: DOM.setControl.value === 'mouse' ? 'mouse' : 'keyboard'
    };

    persistSettings();
    hideAllModals();
    EVENTS.emit('settings-changed', APP.settings);
    showToast('设置已保存', 'ok');
  }

  function createGlowButton(scene, x, y, label, onClick, width = 240, height = 52, theme = 'primary') {
    const container = scene.add.container(x, y);

    const fillByTheme = {
      primary: 0x0ea5e9,
      secondary: 0x0f172a,
      danger: 0xb91c1c
    };

    const strokeByTheme = {
      primary: 0x22d3ee,
      secondary: 0x475569,
      danger: 0xef4444
    };

    const bg = scene.add.rectangle(0, 0, width, height, fillByTheme[theme] || fillByTheme.primary, theme === 'secondary' ? 0.4 : 0.32);
    bg.setStrokeStyle(1.5, strokeByTheme[theme] || strokeByTheme.primary, 0.75);

    const glow = scene.add.rectangle(0, 0, width, height);
    glow.setStrokeStyle(3, strokeByTheme[theme] || strokeByTheme.primary, 0.2);

    const text = scene.add
      .text(0, 0, label, {
        fontFamily: 'Trebuchet MS, Noto Sans SC, sans-serif',
        fontSize: '22px',
        fontStyle: 'bold',
        color: '#e2e8f0'
      })
      .setOrigin(0.5);

    const hitArea = scene.add.zone(0, 0, width, height).setOrigin(0.5).setInteractive({ useHandCursor: true });

    hitArea.on('pointerover', () => {
      container.setScale(1.04);
      glow.setAlpha(0.62);
    });

    hitArea.on('pointerout', () => {
      container.setScale(1);
      glow.setAlpha(0.2);
    });

    hitArea.on('pointerdown', () => {
      container.setScale(0.97);
    });

    hitArea.on('pointerup', () => {
      container.setScale(1.04);
      onClick();
    });

    container.add([bg, glow, text, hitArea]);
    return container;
  }

  function ensureTextures(scene) {
    if (scene.textures.exists('ship-player')) {
      return;
    }

    const g = scene.make.graphics({ x: 0, y: 0, add: false });

    g.clear();
    g.fillStyle(0x22d3ee, 1);
    g.fillTriangle(18, 0, 0, 44, 36, 44);
    g.fillStyle(0x0f172a, 1);
    g.fillRect(14, 16, 8, 20);
    g.generateTexture('ship-player', 36, 44);

    g.clear();
    g.fillStyle(0x93c5fd, 1);
    g.fillRoundedRect(0, 0, 6, 16, 3);
    g.generateTexture('bullet-player', 6, 16);

    g.clear();
    g.fillStyle(0xfca5a5, 1);
    g.fillRoundedRect(0, 0, 6, 14, 3);
    g.generateTexture('bullet-enemy', 6, 14);

    g.clear();
    g.fillStyle(0xfb7185, 1);
    g.fillRoundedRect(2, 0, 28, 22, 7);
    g.fillStyle(0x7f1d1d, 1);
    g.fillRect(12, 4, 8, 8);
    g.generateTexture('enemy-normal', 32, 24);

    g.clear();
    g.fillStyle(0xf97316, 1);
    g.fillRoundedRect(2, 0, 24, 20, 7);
    g.fillStyle(0x7c2d12, 1);
    g.fillRect(9, 4, 8, 8);
    g.generateTexture('enemy-fast', 28, 20);

    g.clear();
    g.fillStyle(0x94a3b8, 1);
    g.fillRoundedRect(0, 0, 40, 30, 8);
    g.fillStyle(0x334155, 1);
    g.fillRect(15, 8, 10, 10);
    g.generateTexture('enemy-heavy', 40, 30);

    g.clear();
    g.fillStyle(0xc084fc, 1);
    g.fillRoundedRect(0, 0, 34, 26, 8);
    g.fillStyle(0x6d28d9, 1);
    g.fillRect(12, 8, 10, 10);
    g.generateTexture('enemy-shooter', 34, 26);

    g.clear();
    g.fillStyle(0xfacc15, 1);
    g.fillCircle(10, 10, 10);
    g.generateTexture('power-fire', 20, 20);

    g.clear();
    g.fillStyle(0x38bdf8, 1);
    g.fillCircle(10, 10, 10);
    g.generateTexture('power-shield', 20, 20);

    g.clear();
    g.fillStyle(0x22c55e, 1);
    g.fillCircle(10, 10, 10);
    g.generateTexture('power-heal', 20, 20);

    g.clear();
    g.fillStyle(0xf97316, 1);
    g.fillCircle(10, 10, 10);
    g.generateTexture('power-bomb', 20, 20);

    g.clear();
    g.fillStyle(0xa3e635, 1);
    g.fillCircle(10, 10, 10);
    g.generateTexture('power-double', 20, 20);

    g.clear();
    g.fillStyle(0xffffff, 1);
    g.fillCircle(4, 4, 4);
    g.generateTexture('spark', 8, 8);

    g.destroy();
  }

  function disableBodyObject(gameObject) {
    if (!gameObject) {
      return;
    }

    gameObject.setActive(false);
    gameObject.setVisible(false);

    if (gameObject.body) {
      gameObject.body.stop();
      gameObject.body.enable = false;
    }
  }

  function addStarfield(scene, count = 90) {
    const stars = [];
    for (let i = 0; i < count; i += 1) {
      const x = Phaser.Math.Between(0, GAME_WIDTH);
      const y = Phaser.Math.Between(0, GAME_HEIGHT);
      const size = Phaser.Math.FloatBetween(0.8, 2.2);
      const alpha = Phaser.Math.FloatBetween(0.2, 0.9);
      const star = scene.add.circle(x, y, size, 0x93c5fd, alpha);
      star.speed = Phaser.Math.FloatBetween(18, 120);
      stars.push(star);
    }

    return {
      update(delta) {
        const step = delta / 1000;
        for (const star of stars) {
          star.y += star.speed * step;
          if (star.y > GAME_HEIGHT + 2) {
            star.y = -4;
            star.x = Phaser.Math.Between(0, GAME_WIDTH);
          }
        }
      },
      destroy() {
        stars.forEach((star) => star.destroy());
      }
    };
  }

  class LoadingScene extends Phaser.Scene {
    constructor() {
      super('LoadingScene');
      this.starfield = null;
    }

    async create() {
      ensureTextures(this);
      this.starfield = addStarfield(this, 70);

      this.add.text(GAME_WIDTH / 2, 180, '星际突击', {
        fontFamily: 'Trebuchet MS, Noto Sans SC, sans-serif',
        fontSize: '58px',
        fontStyle: 'bold',
        color: '#e2e8f0'
      }).setOrigin(0.5);

      this.add.text(GAME_WIDTH / 2, 238, 'Space Strike', {
        fontFamily: 'Trebuchet MS, sans-serif',
        fontSize: '22px',
        color: '#94a3b8'
      }).setOrigin(0.5);

      const barBg = this.add.rectangle(GAME_WIDTH / 2, 300, 440, 22, 0x0f172a, 0.7);
      barBg.setStrokeStyle(1, 0x22d3ee, 0.45);

      const bar = this.add.rectangle(GAME_WIDTH / 2 - 220, 300, 2, 14, 0x22d3ee, 0.95).setOrigin(0, 0.5);
      const percentText = this.add.text(GAME_WIDTH / 2, 330, '0%', {
        fontFamily: 'Trebuchet MS, sans-serif',
        fontSize: '18px',
        color: '#22d3ee'
      }).setOrigin(0.5);

      const tipText = this.add.text(GAME_WIDTH / 2, 366, '正在校准引擎系统...', {
        fontFamily: 'Trebuchet MS, Noto Sans SC, sans-serif',
        fontSize: '16px',
        color: '#94a3b8'
      }).setOrigin(0.5);

      const steps = [
        async () => {
          await sleep(220);
        },
        async () => {
          await fetchGameConfig();
        },
        async () => {
          await sleep(220);
        },
        async () => {
          await restoreSession();
        },
        async () => {
          await sleep(160);
        }
      ];

      for (let i = 0; i < steps.length; i += 1) {
        await steps[i]();
        const progress = (i + 1) / steps.length;
        bar.width = 436 * progress;
        percentText.setText(`${Math.round(progress * 100)}%`);
      }

      tipText.setText('跃迁完成，准备出击...');

      this.tweens.add({
        targets: [barBg, bar, percentText, tipText],
        alpha: 0,
        duration: 280,
        delay: 200,
        onComplete: () => {
          this.scene.start('MenuScene');
        }
      });
    }

    update(_time, delta) {
      if (this.starfield) {
        this.starfield.update(delta);
      }
    }
  }

  class MenuScene extends Phaser.Scene {
    constructor() {
      super('MenuScene');
      this.starfield = null;
      this.menuButtons = [];
      this.userText = null;
      this.authListener = null;
    }

    create() {
      this.starfield = addStarfield(this, 95);

      this.add.rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, 0x020617, 0.22);

      this.add.text(GAME_WIDTH / 2, 100, '星际突击', {
        fontFamily: 'Trebuchet MS, Noto Sans SC, sans-serif',
        fontSize: '66px',
        fontStyle: 'bold',
        color: '#e2e8f0'
      }).setOrigin(0.5);

      this.add.text(GAME_WIDTH / 2, 154, 'Space Strike', {
        fontFamily: 'Trebuchet MS, sans-serif',
        fontSize: '24px',
        color: '#38bdf8'
      }).setOrigin(0.5);

      this.userText = this.add.text(GAME_WIDTH / 2, 194, '', {
        fontFamily: 'Noto Sans SC, sans-serif',
        fontSize: '18px',
        color: '#94a3b8'
      }).setOrigin(0.5);

      const ship = this.add.image(GAME_WIDTH / 2, 250, 'ship-player');
      ship.setScale(1.4);

      this.tweens.add({
        targets: ship,
        y: 238,
        duration: 1000,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut'
      });

      this.refreshMenu();

      this.add.text(GAME_WIDTH / 2, GAME_HEIGHT - 56, '操作: WASD/方向键移动，空格/鼠标左键射击，P/ESC 暂停', {
        fontFamily: 'Noto Sans SC, sans-serif',
        fontSize: '14px',
        color: '#94a3b8'
      }).setOrigin(0.5);

      this.add.text(GAME_WIDTH - 16, GAME_HEIGHT - 18, 'v1.0.0', {
        fontFamily: 'Trebuchet MS, sans-serif',
        fontSize: '12px',
        color: '#64748b'
      }).setOrigin(1, 0.5);

      this.authListener = () => this.refreshMenu();
      EVENTS.on('auth-changed', this.authListener);

      this.events.on('shutdown', () => {
        if (this.authListener) {
          EVENTS.off('auth-changed', this.authListener);
          this.authListener = null;
        }
      });
    }

    refreshMenu() {
      this.menuButtons.forEach((btn) => btn.destroy());
      this.menuButtons = [];

      if (APP.auth.user) {
        this.userText.setText(`欢迎回来，${APP.auth.user.nickname}`);
      } else {
        this.userText.setText('游客模式: 立即开始，无需登录');
      }

      const centerX = GAME_WIDTH / 2;
      let y = 316;

      this.menuButtons.push(
        createGlowButton(this, centerX, y, '开始游戏', () => this.scene.start('GameScene'), 280, 56, 'primary')
      );

      y += 64;
      this.menuButtons.push(
        createGlowButton(this, centerX, y, '排行榜', () => openLeaderboardPanel(), 280, 52, 'secondary')
      );

      y += 58;
      if (APP.auth.user) {
        this.menuButtons.push(
          createGlowButton(this, centerX, y, '我的战绩', () => openMyScoresPanel(), 280, 50, 'secondary')
        );
      } else {
        this.menuButtons.push(
          createGlowButton(this, centerX, y, '登录 / 注册', () => openAuthModal('login'), 280, 50, 'secondary')
        );
      }

      y += 56;
      this.menuButtons.push(
        createGlowButton(this, centerX, y, '设置', () => openSettingsModal(), 280, 48, 'secondary')
      );
    }

    update(_time, delta) {
      if (this.starfield) {
        this.starfield.update(delta);
      }
    }
  }

  class GameScene extends Phaser.Scene {
    constructor() {
      super('GameScene');
      this.starfield = null;
      this.player = null;
      this.playerBullets = null;
      this.enemyBullets = null;
      this.enemies = null;
      this.powerUps = null;
      this.keys = null;
      this.score = 0;
      this.kills = 0;
      this.hp = 3;
      this.maxHp = 5;
      this.wave = 1;
      this.combo = 0;
      this.maxCombo = 0;
      this.lastKillAt = 0;
      this.startedAt = 0;
      this.ended = false;
      this.nextShotAt = 0;
      this.fireLevel = 1;
      this.doubleScoreUntil = 0;
      this.shieldUntil = 0;
      this.invincibleUntil = 0;
      this.spawnInterval = 1000;
      this.nextSpawnAt = 0;
      this.nextDifficultyAt = 0;
      this.enemySpeedBonus = 0;
      this.survivalSeconds = 0;
      this.nextSecondTickAt = 0;
      this.hud = {};
      this.pausePressedLast = false;
      this.shieldVisual = null;
      this.sparkEmitter = null;
    }

    create() {
      this.starfield = addStarfield(this, 120);

      const gameCfg = APP.config.game || DEFAULT_CONFIG.game;
      this.hp = Number(gameCfg.playerHp) || 3;
      this.spawnInterval = Number(gameCfg.enemySpawnInterval) || 1000;
      this.nextSpawnAt = this.time.now + 600;
      this.nextDifficultyAt = this.time.now + (Number(gameCfg.difficultyIncreaseInterval) || 30000);
      this.nextSecondTickAt = this.time.now + 1000;
      this.startedAt = this.time.now;

      this.player = this.physics.add.image(GAME_WIDTH / 2, GAME_HEIGHT - 72, 'ship-player');
      this.player.setCollideWorldBounds(true);
      this.player.setDepth(4);

      this.shieldVisual = this.add.circle(this.player.x, this.player.y, 26, 0x22d3ee, 0.06);
      this.shieldVisual.setStrokeStyle(2, 0x22d3ee, 0.7);
      this.shieldVisual.setDepth(3);
      this.shieldVisual.setVisible(false);

      this.playerBullets = this.physics.add.group({ maxSize: 120, classType: Phaser.Physics.Arcade.Image });
      this.enemyBullets = this.physics.add.group({ maxSize: 120, classType: Phaser.Physics.Arcade.Image });
      this.enemies = this.physics.add.group({ maxSize: 80, classType: Phaser.Physics.Arcade.Image });
      this.powerUps = this.physics.add.group({ maxSize: 40, classType: Phaser.Physics.Arcade.Image });

      this.physics.add.overlap(this.playerBullets, this.enemies, this.onPlayerBulletHitEnemy, undefined, this);
      this.physics.add.overlap(this.player, this.enemies, this.onPlayerCollideEnemy, undefined, this);
      this.physics.add.overlap(this.player, this.enemyBullets, this.onPlayerHitEnemyBullet, undefined, this);
      this.physics.add.overlap(this.player, this.powerUps, this.onPlayerGetPowerUp, undefined, this);

      this.keys = this.input.keyboard.addKeys({
        upW: 'W',
        downS: 'S',
        leftA: 'A',
        rightD: 'D',
        up: 'UP',
        down: 'DOWN',
        left: 'LEFT',
        right: 'RIGHT',
        shoot: 'SPACE',
        pauseEsc: 'ESC',
        pauseP: 'P'
      });

      this.createHud();

      const particles = this.add.particles(0, 0, 'spark', {
        speed: { min: 10, max: 140 },
        angle: { min: 0, max: 360 },
        lifespan: 340,
        scale: { start: 0.65, end: 0 },
        quantity: 0,
        emitting: false,
        blendMode: 'ADD'
      });
      particles.setDepth(2);
      this.sparkEmitter = particles;

      this.events.once('shutdown', () => {
        if (this.sparkEmitter) {
          this.sparkEmitter.destroy();
          this.sparkEmitter = null;
        }
      });
    }

    createHud() {
      this.hud.hp = this.add.text(14, 12, '', {
        fontFamily: 'Noto Sans SC, sans-serif',
        fontSize: '22px',
        color: '#f8fafc'
      }).setDepth(20);

      this.hud.score = this.add.text(GAME_WIDTH / 2, 12, '', {
        fontFamily: 'Trebuchet MS, sans-serif',
        fontSize: '28px',
        fontStyle: 'bold',
        color: '#f8fafc'
      }).setOrigin(0.5, 0).setDepth(20);

      this.hud.wave = this.add.text(GAME_WIDTH - 14, 12, '', {
        fontFamily: 'Trebuchet MS, Noto Sans SC, sans-serif',
        fontSize: '20px',
        color: '#22d3ee'
      }).setOrigin(1, 0).setDepth(20);

      this.hud.buff = this.add.text(GAME_WIDTH - 14, 42, '', {
        fontFamily: 'Noto Sans SC, sans-serif',
        fontSize: '14px',
        color: '#a3e635',
        align: 'right'
      }).setOrigin(1, 0).setDepth(20);

      this.hud.time = this.add.text(14, 44, '时间 00:00', {
        fontFamily: 'Trebuchet MS, Noto Sans SC, sans-serif',
        fontSize: '16px',
        color: '#94a3b8'
      }).setDepth(20);

      this.refreshHud();
    }

    refreshHud() {
      const hearts = '♥'.repeat(this.hp) + '·'.repeat(Math.max(0, 3 - this.hp));
      this.hud.hp.setText(`生命 ${hearts}`);
      this.hud.score.setText(`SCORE ${String(this.score).padStart(6, '0')}`);
      this.hud.wave.setText(`Wave ${String(this.wave).padStart(2, '0')}`);
      this.hud.time.setText(`时间 ${fmtTime(this.survivalSeconds)}`);

      const buffs = [];
      if (this.fireLevel > 1) {
        buffs.push(`火力 Lv${this.fireLevel}`);
      }
      if (this.time.now < this.doubleScoreUntil) {
        buffs.push(`双倍 ${Math.ceil((this.doubleScoreUntil - this.time.now) / 1000)}s`);
      }
      if (this.time.now < this.shieldUntil) {
        buffs.push(`护盾 ${Math.ceil((this.shieldUntil - this.time.now) / 1000)}s`);
      }
      this.hud.buff.setText(buffs.join(' | '));
    }

    update(time, delta) {
      if (this.ended) {
        return;
      }

      if (this.starfield) {
        this.starfield.update(delta);
      }

      this.handlePause();
      this.handleMovement();
      this.handleShooting(time);
      this.handleSpawning(time);
      this.updateEnemies(time);
      this.cleanupObjects();
      this.updateTimeAndDifficulty(time);
      this.updateShieldVisual();
      this.refreshHud();
    }

    handlePause() {
      const pausePressed = this.keys.pauseEsc.isDown || this.keys.pauseP.isDown;
      if (pausePressed && !this.pausePressedLast) {
        this.scene.pause();
        this.scene.launch('PauseScene', {
          returnScene: 'GameScene'
        });
      }
      this.pausePressedLast = pausePressed;
    }

    handleMovement() {
      const controlMode = APP.settings.control || 'keyboard';
      const speed = Number((APP.config.game || DEFAULT_CONFIG.game).playerSpeed) || 320;

      if (controlMode === 'mouse') {
        const pointer = this.input.activePointer;
        this.player.x = Phaser.Math.Linear(this.player.x, clamp(pointer.x, 20, GAME_WIDTH - 20), 0.18);
        this.player.y = Phaser.Math.Linear(this.player.y, clamp(pointer.y, 60, GAME_HEIGHT - 24), 0.18);
        this.player.body.setVelocity(0, 0);
        this.player.rotation = (pointer.x - this.player.x) * 0.0012;
        return;
      }

      let vx = 0;
      let vy = 0;

      if (this.keys.leftA.isDown || this.keys.left.isDown) {
        vx = -speed;
      } else if (this.keys.rightD.isDown || this.keys.right.isDown) {
        vx = speed;
      }

      if (this.keys.upW.isDown || this.keys.up.isDown) {
        vy = -speed;
      } else if (this.keys.downS.isDown || this.keys.down.isDown) {
        vy = speed;
      }

      this.player.body.setVelocity(vx, vy);
      this.player.rotation = vx * 0.0012;
    }

    handleShooting(time) {
      const pointerDown = this.input.activePointer.isDown;
      const shouldShoot = APP.settings.autoFire || this.keys.shoot.isDown || pointerDown;

      if (!shouldShoot || time < this.nextShotAt) {
        return;
      }

      this.nextShotAt = time + Math.max(95, 180 - this.fireLevel * 20);
      this.firePlayerBullets();
    }

    firePlayerBullets() {
      const offsets = this.fireLevel === 1 ? [0] : this.fireLevel === 2 ? [-10, 10] : [-14, 0, 14];

      for (const offset of offsets) {
        const bullet = this.playerBullets.get(this.player.x + offset, this.player.y - 26, 'bullet-player');
        if (!bullet) {
          continue;
        }

        bullet.setActive(true).setVisible(true);
        bullet.body.enable = true;
        bullet.body.allowGravity = false;
        bullet.setVelocity(0, -560);
      }

      this.sparkEmitter.emitParticleAt(this.player.x, this.player.y - 28, 4);
    }

    handleSpawning(time) {
      if (time < this.nextSpawnAt) {
        return;
      }

      this.spawnEnemy();
      this.nextSpawnAt = time + this.spawnInterval;
    }

    pickEnemyType() {
      const scoreCfg = APP.config.score || DEFAULT_CONFIG.score;
      const heavierBoost = Math.min(20, this.wave * 2);
      const shooterBoost = Math.min(16, this.wave * 1.4);

      const types = [
        {
          key: 'enemy-normal',
          hp: 1,
          score: Number(scoreCfg.normalEnemy) || 100,
          speed: 120,
          weight: Math.max(25, 62 - this.wave * 2),
          scale: 1,
          shooter: false
        },
        {
          key: 'enemy-fast',
          hp: 1,
          score: Number(scoreCfg.fastEnemy) || 150,
          speed: 190,
          weight: 22,
          scale: 0.95,
          shooter: false
        },
        {
          key: 'enemy-heavy',
          hp: 4,
          score: Number(scoreCfg.heavyEnemy) || 500,
          speed: 95,
          weight: 10 + heavierBoost,
          scale: 1.15,
          shooter: false
        },
        {
          key: 'enemy-shooter',
          hp: 3,
          score: Number(scoreCfg.shooterEnemy) || 350,
          speed: 125,
          weight: 8 + shooterBoost,
          scale: 1.05,
          shooter: true
        }
      ];

      const totalWeight = types.reduce((sum, item) => sum + item.weight, 0);
      let roll = Math.random() * totalWeight;

      for (const type of types) {
        roll -= type.weight;
        if (roll <= 0) {
          return type;
        }
      }

      return types[0];
    }

    spawnEnemy() {
      const type = this.pickEnemyType();
      const x = Phaser.Math.Between(26, GAME_WIDTH - 26);

      const enemy = this.enemies.get(x, -36, type.key);
      if (!enemy) {
        return;
      }

      enemy.setActive(true).setVisible(true);
      enemy.body.enable = true;
      enemy.setScale(type.scale);
      enemy.hp = type.hp + (this.wave > 8 && type.key === 'enemy-heavy' ? 1 : 0);
      enemy.reward = type.score;
      enemy.typeKey = type.key;
      enemy.shooter = type.shooter;
      enemy.nextShotAt = this.time.now + Phaser.Math.Between(900, 1800);

      const speed = (type.speed + this.enemySpeedBonus) * Phaser.Math.FloatBetween(0.95, 1.08);
      enemy.setVelocity(Phaser.Math.Between(-12, 12), speed);
    }

    updateEnemies(time) {
      this.enemies.children.each((enemy) => {
        if (!enemy || !enemy.active) {
          return;
        }

        if (enemy.shooter && time >= enemy.nextShotAt) {
          this.fireEnemyBullet(enemy);
          enemy.nextShotAt = time + Phaser.Math.Between(900, 1500) - Math.min(350, this.wave * 25);
        }

        if (enemy.y > GAME_HEIGHT + 40) {
          disableBodyObject(enemy);
        }
      });

      this.powerUps.children.each((item) => {
        if (!item || !item.active) {
          return;
        }
        item.angle += 1.8;
      });
    }

    fireEnemyBullet(enemy) {
      const bullet = this.enemyBullets.get(enemy.x, enemy.y + 12, 'bullet-enemy');
      if (!bullet) {
        return;
      }

      bullet.setActive(true).setVisible(true);
      bullet.body.enable = true;
      bullet.body.allowGravity = false;

      const angle = Phaser.Math.Angle.Between(enemy.x, enemy.y, this.player.x, this.player.y);
      const speed = 240 + Math.min(this.wave * 12, 130);
      bullet.setVelocity(Math.cos(angle) * speed, Math.sin(angle) * speed);
    }

    onPlayerBulletHitEnemy(bullet, enemy) {
      disableBodyObject(bullet);

      if (!enemy.active) {
        return;
      }

      enemy.hp -= 1;
      enemy.setTintFill(0xffffff);
      this.time.delayedCall(60, () => {
        if (enemy && enemy.active) {
          enemy.clearTint();
        }
      });

      if (enemy.hp > 0) {
        return;
      }

      this.destroyEnemy(enemy);
    }

    onPlayerCollideEnemy(player, enemy) {
      if (enemy.active) {
        this.destroyEnemy(enemy, false);
      }
      this.damagePlayer(player.x, player.y);
    }

    onPlayerHitEnemyBullet(player, bullet) {
      disableBodyObject(bullet);
      this.damagePlayer(player.x, player.y);
    }

    onPlayerGetPowerUp(player, powerUp) {
      const powerType = powerUp.powerType;
      disableBodyObject(powerUp);
      this.applyPowerUp(powerType);
    }

    maybeDropPowerUp(x, y) {
      const roll = Math.random();
      let powerType = '';
      let texture = '';

      if (roll < 0.12) {
        powerType = 'fire';
        texture = 'power-fire';
      } else if (roll < 0.2) {
        powerType = 'shield';
        texture = 'power-shield';
      } else if (roll < 0.25) {
        powerType = 'heal';
        texture = 'power-heal';
      } else if (roll < 0.28) {
        powerType = 'bomb';
        texture = 'power-bomb';
      } else if (roll < 0.34) {
        powerType = 'double';
        texture = 'power-double';
      }

      if (!powerType) {
        return;
      }

      const drop = this.powerUps.get(x, y, texture);
      if (!drop) {
        return;
      }

      drop.powerType = powerType;
      drop.setActive(true).setVisible(true);
      drop.body.enable = true;
      drop.body.allowGravity = false;
      drop.setVelocity(Phaser.Math.Between(-30, 30), Phaser.Math.Between(88, 128));
      drop.setDrag(8, 0);
      drop.setScale(1);
      drop.setAlpha(0.9);
    }

    applyPowerUp(powerType) {
      if (powerType === 'fire') {
        this.fireLevel = Math.min(3, this.fireLevel + 1);
        showToast('火力升级', 'ok');
        return;
      }

      if (powerType === 'shield') {
        this.shieldUntil = this.time.now + 10000;
        showToast('护盾已激活', 'ok');
        return;
      }

      if (powerType === 'heal') {
        this.hp = Math.min(this.maxHp, this.hp + 1);
        showToast('生命恢复 +1', 'ok');
        return;
      }

      if (powerType === 'bomb') {
        let destroyed = 0;
        this.enemies.children.each((enemy) => {
          if (!enemy || !enemy.active) {
            return;
          }

          if (enemy.typeKey === 'enemy-heavy') {
            enemy.hp -= 2;
            if (enemy.hp <= 0) {
              this.destroyEnemy(enemy);
              destroyed += 1;
            }
            return;
          }

          this.destroyEnemy(enemy);
          destroyed += 1;
        });

        if (destroyed > 0) {
          showToast(`清屏炸弹生效，击毁 ${destroyed} 敌机`, 'ok');
        } else {
          showToast('清屏炸弹已触发', 'ok');
        }
        return;
      }

      if (powerType === 'double') {
        this.doubleScoreUntil = Math.max(this.doubleScoreUntil, this.time.now) + 15000;
        showToast('双倍积分 15s', 'ok');
      }
    }

    destroyEnemy(enemy, grantReward = true) {
      if (!enemy || !enemy.active) {
        return;
      }

      const x = enemy.x;
      const y = enemy.y;
      const reward = enemy.reward || 100;

      this.sparkEmitter.emitParticleAt(x, y, 14);
      disableBodyObject(enemy);

      if (grantReward) {
        const now = this.time.now;

        if (now - this.lastKillAt <= 1200) {
          this.combo += 1;
        } else {
          this.combo = 1;
        }

        this.lastKillAt = now;
        this.maxCombo = Math.max(this.maxCombo, this.combo);

        let gained = reward;
        if (this.time.now < this.doubleScoreUntil) {
          gained *= 2;
        }

        if (this.combo % 10 === 0) {
          gained += 300;
        }

        this.score += gained;
        this.kills += 1;
      }

      this.maybeDropPowerUp(x, y);
    }

    damagePlayer(hitX, hitY) {
      if (this.time.now < this.invincibleUntil) {
        return;
      }

      if (this.time.now < this.shieldUntil) {
        this.shieldUntil = 0;
        this.invincibleUntil = this.time.now + 400;
        this.cameras.main.shake(80, 0.0025);
        showToast('护盾抵挡了伤害', 'ok');
        return;
      }

      this.hp -= 1;
      this.invincibleUntil = this.time.now + 1200;

      this.player.setTint(0xfca5a5);
      this.time.delayedCall(160, () => {
        if (this.player && this.player.active) {
          this.player.clearTint();
        }
      });

      this.sparkEmitter.emitParticleAt(hitX, hitY, 10);
      this.cameras.main.shake(120, 0.006);

      if (this.hp <= 0) {
        this.endGame();
      }
    }

    updateTimeAndDifficulty(time) {
      if (time >= this.nextSecondTickAt) {
        this.survivalSeconds += 1;
        this.nextSecondTickAt += 1000;

        if (this.survivalSeconds % 10 === 0) {
          let bonus = 100;
          if (time < this.doubleScoreUntil) {
            bonus *= 2;
          }
          this.score += bonus;
        }
      }

      if (time >= this.nextDifficultyAt) {
        this.wave += 1;
        this.enemySpeedBonus += 9;
        this.spawnInterval = Math.max(300, this.spawnInterval - 90);
        this.nextDifficultyAt += Number((APP.config.game || DEFAULT_CONFIG.game).difficultyIncreaseInterval) || 30000;
        showToast(`Wave ${this.wave} 来袭`, 'ok');
      }
    }

    updateShieldVisual() {
      if (!this.shieldVisual || !this.player) {
        return;
      }

      if (this.time.now < this.shieldUntil) {
        this.shieldVisual.setVisible(true);
        this.shieldVisual.x = this.player.x;
        this.shieldVisual.y = this.player.y;
        this.shieldVisual.setScale(1 + Math.sin(this.time.now / 160) * 0.04);
      } else {
        this.shieldVisual.setVisible(false);
      }
    }

    cleanupObjects() {
      this.playerBullets.children.each((bullet) => {
        if (bullet && bullet.active && bullet.y < -20) {
          disableBodyObject(bullet);
        }
      });

      this.enemyBullets.children.each((bullet) => {
        if (!bullet || !bullet.active) {
          return;
        }

        if (bullet.y > GAME_HEIGHT + 26 || bullet.y < -30 || bullet.x < -30 || bullet.x > GAME_WIDTH + 30) {
          disableBodyObject(bullet);
        }
      });

      this.powerUps.children.each((item) => {
        if (item && item.active && item.y > GAME_HEIGHT + 28) {
          disableBodyObject(item);
        }
      });
    }

    endGame() {
      if (this.ended) {
        return;
      }

      this.ended = true;

      const result = {
        score: this.score,
        kills: this.kills,
        survivalTime: this.survivalSeconds,
        maxCombo: this.maxCombo
      };

      APP.lastResult = result;
      this.scene.start('ResultScene', { result });
    }
  }

  class PauseScene extends Phaser.Scene {
    constructor() {
      super('PauseScene');
      this.returnScene = 'GameScene';
    }

    init(data) {
      this.returnScene = (data && data.returnScene) || 'GameScene';
    }

    create() {
      this.add.rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, 0x020617, 0.72);

      this.add.text(GAME_WIDTH / 2, 170, '游戏暂停', {
        fontFamily: 'Noto Sans SC, sans-serif',
        fontSize: '48px',
        fontStyle: 'bold',
        color: '#e2e8f0'
      }).setOrigin(0.5);

      createGlowButton(this, GAME_WIDTH / 2, 260, '继续游戏', () => {
        this.scene.stop();
        this.scene.resume(this.returnScene);
      }, 260, 52, 'primary');

      createGlowButton(this, GAME_WIDTH / 2, 326, '重新开始', () => {
        this.scene.stop(this.returnScene);
        this.scene.stop();
        this.scene.start('GameScene');
      }, 260, 50, 'secondary');

      createGlowButton(this, GAME_WIDTH / 2, 386, '返回首页', () => {
        this.scene.stop(this.returnScene);
        this.scene.stop();
        this.scene.start('MenuScene');
      }, 260, 48, 'secondary');
    }
  }

  class ResultScene extends Phaser.Scene {
    constructor() {
      super('ResultScene');
      this.result = null;
      this.saveText = null;
      this.saved = false;
      this.scoreSavedHandler = null;
    }

    init(data) {
      this.result = (data && data.result) || APP.lastResult || {
        score: 0,
        kills: 0,
        survivalTime: 0,
        maxCombo: 0
      };
    }

    create() {
      this.add.rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, 0x020617, 0.95);
      const spark = addStarfield(this, 75);
      this.events.on('update', (_time, delta) => spark.update(delta));
      this.events.once('shutdown', () => spark.destroy());

      this.add.text(GAME_WIDTH / 2, 90, 'GAME OVER', {
        fontFamily: 'Trebuchet MS, sans-serif',
        fontSize: '64px',
        fontStyle: 'bold',
        color: '#fda4af'
      }).setOrigin(0.5);

      this.add.text(GAME_WIDTH / 2, 154, `本局得分: ${fmtScore(this.result.score)}`, {
        fontFamily: 'Noto Sans SC, sans-serif',
        fontSize: '32px',
        color: '#e2e8f0'
      }).setOrigin(0.5);

      this.add.text(
        GAME_WIDTH / 2,
        194,
        `击毁敌机: ${this.result.kills}    生存时间: ${fmtTime(this.result.survivalTime)}    最高连击: ${this.result.maxCombo}`,
        {
          fontFamily: 'Noto Sans SC, sans-serif',
          fontSize: '18px',
          color: '#94a3b8'
        }
      ).setOrigin(0.5);

      this.saveText = this.add.text(GAME_WIDTH / 2, 236, '', {
        fontFamily: 'Noto Sans SC, sans-serif',
        fontSize: '18px',
        color: '#22c55e',
        align: 'center'
      }).setOrigin(0.5);

      this.renderSaveHint();

      createGlowButton(this, GAME_WIDTH / 2, 304, '再来一局', () => this.scene.start('GameScene'), 260, 52, 'primary');
      createGlowButton(this, GAME_WIDTH / 2, 366, '查看排行榜', () => openLeaderboardPanel(), 260, 50, 'secondary');
      createGlowButton(this, GAME_WIDTH / 2, 424, '返回首页', () => this.scene.start('MenuScene'), 260, 48, 'secondary');

      if (!APP.auth.token) {
        createGlowButton(this, GAME_WIDTH / 2, 482, '登录并保存成绩', () => {
          APP.pendingSaveResult = { ...this.result };
          openAuthModal('login');
          showToast('登录后会自动保存当前成绩', 'ok');
        }, 300, 44, 'secondary');
      }

      this.scoreSavedHandler = (payload) => {
        if (!payload || this.saved) {
          return;
        }

        this.saved = true;
        const best = payload.myBest ? fmtScore(payload.myBest.score) : fmtScore(this.result.score);
        const rankText = payload.myBest ? `，当前排名第 ${payload.myBest.rank} 名` : '';
        this.saveText.setColor('#22c55e');
        this.saveText.setText(`成绩已保存，最佳分数 ${best}${rankText}`);
      };

      EVENTS.on('score-saved', this.scoreSavedHandler);
      this.events.once('shutdown', () => {
        if (this.scoreSavedHandler) {
          EVENTS.off('score-saved', this.scoreSavedHandler);
          this.scoreSavedHandler = null;
        }
      });
    }

    async renderSaveHint() {
      if (!APP.auth.token) {
        this.saveText.setColor('#94a3b8');
        this.saveText.setText('游客模式下不会自动保存成绩，登录后可加入排行榜。');
        return;
      }

      try {
        const saved = await apiRequest('/api/scores', {
          method: 'POST',
          body: {
            score: this.result.score,
            kills: this.result.kills,
            survivalTime: this.result.survivalTime,
            maxCombo: this.result.maxCombo
          }
        });

        this.saved = true;
        const best = saved.myBest ? fmtScore(saved.myBest.score) : fmtScore(this.result.score);
        const rankText = saved.myBest ? `，当前排名第 ${saved.myBest.rank} 名` : '';
        this.saveText.setColor('#22c55e');
        this.saveText.setText(`成绩已保存，最佳分数 ${best}${rankText}`);
      } catch (error) {
        this.saveText.setColor('#fda4af');
        this.saveText.setText(`保存失败: ${error.message || '请稍后重试'}`);
      }
    }
  }

  function wireDomEvents() {
    DOM.authOpenBtn.addEventListener('click', () => openAuthModal('login'));

    DOM.authLogoutBtn.addEventListener('click', async () => {
      try {
        await apiRequest('/api/logout', { method: 'POST' });
      } catch {
        // noop
      }
      setAuth('', null);
      showToast('已退出登录', 'ok');
    });

    DOM.tabLogin.addEventListener('click', () => switchAuthTab('login'));
    DOM.tabRegister.addEventListener('click', () => switchAuthTab('register'));

    DOM.loginForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      DOM.authError.textContent = '';

      const formData = new FormData(DOM.loginForm);
      const account = String(formData.get('account') || '').trim();
      const password = String(formData.get('password') || '');

      try {
        const data = await apiRequest('/api/login', {
          method: 'POST',
          body: { account, password }
        });

        setAuth(data.token, data.user);
        hideAllModals();
        showToast(`欢迎回来，${data.user.nickname}`, 'ok');
        await tryConsumePendingSave();
      } catch (error) {
        DOM.authError.textContent = error.message || '登录失败';
      }
    });

    DOM.registerForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      DOM.authError.textContent = '';

      const formData = new FormData(DOM.registerForm);
      const account = String(formData.get('account') || '').trim();
      const nickname = String(formData.get('nickname') || '').trim();
      const password = String(formData.get('password') || '');
      const confirmPassword = String(formData.get('confirmPassword') || '');

      if (password !== confirmPassword) {
        DOM.authError.textContent = '确认密码必须与密码一致';
        return;
      }

      try {
        const data = await apiRequest('/api/register', {
          method: 'POST',
          body: { account, nickname, password }
        });

        setAuth(data.token, data.user);
        hideAllModals();
        showToast(`注册成功，欢迎 ${data.user.nickname}`, 'ok');
        await tryConsumePendingSave();
      } catch (error) {
        DOM.authError.textContent = error.message || '注册失败';
      }
    });

    DOM.saveSettingsBtn.addEventListener('click', saveSettingsFromModal);

    document.querySelectorAll('[data-close-modal]').forEach((button) => {
      button.addEventListener('click', () => hideAllModals());
    });

    DOM.backdrop.addEventListener('click', () => hideAllModals());

    window.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !DOM.backdrop.classList.contains('hidden')) {
        hideAllModals();
      }
    });

    EVENTS.on('open-leaderboard', () => openLeaderboardPanel());
    EVENTS.on('open-my-scores', () => openMyScoresPanel());
    EVENTS.on('open-settings', () => openSettingsModal());
    EVENTS.on('open-auth', () => openAuthModal('login'));
  }

  wireDomEvents();
  updateAuthUi();

  const phaserConfig = {
    type: Phaser.AUTO,
    parent: 'game-root',
    width: GAME_WIDTH,
    height: GAME_HEIGHT,
    backgroundColor: '#020617',
    physics: {
      default: 'arcade',
      arcade: {
        debug: false
      }
    },
    scale: {
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH
    },
    scene: [LoadingScene, MenuScene, GameScene, PauseScene, ResultScene]
  };

  new Phaser.Game(phaserConfig);

  window.SpaceStrikeUI = {
    openAuthModal,
    openLeaderboardPanel,
    openMyScoresPanel,
    openSettingsModal
  };
})();
