const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const counterEl = document.getElementById('counter');
const narrativeEl = document.getElementById('narrative-text');

const lightCanvas = document.createElement('canvas');

// ----- 開發測試用：直接跳關按鈕 -----
const skipBtn = document.createElement('button');
skipBtn.innerText = '⏭ 測試：跳至第二關';
skipBtn.style.position = 'absolute';
skipBtn.style.top = '20px';
skipBtn.style.right = '20px';
skipBtn.style.padding = '8px 16px';
skipBtn.style.backgroundColor = 'rgba(66, 135, 245, 0.2)';
skipBtn.style.color = '#8ab4f8';
skipBtn.style.border = '1px solid rgba(138, 180, 248, 0.5)';
skipBtn.style.borderRadius = '5px';
skipBtn.style.cursor = 'pointer';
skipBtn.style.zIndex = '100';
skipBtn.style.fontFamily = 'inherit';
document.body.appendChild(skipBtn);

skipBtn.addEventListener('click', () => {
    initAudio(); // 因為有點擊視窗，可以直接無痛解鎖瀏覽器音效權限
    currentLevel = 2;
    loadLevel(2);
    skipBtn.blur(); // 移除按鈕焦點，避免後續按下空白鍵時意外再次觸發點擊
});
const lightCtx = lightCanvas.getContext('2d');

let isGameOver = false;
let isReading = false; 
let obstacles = [];
let pushables = []; // 第二關新增的可推進巨石
let puzzles = [];
let wolves = [];
let collectedCount = 0;

// ----- Level System State -----
let currentLevel = 1;
const MAX_LEVEL = 2;
let portal = null; 
let WORLD_WIDTH = 4000;
let TOTAL_PUZZLES = 0;
let camera = { x: 0, y: 0 };
let bossBird = null; // 巨鳥 BOSS

// ----- Web Audio API (音效合成) -----
// ----- BGM -----
let bgmAudio = null;
let bgmFadeTimer = null;
let pendingBGM = null; // 儲存等待使用者互動後才播放的 BGM
let currentBGMName = ""; // 紀錄當前正在播放的曲目檔名

function playBGM(src, volume = 0.5) {
    // 如果音效尚未被使用者解鎖，先存起來，等 initAudio 後再播放
    if (!audioCtx) {
        pendingBGM = { src, volume };
        return;
    }
    if (src === currentBGMName) return; // 如果曲目相同，不要重新播放
    
    stopBGM(); // 確保不會重疊播放
    currentBGMName = src;
    bgmAudio = new Audio(src);
    bgmAudio.loop = true;
    bgmAudio.volume = 0;
    bgmAudio.play().catch(() => {});
    // 漸入
    let vol = 0;
    if (bgmFadeTimer) clearInterval(bgmFadeTimer);
    bgmFadeTimer = setInterval(() => {
        vol = Math.min(vol + 0.02, volume);
        if (bgmAudio) bgmAudio.volume = vol;
        if (vol >= volume) clearInterval(bgmFadeTimer);
    }, 50);
}

function stopBGM(fadeTime = 1000) {
    if (!bgmAudio) return;
    const target = bgmAudio;
    let vol = target.volume;
    const step = vol / (fadeTime / 50);
    if (bgmFadeTimer) clearInterval(bgmFadeTimer);
    bgmFadeTimer = setInterval(() => {
        vol = Math.max(vol - step, 0);
        target.volume = vol;
        if (vol <= 0) {
            clearInterval(bgmFadeTimer);
            target.pause();
            target.currentTime = 0;
        }
    }, 50);
    bgmAudio = null;
    currentBGMName = "";
}

let audioCtx = null;
let heartbeatOsc = null;
let heartbeatGain = null;

function initAudio() {
    if (audioCtx) return;
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    
    // 心跳背景音 (40Hz 超低頻)
    heartbeatOsc = audioCtx.createOscillator();
    heartbeatOsc.type = 'sine';
    heartbeatOsc.frequency.setValueAtTime(40, audioCtx.currentTime); 
    
    heartbeatGain = audioCtx.createGain();
    heartbeatGain.gain.setValueAtTime(0, audioCtx.currentTime);
    
    heartbeatOsc.connect(heartbeatGain);
    heartbeatGain.connect(audioCtx.destination);
    heartbeatOsc.start();
    
    // 如果有尚未播放的 BGM，現在解鎖後立即播放
    if (pendingBGM) {
        const { src, volume } = pendingBGM;
        pendingBGM = null;
        playBGM(src, volume);
    }
}

function triggerHeartbeat() {
    if (!audioCtx) return;
    const now = audioCtx.currentTime;
    heartbeatGain.gain.cancelScheduledValues(now);
    heartbeatGain.gain.setValueAtTime(0, now);
    heartbeatGain.gain.linearRampToValueAtTime(0.7, now + 0.1); 
    heartbeatGain.gain.exponentialRampToValueAtTime(0.01, now + 0.5);
    heartbeatGain.gain.setValueAtTime(0, now + 0.5);
}

function triggerBirdCry() {
    if (!audioCtx) return;
    const now = audioCtx.currentTime;
    
    const osc = audioCtx.createOscillator();
    const mod = audioCtx.createOscillator();
    const modGain = audioCtx.createGain();
    const gain = audioCtx.createGain();
    
    mod.type = 'sawtooth';
    mod.frequency.value = 6; // 扭曲的顫抖音
    modGain.gain.value = 500; 
    
    osc.type = 'square';
    osc.frequency.setValueAtTime(900, now);
    osc.frequency.exponentialRampToValueAtTime(200, now + 1.2); // 高頻漸弱嬰兒啼哭感
    
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.25, now + 0.1);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 1.5);
    
    mod.connect(modGain);
    modGain.connect(osc.frequency);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    
    mod.start(now);
    osc.start(now);
    osc.stop(now + 1.5);
    mod.stop(now + 1.5);
}

// ----- System Resizing -----
function resizeCanvas() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    lightCanvas.width = canvas.width;
    lightCanvas.height = canvas.height;
    
    if (obstacles.length === 0) {
        loadLevel(currentLevel);
    }
}
window.addEventListener('resize', resizeCanvas);

// ----- Input -----
const keys = { w: false, a: false, s: false, d: false, e: false, shift: false };

window.addEventListener('keydown', (e) => {
    const key = e.key.toLowerCase();
    if (keys.hasOwnProperty(key)) keys[key] = true;
    
    // 初始化音效 (必須由使用者交互觸發)
    if (e.code === 'Space') {
        e.preventDefault(); // 攔截空白鍵預設行為（避免頁面捲動或觸發已選取的按鈕）
        initAudio();
    }

    if (e.code === 'Space' && isReading) {
        isReading = false;
        document.body.classList.remove('reading');
        narrativeEl.classList.add('hidden'); 
        
        if (document.body.dataset.transition === "true") {
            document.body.dataset.transition = "false";
            currentLevel++;
            loadLevel(currentLevel);
            return;
        }
    }
});
window.addEventListener('keyup', (e) => {
    const key = e.key.toLowerCase();
    if (keys.hasOwnProperty(key)) keys[key] = false;
});

// ----- Entities -----
const player = {
    x: 50,
    y: 50,
    radius: 12,
    speed: 7.0, 
    spawnX: 50,
    spawnY: 50,
    angle: 0 // 俯視圖旋轉角度
};

// ----- Math / Collision Utilities -----
function rectCircleCollide(rect, circle) {
    let testX = circle.x;
    let testY = circle.y;
    
    if (circle.x < rect.x) testX = rect.x;
    else if (circle.x > rect.x + rect.w) testX = rect.x + rect.w;
    
    if (circle.y < rect.y) testY = rect.y;
    else if (circle.y > rect.y + rect.h) testY = rect.y + rect.h;
    
    let distX = circle.x - testX;
    let distY = circle.y - testY;
    let distance = Math.sqrt((distX*distX) + (distY*distY));
    return distance <= circle.radius;
}

function lineLineIntersect(x1, y1, x2, y2, x3, y3, x4, y4) {
    let uA = ((x4-x3)*(y1-y3) - (y4-y3)*(x1-x3)) / ((y4-y3)*(x2-x1) - (x4-x3)*(y2-y1));
    let uB = ((x2-x1)*(y1-y3) - (y2-y1)*(x1-x3)) / ((y4-y3)*(x2-x1) - (x4-x3)*(y2-y1));
    return (uA >= 0 && uA <= 1 && uB >= 0 && uB <= 1);
}

function lineRectIntersect(x1, y1, x2, y2, rect) {
    let rx = rect.x, ry = rect.y, rw = rect.w, rh = rect.h;
    let left   = lineLineIntersect(x1,y1, x2,y2, rx,ry, rx,ry+rh);
    let right  = lineLineIntersect(x1,y1, x2,y2, rx+rw,ry, rx+rw,ry+rh);
    let top    = lineLineIntersect(x1,y1, x2,y2, rx,ry, rx+rw,ry);
    let bottom = lineLineIntersect(x1,y1, x2,y2, rx,ry+rh, rx+rw,ry+rh);
    
    if (x1 >= rx && x1 <= rx+rw && y1 >= ry && y1 <= ry+rh) return true;
    return left || right || top || bottom;
}

function rectIntersect(r1, r2) {
    return !(r2.x > r1.x + r1.w || 
             r2.x + r2.w < r1.x || 
             r2.y > r1.y + r1.h ||
             r2.y + r2.h < r1.y);
}

// 用於幫助計算圓形之間或視線圓形的工具
function lineCircleIntersect(x1, y1, x2, y2, cx, cy, r) {
    let dx = x2 - x1;
    let dy = y2 - y1;
    let lensq = dx*dx + dy*dy;
    if(lensq === 0) return Math.hypot(cx - x1, cy - y1) <= r;
    let t = ((cx - x1) * dx + (cy - y1) * dy) / lensq;
    t = Math.max(0, Math.min(1, t));
    let closestX = x1 + t * dx;
    let closestY = y1 + t * dy;
    return Math.hypot(cx - closestX, cy - closestY) <= r;
}

function getPushableCircle(p) {
    // 回傳將其轉換為標準圓形的參數物件
    return { x: p.x + p.w/2, y: p.y + p.h/2, radius: p.w/2 };
}

// ----- Setup Environment -----
function loadLevel(levelNumber) {
    obstacles = [];
    pushables = [];
    wolves = [];
    puzzles = [];
    collectedCount = 0;
    portal = null;
    bossBird = null;
    isReading = false;
    document.body.classList.remove('reading');
    isGameOver = false;
    document.body.dataset.transition = "false";
    document.body.className = ''; // reset classes
    document.getElementById('vignette').style.background = ''; // reset vignette
    
    const cy = Math.floor(canvas.height / 2);
    
    if (levelNumber === 1) {
        WORLD_WIDTH = 4000;
        TOTAL_PUZZLES = 5;
        counterEl.innerText = `已收集: 0 / ${TOTAL_PUZZLES}`;

        obstacles.push({ x: 300, y: cy - 150, w: 100, h: 300 }); 
        obstacles.push({ x: 600, y: cy - 200, w: 200, h: 80 });  
        obstacles.push({ x: 550, y: cy + 100, w: 80, h: 200 });  
        puzzles.push({ x: 200, y: cy, size: 16, collected: false, text: "又是一天相同的起點，腳步卻比昨日更重。" });
        puzzles.push({ x: 700, y: cy + 150, size: 16, collected: false, text: "這些推不動的陰影，是我親手壘砌的負罪感。" });
        wolves.push({
            x: 450, y: cy - 300, radius: 14, speed_patrol: 1.8, speed_chase: 4.6, state: 'PATROL', sightRange: 350,
            patrolPoints: [{x: 500, y: cy - 300}, {x: 850, y: cy - 300}], currentPointIdx: 0, pauseTimer: 0, angle: 0
        });
        wolves.push({
            x: 750, y: cy + 250, radius: 14, speed_patrol: 1.8, speed_chase: 4.6, state: 'PATROL', sightRange: 350,
            patrolPoints: [{x: 650, y: cy + 250}, {x: 1000, y: cy + 250}], currentPointIdx: 0, pauseTimer: 0, angle: 0
        });

        obstacles.push({ x: 1200, y: cy - 50, w: 150, h: 100 });
        obstacles.push({ x: 1400, y: cy + 150, w: 250, h: 80 });
        obstacles.push({ x: 1800, y: cy - 300, w: 100, h: 400 }); 
        obstacles.push({ x: 2100, y: cy, w: 150, h: 250 });
        puzzles.push({ x: 1300, y: cy - 150, size: 16, collected: false, text: "焦慮如同野犬，正嗅著我逃避時留下的氣味。" });
        puzzles.push({ x: 1950, y: cy - 150, size: 16, collected: false, text: "機械式的勞動，是為了掩蓋靈魂深處巨大的空洞。" });
        wolves.push({
            x: 1600, y: cy - 100, radius: 14, speed_patrol: 2.0, speed_chase: 5.0, state: 'PATROL', sightRange: 380, 
            patrolPoints: [{x: 1350, y: cy - 100}, {x: 1750, y: cy - 100}], currentPointIdx: 0, pauseTimer: 0, angle: 0
        });
        wolves.push({
            x: 1700, y: cy + 250, radius: 14, speed_patrol: 2.0, speed_chase: 5.0, state: 'PATROL', sightRange: 380,
            patrolPoints: [{x: 1100, y: cy + 250}, {x: 2000, y: cy + 250}], currentPointIdx: 0, pauseTimer: 0, angle: 0
        });

        obstacles.push({ x: 2600, y: cy - 200, w: 80, h: 500 }); 
        obstacles.push({ x: 2800, y: cy - 350, w: 300, h: 120 });
        obstacles.push({ x: 2900, y: cy + 120, w: 200, h: 250 }); 
        obstacles.push({ x: 3400, y: cy - 150, w: 80, h: 300 });
        obstacles.push({ x: 3650, y: cy - 60, w: 70, h: 120 });
        
        puzzles.push({ x: 3800, y: cy, size: 16, collected: false, text: "我持續推著無形的巨石，卻早就忘了山頂在哪裡。" });
        wolves.push({
            x: 2750, y: cy, radius: 14, speed_patrol: 2.2, speed_chase: 5.5, state: 'PATROL', sightRange: 420, 
            patrolPoints: [{x: 2750, y: cy}, {x: 3250, y: cy}], currentPointIdx: 0, pauseTimer: 0, angle: 0
        });
        wolves.push({
            x: 3550, y: cy - 350, radius: 14, speed_patrol: 2.4, speed_chase: 5.5, state: 'PATROL', sightRange: 420,
            patrolPoints: [{x: 3550, y: cy - 350}, {x: 3550, y: cy + 350}], currentPointIdx: 0, pauseTimer: 0, angle: 0
        });

        portal = { x: 3900, y: cy, radius: 30, active: false };
        player.spawnX = 100;
        playBGM('BGM Ruin remix.wav', 0.9); // 第一關 BGM 漸入播放

        const introText = `
            <div class="instruction-box">
                <h2 style="color:#8ab4f8; border-bottom:1px solid #444; padding-bottom:10px; margin-top:0;">第一章：廢墟 — 勞動迴圈</h2>
                <p style="color:#ccc; font-style:italic;">「永無止盡的機械勞動，是為了掩蓋無法面對的負罪感。」</p>
                <div style="background:rgba(255,255,255,0.05); padding:15px; border-radius:8px; margin:15px 0; text-align:left;">
                    <p style="margin:5px 0;">🧠 <b>意象</b>：日常中無止盡的強迫性思維與焦慮</p>
                    <p style="margin:5px 0;">🧩 <b>目標</b>：在沈重的機械勞動中，挖掘被深埋的記憶碎片</p>
                    <p style="margin:5px 0;">🐺 <b>威脅</b>：狼群是焦慮的化身，牠們能嗅出你內心的動搖</p>
                </div>
                <p style="text-align:center; color:#8ab4f8; font-weight:bold; margin-top:20px; animation: pulse 1.5s infinite;">[ 按下 空白鍵 踏入迴圈 ]</p>
            </div>
        `;
        showNarrative(introText, 0);
        isReading = true; // 強制進入閱讀模式，等待玩家準備
        document.body.classList.add('reading');
    }
    else if (levelNumber === 2) {
        document.body.classList.add('level-2'); // 啟動濾鏡變色
        stopBGM(1500); // 先漸出第一關 BGM
        setTimeout(() => playBGM('desert clean.wav', 0.4), 1500); // 1.5 秒後接著漸入第二關 BGM
        WORLD_WIDTH = 3000;
        TOTAL_PUZZLES = 5;
        counterEl.innerText = `已收集: 0 / ${TOTAL_PUZZLES}`;

        bossBird = {
            x: WORLD_WIDTH - 200, y: cy - 400, // 從畫面極端遙遠的右側登場
            radius: 80, 
            sightRange: 600, // 超大的探照視野
            state: 'CRUISE', 
            timer: 0,
            angle: Math.PI, // 預設面向左側
            flap: 0 // 拍動計數器
        };

        // 巨石 (可推動物件)
        pushables.push({ x: 600, y: cy - 80, spawnX: 600, spawnY: cy - 80, w: 120, h: 120 });
        pushables.push({ x: 1300, y: cy - 80, spawnX: 1300, spawnY: cy - 80, w: 120, h: 120 }); // 將重疊的巨石移出障礙物內，改放置於 S 彎道中間可以安全推拉的空地
        pushables.push({ x: 2200, y: cy - 100, spawnX: 2200, spawnY: cy - 100, w: 120, h: 120 });

        obstacles.push({ x: 300, y: cy - 350, w: 100, h: 300 });
        obstacles.push({ x: 300, y: cy + 50, w: 100, h: 300 }); 
        
        puzzles.push({ x: 200, y: cy - 200, size: 16, collected: false, text: "天空張開了巨大的眼睛，審視著我每一個笨拙的動作。" });
        
        // 增加中段的不可移動巨石陣，製造「S型繞道」來阻擋玩家直線前進
        obstacles.push({ x: 800, y: cy - 400, w: 150, h: 350 }); // 擋住上方路徑
        obstacles.push({ x: 1100, y: cy + 100, w: 150, h: 400 }); // 擋住下方路徑
        obstacles.push({ x: 1500, y: cy - 200, w: 100, h: 250 }); // 擋住中上方路徑

        puzzles.push({ x: 1000, y: cy - 250, size: 16, collected: false, text: "在空曠的荒野，沈默的評價比尖叫更加刺耳。" });
        puzzles.push({ x: 1400, y: cy + 200, size: 16, collected: false, text: "我必須躲在沈重的假象下，才能感受到片刻的安全。" });

        // 後段的封鎖區
        obstacles.push({ x: 1800, y: cy + 200, w: 300, h: 150 });
        obstacles.push({ x: 1800, y: cy - 400, w: 100, h: 200 }); // 稍微補上一點後段的上方阻擋
        
        puzzles.push({ x: 2100, y: cy + 50, size: 16, collected: false, text: "他們在看，他們在等，等我表露出不完美的裂痕。" });
        puzzles.push({ x: 2500, y: cy - 150, size: 16, collected: false, text: "哪怕被壓垮，也要維持這最卑微卻完美的站姿。" });

        obstacles.push({ x: 2700, y: cy - 100, w: 60, h: 200 }); 
        portal = { x: 2900, y: cy, radius: 30, active: false };

        player.spawnX = 100;
        
        const introText = `
            <div class="instruction-box">
                <h2 style="color:#ff6b6b; border-bottom:1px solid #444; padding-bottom:10px; margin-top:0;">第二章：荒原 — 敞視與凝視</h2>
                <p style="color:#ccc; font-style:italic;">「社會的凝視是無形的牢籠，為了維持表面完美，你被迫屏息前行。」</p>
                <div style="background:rgba(255,255,255,0.05); padding:15px; border-radius:8px; margin:15px 0; text-align:left;">
                    <p style="margin:5px 0;">👁️ <b>意象</b>：全景敞視下的社會威脅與外界嚴苛評價</p>
                    <p style="margin:5px 0;">🦅 <b>巨鳥</b>：它代表「凝視」，在毫無掩體的世界中找尋你的漏洞</p>
                    <p style="margin:5px 0;">🪨 <b>掩體</b>：推動巨石製造短暫的「視線死角」，屏住呼吸，維持形象</p>
                    <p style="margin:10px 0 5px 0; font-size:14px; color:#aaa;">※ 提示：只有你正在拖動的那顆石頭具備屏蔽效果。</p>
                </div>
                <p style="text-align:center; color:#ff6b6b; font-weight:bold; margin-top:20px; animation: pulse 1.5s infinite;">[ 按下 空白鍵 面對凝視 ]</p>
            </div>
        `;
        showNarrative(introText, 0);
        isReading = true;
        document.body.classList.add('reading');
    }

    player.spawnY = cy;
    player.x = player.spawnX;
    player.y = player.spawnY;
}

// ----- Logic Updates -----
let narrativeTimer = null;
function showNarrative(text, duration = 5000) {
    narrativeEl.innerHTML = text; 
    narrativeEl.classList.remove('hidden');
    
    // 如果是碎片文本(有duration)，則需要同步開啟 reading 類別
    if (duration > 0) {
        isReading = true;
        document.body.classList.add('reading');
    }
    
    if (narrativeTimer) clearTimeout(narrativeTimer);
    
    if (duration > 0) {
        narrativeTimer = setTimeout(() => {
            narrativeEl.classList.add('hidden');
            isReading = false;
            document.body.classList.remove('reading');
        }, duration); 
    }
}

function triggerDeath() {
    if (isGameOver) return;
    isGameOver = true;
    
    document.body.classList.add('shake');
    document.getElementById('damage-overlay').classList.add('active');
    
    setTimeout(() => {
        player.x = player.spawnX;
        player.y = player.spawnY;
        
        wolves.forEach(wolf => {
            wolf.state = 'PATROL';
            wolf.x = wolf.patrolPoints[0].x;
            wolf.y = wolf.patrolPoints[0].y;
            wolf.currentPointIdx = 0;
            wolf.pauseTimer = 0;
        });
        
        // 死亡後重置所有可推動巨石，取消其激活庇護狀態並回歸原位
        pushables.forEach(p => {
             if (p.spawnX !== undefined && p.spawnY !== undefined) {
                 p.x = p.spawnX;
                 p.y = p.spawnY;
             }
             p.isActiveShield = false;
        });
        
        // 死亡後一律重置拼圖收集與 UI 計數
        collectedCount = 0;
        counterEl.innerText = `已收集: ${collectedCount} / ${TOTAL_PUZZLES}`;
        puzzles.forEach(puzzle => { puzzle.collected = false; });

        if (currentLevel === 1) {
            showNarrative("...被黑暗吞噬，我又回到了原點。", 2000); 
        } else {
            // 重置巨鳥的位置，讓牠從遠方重新飛來，給予玩家重生的緩衝時間
            if (bossBird) {
                bossBird.x = player.x + window.innerWidth; // 每次死亡都從當下畫面的最右方飛入
                bossBird.y = player.spawnY - 400;
                bossBird.state = 'CRUISE';
                bossBird.timer = 0;
                bossBird.targetX = undefined; // 重置導航目標
            }
            showNarrative("一切又回到了原點，無法結束的夢靨...", 2000);
            document.body.classList.remove('bird-distortion');
        }

        if (portal) portal.active = false;
        
        document.body.classList.remove('shake');
        document.getElementById('damage-overlay').classList.remove('active');
        isGameOver = false;
    }, 800); 
}

function triggerBirdAttack() {
    if (isGameOver) return;
    triggerDeath();
}

let artificialLagFrames = 0;

function update(dt) {
    if (isGameOver || isReading) return; 

    const dynamicObstacles = [...obstacles, ...pushables];

    // --- 玩家移動 & 巨石推送 ---
    let dx = 0; let dy = 0;
    if (keys.w) dy -= 1;
    if (keys.s) dy += 1;
    if (keys.a) dx -= 1;
    if (keys.d) dx += 1;
    
    if (dx !== 0 && dy !== 0) {
        let length = Math.sqrt(dx*dx + dy*dy);
        dx /= length; dy /= length;
    }
    
    let currentSpeed = player.speed;
    let pushingTarget = null;
    let isPushing = false;

    // 移除每幀強制清除按壓狀態，改為「最後觸發的石頭永久帶有庇護效果」
    // 判斷是否正貼在可推動物件旁，並按下 shift 進行神祕共鳴 (啟動或轉移庇護)
    if (keys.shift && currentLevel === 2) {
        pushables.forEach(p => {
            let pC = getPushableCircle(p);
            // 採用純圓形互動感應半徑 (+5px容錯)
            if (Math.hypot(pC.x - player.x, pC.y - player.y) < pC.radius + player.radius + 5) {
                pushingTarget = p;
                
                // 啟動此塊石頭抵抗巨鳥的永久阻擋效果，並關閉戰場上其他石頭的魔法
                pushables.forEach(otherP => otherP.isActiveShield = false);
                p.isActiveShield = true; 

                currentSpeed = player.speed * 0.4; // 推進時極為緩慢
                isPushing = true;
            }
        });
    }

    // 巨鳥的壓迫降速
    if (bossBird) {
        currentSpeed *= 0.7;
    }

    let pMoveX = dx * currentSpeed * dt;
    let pMoveY = dy * currentSpeed * dt;

    // 更新玩家面朝方向 (平滑轉向)
    if (dx !== 0 || dy !== 0) {
        let targetAngle = Math.atan2(dy, dx);
        // 使旋轉更平滑
        let diff = targetAngle - player.angle;
        while (diff < -Math.PI) diff += Math.PI * 2;
        while (diff > Math.PI) diff -= Math.PI * 2;
        player.angle += diff * 0.15 * dt;
    }

    // 嘗試 X 位移
    player.x += pMoveX;
    if (pushingTarget) pushingTarget.x += pMoveX;
    
    let collideObstacleX = false;
    obstacles.forEach(o => {
        if (rectCircleCollide(o, player)) collideObstacleX = true;
        if (pushingTarget && rectCircleCollide(o, getPushableCircle(pushingTarget))) collideObstacleX = true; // 檢查推動物件撞牆
    });
    // 獨立處理玩家對其他推動物件的圓形物理碰撞
    pushables.forEach(p => {
        if (p !== pushingTarget) {
            let pC = getPushableCircle(p);
            if (Math.hypot(pC.x - player.x, pC.y - player.y) < pC.radius + player.radius) collideObstacleX = true;
            if (pushingTarget) {
                let tC = getPushableCircle(pushingTarget);
                if (Math.hypot(pC.x - tC.x, pC.y - tC.y) < pC.radius + tC.radius) collideObstacleX = true;
            }
        }
    });

    if (collideObstacleX) {
        player.x -= pMoveX;
        if (pushingTarget) pushingTarget.x -= pMoveX;
    }

    // 嘗試 Y 位移
    player.y += pMoveY;
    if (pushingTarget) pushingTarget.y += pMoveY;
    
    let collideObstacleY = false;
    obstacles.forEach(o => {
        if (rectCircleCollide(o, player)) collideObstacleY = true;
        if (pushingTarget && rectCircleCollide(o, getPushableCircle(pushingTarget))) collideObstacleY = true;
    });
    pushables.forEach(p => {
        if (p !== pushingTarget) {
            let pC = getPushableCircle(p);
            if (Math.hypot(pC.x - player.x, pC.y - player.y) < pC.radius + player.radius) collideObstacleY = true;
            if (pushingTarget) {
                let tC = getPushableCircle(pushingTarget);
                if (Math.hypot(pC.x - tC.x, pC.y - tC.y) < pC.radius + tC.radius) collideObstacleY = true;
            }
        }
    });

    if (collideObstacleY) {
        player.y -= pMoveY;
        if (pushingTarget) pushingTarget.y -= pMoveY;
    }

    player.x = Math.max(player.radius, Math.min(WORLD_WIDTH - player.radius, player.x));
    player.y = Math.max(player.radius, Math.min(canvas.height - player.radius, player.y));

    // --- 攝影機運鏡跟隨 ---
    camera.x = player.x - canvas.width / 2;
    camera.x = Math.max(0, Math.min(WORLD_WIDTH - canvas.width, camera.x));

    // --- 拼圖收集判定 ---
    puzzles.forEach(puzzle => {
        if (!puzzle.collected) {
            let cx = puzzle.x + puzzle.size/2;
            let cy = puzzle.y + puzzle.size/2;
            if (Math.hypot(player.x - cx, player.y - cy) < player.radius + puzzle.size/2 + 5) {
                puzzle.collected = true;
                collectedCount++;
                counterEl.innerText = `已收集: ${collectedCount} / ${TOTAL_PUZZLES}`;
                
                isReading = true; 
                showNarrative(puzzle.text + "<br><br><span style='color:#a8a8a8; font-size:16px; font-weight:bold;'>[ 按下 空白鍵 繼續 ]</span>", 0); 
            }
        }
    });

    // --- 傳送門 (Portal) ---
    if (portal && !portal.active && collectedCount >= TOTAL_PUZZLES) {
        portal.active = true;
    }

    if (portal && portal.active && !isReading) {
        if (Math.hypot(player.x - portal.x, player.y - portal.y) < player.radius + portal.radius) {
            isReading = true; 
            if (currentLevel < MAX_LEVEL) {
                showNarrative("你發現了冰藍色的傳送縫隙...<br><br><span style='color:#4287f5; font-size:16px; font-weight:bold;'>[ 按下 空白鍵 進入第二關 ]</span>", 0);
                document.body.dataset.transition = "true"; 
            } else {
                isGameOver = true; 
                showNarrative("巨鳥的陰影消散了，你擺脫了無盡的心理輪迴。<br><br><span style='color:#8ab4f8; font-size:18px; font-weight:bold;'>— 遊戲破關 (感謝您的遊玩!) —</span>", 0);
            }
        }
    }

    // --- Boss 巨鳥 AI 系統 ---
    if (bossBird) {
        bossBird.timer++;
        
        // 判定玩家是否在巨鳥視線內 (如今巨鳥光線可以穿透固定地形，且只有「目前被標記為庇護」的橢圓巨石才能給予保護！)
        let bDistToPlayer = Math.hypot(player.x - bossBird.x, player.y - bossBird.y);
        let birdHasLOS = false;
        if (bDistToPlayer <= bossBird.sightRange) {
            birdHasLOS = true;
            for(let p of pushables) { 
                // 只有已維持激活狀態的石頭能阻擋視線，使用精準圓形射線阻擋驗證
                let pC = getPushableCircle(p);
                if (p.isActiveShield && lineCircleIntersect(bossBird.x, bossBird.y, player.x, player.y, pC.x, pC.y, pC.radius)) {
                    birdHasLOS = false; 
                    break;
                }
            }
        }

        if (bossBird.state === 'CRUISE') {
            // 從單純追蹤玩家修改為「全地圖隨機航點巡航」
            if (bossBird.targetX === undefined) {
                bossBird.targetX = Math.random() * (WORLD_WIDTH - 400) + 200;
                bossBird.targetY = Math.random() * (canvas.height - 200) + 100;
            }
            
            // 緩慢朝目標巡航點飛行
            let bdx = bossBird.targetX - bossBird.x;
            let bdy = bossBird.targetY - bossBird.y;
            let distToTarget = Math.hypot(bdx, bdy);
            
            if (distToTarget < 50) {
                // 抵達航點後重新派發目標：一半機率去巡邏玩家附近，一半機率亂數在地圖遊走
                if (Math.random() < 0.5) {
                    bossBird.targetX = Math.max(100, Math.min(WORLD_WIDTH - 100, player.x + (Math.random() - 0.5) * 1500));
                    bossBird.targetY = Math.max(100, Math.min(canvas.height - 100, player.y + (Math.random() - 0.5) * 600));
                } else {
                    bossBird.targetX = Math.random() * (WORLD_WIDTH - 400) + 200;
                    bossBird.targetY = Math.random() * (canvas.height - 200) + 100;
                }
            } else {
                bossBird.x += (bdx / distToTarget) * 3.6 * dt; 
                bossBird.y += (bdy / distToTarget) * 3.6 * dt;
                bossBird.y += Math.sin(Date.now() / 800) * 0.5; // Date.now() 本身就與影格無關，故不需 dt
                
                // 平滑轉向 (根據巡航目標)
                let targetAngle = Math.atan2(bdy, bdx);
                let diff = targetAngle - bossBird.angle;
                while (diff < -Math.PI) diff += Math.PI * 2;
                while (diff > Math.PI) diff -= Math.PI * 2;
                bossBird.angle += diff * 0.05 * dt;

                // 動態碰撞：無懈可擊的純 圓對圓 (Circle-Circle) 碰撞分離推擠
                pushables.forEach(p => {
                    let pC = getPushableCircle(p);
                    let dist = Math.hypot(bossBird.x - pC.x, bossBird.y - pC.y);
                    let minDist = bossBird.radius + pC.radius;
                    if (p.isActiveShield && dist < minDist) {
                         let overlap = minDist - dist + 0.1;
                         if (dist === 0) { bossBird.y -= overlap; } // 極端重疊防護
                         else {
                             bossBird.x += ((bossBird.x - pC.x) / dist) * overlap;
                             bossBird.y += ((bossBird.y - pC.y) / dist) * overlap;
                         }
                    }
                });
            }
            
            // 防呆卡角機制：避免滑行而永遠卡在死胡同凹槽裡，每 6 秒強迫重新思考一次導航
            bossBird.stuckTimer = (bossBird.stuckTimer || 0) + dt;
            if (bossBird.stuckTimer > 360) {
                 bossBird.targetX = undefined;
                 bossBird.stuckTimer = 0;
            }
            
            // 一旦有視野且經過短暫判定，立即切換為追蹤模式 (像狼群般的持續追擊)
            if (birdHasLOS && bossBird.timer > 60) { 
                bossBird.timer = 0;
                bossBird.state = 'CHASE';
                triggerBirdCry();
                document.body.classList.add('bird-distortion');
            }
        } else if (bossBird.state === 'CHASE') {
            let bdx = player.x - bossBird.x;
            let bdy = player.y - bossBird.y;
            let bdist = Math.hypot(bdx, bdy);
            
            // 像狼一樣持續不休的反覆追蹤，速度設定為具威脅性的穩定步調
            bossBird.x += (bdx/bdist) * 9.1 * dt;
            bossBird.y += (bdy/bdist) * 9.1 * dt;
            
            // 平滑轉向 (根據玩家位置)
            let targetAngle = Math.atan2(bdy, bdx);
            let diff = targetAngle - bossBird.angle;
            while (diff < -Math.PI) diff += Math.PI * 2;
            while (diff > Math.PI) diff -= Math.PI * 2;
            bossBird.angle += diff * 0.12 * dt;

            // 產生物理碰撞結算傷害
            if (bdist < player.radius + bossBird.radius * 0.4) {
                 let collectedPuzzles = puzzles.filter(p => p.collected);
                 if (collectedPuzzles.length > 0 && Math.random() < 0.3) {
                     let stolenPuzzle = collectedPuzzles[Math.floor(Math.random() * collectedPuzzles.length)];
                     stolenPuzzle.collected = false;
                     collectedCount--;
                     counterEl.innerText = `已收集: ${collectedCount} / ${TOTAL_PUZZLES}`;
                     showNarrative("巨大的衝擊奪走了你的一片記憶！(拼圖碎片已掉落回原位)", 2000);
                     
                     document.body.classList.add('shake');
                     document.getElementById('damage-overlay').classList.add('active');
                     setTimeout(() => {
                         document.body.classList.remove('shake');
                         document.getElementById('damage-overlay').classList.remove('active');
                     }, 400);
 
                     // 搶奪完畢後巨鳥強制返回巡航
                     bossBird.state = 'CRUISE';
                     bossBird.timer = 0;
                     bossBird.targetX = undefined;
                     document.body.classList.remove('bird-distortion');
                 } else {
                     triggerBirdAttack();
                 }
            }
            
            // 如果玩家躲入庇護石產生的陰影失去視野，巨鳥會立刻放棄追蹤並回歸巡航
            if (!birdHasLOS) {
                bossBird.state = 'CRUISE';
                bossBird.timer = 0; // 重置冷卻
                bossBird.targetX = undefined;
                document.body.classList.remove('bird-distortion');
            }
            
            // 追逐階段撞到已激活庇護的橢圓巨石時，巨鳥會滑開而不會穿透
            pushables.forEach(p => {
                 let pC = getPushableCircle(p);
                 let dist = Math.hypot(bossBird.x - pC.x, bossBird.y - pC.y);
                 let minDist = bossBird.radius + pC.radius;
                 if (p.isActiveShield && dist < minDist) {
                     let overlap = minDist - dist + 0.1;
                     if (dist === 0) { bossBird.y -= overlap; }
                     else {
                         bossBird.x += ((bossBird.x - pC.x) / dist) * overlap;
                         bossBird.y += ((bossBird.y - pC.y) / dist) * overlap;
                     }
                 }
            });
        }
    }

    // --- 敵人 AI 系統 (Wolves) ---
    wolves.forEach(wolf => {
        if (wolf.pauseTimer > 0) {
            wolf.pauseTimer -= dt; // 修正為依據時間遞減
            return; 
        }
    
        let distToPlayer = Math.hypot(player.x - wolf.x, player.y - wolf.y);
        let hasLOS = false;
        
        if (distToPlayer <= wolf.sightRange) {
            hasLOS = true;
            for(let o of dynamicObstacles) {
                if (lineRectIntersect(wolf.x, wolf.y, player.x, player.y, o)) {
                    hasLOS = false; 
                    break;
                }
            }
        }
        
        if (hasLOS) {
            wolf.state = 'CHASE'; 
        } else if (wolf.state === 'CHASE') {
            wolf.state = 'PATROL';
            wolf.pauseTimer = 90; 
        }
        
        let wolf_dx = 0;
        let wolf_dy = 0;

        if (wolf.state === 'CHASE') {
            let angle = Math.atan2(player.y - wolf.y, player.x - wolf.x);
            wolf_dx = Math.cos(angle) * wolf.speed_chase * dt; // 補上 dt 縮放
            wolf_dy = Math.sin(angle) * wolf.speed_chase * dt;
        } else {
            let target = wolf.patrolPoints[wolf.currentPointIdx];
            let dist = Math.hypot(target.x - wolf.x, target.y - wolf.y);
            if (dist < 5) {
                wolf.currentPointIdx = (wolf.currentPointIdx + 1) % wolf.patrolPoints.length;
                wolf.pauseTimer = 45; 
            } else {
                let angle = Math.atan2(target.y - wolf.y, target.x - wolf.x);
                wolf_dx = Math.cos(angle) * wolf.speed_patrol * dt; // 補上 dt 縮放
                wolf_dy = Math.sin(angle) * wolf.speed_patrol * dt;
            }
        }
        // 更新狼的旋轉角度 (平滑轉向)
        let targetAngle = Math.atan2(wolf_dy, wolf_dx);
        let diff = targetAngle - wolf.angle;
        while (diff < -Math.PI) diff += Math.PI * 2;
        while (diff > Math.PI) diff -= Math.PI * 2;
        wolf.angle += diff * 0.1 * dt; // 補上 dt 縮放

        wolf.x += wolf_dx;
        obstacles.forEach(o => { // 一般方形障礙物
            if (rectCircleCollide(o, wolf)) {
                if (wolf_dx > 0) wolf.x = o.x - wolf.radius - 0.2;
                else if (wolf_dx < 0) wolf.x = o.x + o.w + wolf.radius + 0.2;
            }
        });
        pushables.forEach(p => { // 橢圓形障礙物 (圓對圓)
            let pC = getPushableCircle(p);
            let dist = Math.hypot(wolf.x - pC.x, wolf.y - pC.y);
            if (dist < wolf.radius + pC.radius) {
                wolf.x += ((wolf.x - pC.x)/dist) * (wolf.radius + pC.radius - dist + 0.1);
            }
        });

        wolf.y += wolf_dy;
        obstacles.forEach(o => { // 一般方形障礙物
            if (rectCircleCollide(o, wolf)) {
                if (wolf_dy > 0) wolf.y = o.y - wolf.radius - 0.2;
                else if (wolf_dy < 0) wolf.y = o.y + o.h + wolf.radius + 0.2;
            }
        });
        pushables.forEach(p => { // 橢圓形障礙物 (圓對圓)
            let pC = getPushableCircle(p);
            let dist = Math.hypot(wolf.x - pC.x, wolf.y - pC.y);
            if (dist < wolf.radius + pC.radius) {
                wolf.y += ((wolf.y - pC.y)/dist) * (wolf.radius + pC.radius - dist + 0.1);
            }
        });

        if (distToPlayer < player.radius + wolf.radius - 2) {
            triggerDeath();
        }
    });
}

// ----- Draw -----
function draw(dt) {
    ctx.fillStyle = '#0a0d11';  
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const dynamicObstacles = [...obstacles, ...pushables];

    // 1. 光照運算
    ctx.globalCompositeOperation = 'lighter';
    
    // 合併需運算視線的實體
    let lightEntities = [...wolves];
    if (bossBird) lightEntities.push(bossBird);

    lightEntities.forEach(entity => {
        if (entity.x < camera.x - entity.sightRange*2 || entity.x > camera.x + canvas.width + entity.sightRange*2) return;

        lightCtx.clearRect(0, 0, lightCanvas.width, lightCanvas.height);
        lightCtx.save();
        lightCtx.translate(-camera.x, -camera.y);

        lightCtx.beginPath();
        lightCtx.arc(entity.x, entity.y, entity.sightRange, 0, Math.PI * 2);
        let sightGrd = lightCtx.createRadialGradient(entity.x, entity.y, entity.radius, entity.x, entity.y, entity.sightRange);
        
        // 巨鳥的探照燈設定得更紅一點
        if (entity === bossBird) {
            sightGrd.addColorStop(0, 'rgba(255, 30, 30, 0.45)'); 
            sightGrd.addColorStop(1, 'rgba(255, 0, 0, 0.0)');
        } else {
            sightGrd.addColorStop(0, 'rgba(255, 30, 30, 0.35)'); 
            sightGrd.addColorStop(1, 'rgba(255, 0, 0, 0.0)');
        }
        
        lightCtx.fillStyle = sightGrd;
        lightCtx.fill();
        
        lightCtx.strokeStyle = entity === bossBird ? 'rgba(255, 60, 60, 0.6)' : 'rgba(255, 50, 50, 0.4)';
        lightCtx.lineWidth = entity === bossBird ? 2 : 1;
        lightCtx.setLineDash([8, 8]); 
        lightCtx.stroke();
        lightCtx.setLineDash([]);

        lightCtx.globalCompositeOperation = 'destination-out';
        lightCtx.fillStyle = 'black'; 
        
        // 分離阻擋物：狼群依舊被地形阻擋。巨鳥的光線只有遇到「目前激活中的巨石(isActiveShield)」才會被隔絕產生影子
        let blockingObstacles = entity === bossBird ? pushables.filter(p => p.isActiveShield) : dynamicObstacles;
        
        const EXTEND = 2000;
        blockingObstacles.forEach(o => {
            if (Math.abs(o.x - entity.x) > 1000) return;

            let edges = [];
            if (o.w !== undefined && !pushables.includes(o)) {
                // 普通方形地形障礙物
                edges = [
                    {x1: o.x, y1: o.y, x2: o.x+o.w, y2: o.y},
                    {x1: o.x+o.w, y1: o.y, x2: o.x+o.w, y2: o.y+o.h},
                    {x1: o.x+o.w, y1: o.y+o.h, x2: o.x, y2: o.y+o.h},
                    {x1: o.x, y1: o.y+o.h, x2: o.x, y2: o.y}
                ];
            } else {
                // 將橢圓巨石(圓形)拆解為 10 邊型來精確投射出接近圓形的平滑弧形陰影
                let cx = o.x + o.w/2, cy = o.y + o.h/2, r = o.w/2 - 2; 
                let segments = 10;
                for (let i = 0; i < segments; i++) {
                    let a1 = (i / segments) * Math.PI * 2;
                    let a2 = ((i + 1) / segments) * Math.PI * 2;
                    edges.push({
                        x1: cx + Math.cos(a1)*r, y1: cy + Math.sin(a1)*r,
                        x2: cx + Math.cos(a2)*r, y2: cy + Math.sin(a2)*r
                    });
                }
            }
            
            edges.forEach(e => {
                let scale1 = EXTEND / Math.hypot(e.x1 - entity.x, e.y1 - entity.y);
                let ex1 = e.x1 + (e.x1 - entity.x) * scale1;
                let ey1 = e.y1 + (e.y1 - entity.y) * scale1;

                let scale2 = EXTEND / Math.hypot(e.x2 - entity.x, e.y2 - entity.y);
                let ex2 = e.x2 + (e.x2 - entity.x) * scale2;
                let ey2 = e.y2 + (e.y2 - entity.y) * scale2;

                lightCtx.beginPath();
                lightCtx.moveTo(e.x1, e.y1);
                lightCtx.lineTo(e.x2, e.y2);
                lightCtx.lineTo(ex2, ey2);
                lightCtx.lineTo(ex1, ey1);
                lightCtx.closePath();
                lightCtx.fill();
            });
        });
        lightCtx.restore(); 
        
        ctx.drawImage(lightCanvas, 0, 0); 
    });
    ctx.globalCompositeOperation = 'source-over';

    ctx.save();
    ctx.translate(-camera.x, -camera.y);

    // 2. 繪製石塊
    ctx.fillStyle = '#141a22';
    obstacles.forEach(o => {
        if(o.x < camera.x - o.w || o.x > camera.x + canvas.width) return;
        ctx.shadowBlur = 0;
        ctx.fillRect(o.x, o.y, o.w, o.h);
        ctx.fillStyle = '#1e252d';
        ctx.fillRect(o.x, o.y, o.w, 4); 
        ctx.fillStyle = '#141a22';
    });

    // 3. 繪製可推送的巨石 (顯眼的灰白色且為圓潤鵝卵石型態)
    pushables.forEach(p => {
        if(p.x < camera.x - p.w || p.x > camera.x + canvas.width) return;
        
        ctx.shadowBlur = 15;
        ctx.shadowColor = 'rgba(0,0,0,0.8)';
        
        ctx.fillStyle = '#E2E2E2'; // 顯眼的灰白色
        ctx.beginPath();
        if (ctx.roundRect) {
            // 半徑 50 會將 120x120 的方形轉化為幾乎是圓形/橢圓的鵝卵石形狀
            ctx.roundRect(p.x, p.y, p.w, p.h, 50); 
        } else {
            ctx.arc(p.x + p.w/2, p.y + p.h/2, p.w/2, 0, Math.PI * 2);
        }
        ctx.fill();
        
        // 邊緣陰影輪廓
        ctx.shadowBlur = 0;
        ctx.lineWidth = 4;
        ctx.strokeStyle = '#9E9E9E';
        ctx.stroke();
        
        // 加入頂角傾斜的橢圓雕刻圖騰，並隨觸發狀態發光
        if (p.isActiveShield) {
            ctx.fillStyle = '#4287f5'; // 恆定散發神秘的冰藍色魔法光芒
            ctx.shadowBlur = 10;
            ctx.shadowColor = '#4287f5';
        } else {
            ctx.fillStyle = '#BDBDBD'; // 平常是黯淡的石刻
            ctx.shadowBlur = 0;
        }
        
        ctx.beginPath();
        ctx.ellipse(
            p.x + p.w/2, 
            p.y + p.h/2, 
            p.w/3.5, p.h/4, 
            Math.PI / 4, 0, Math.PI * 2
        );
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.lineWidth = 1; // 恢復預設
    });

    // 4. 繪製拼圖
    puzzles.forEach(puzzle => {
        if (!puzzle.collected) {
            ctx.save();
            ctx.fillStyle = '#8ab4f8';
            ctx.shadowColor = '#8ab4f8';
            // 加入不穩定閃爍效果 (Level 2會更劇烈)
            const pulse = (Math.sin(Date.now() / (currentLevel === 2 ? 100 : 300)) + 1) / 2; 
            ctx.shadowBlur = 10 + pulse * 15;
            ctx.globalAlpha = 0.6 + pulse * 0.4;
            if (currentLevel === 2 && Math.random() < 0.1) ctx.globalAlpha = 0; // 拼圖閃爍短路
            ctx.translate(puzzle.x + puzzle.size/2, puzzle.y + puzzle.size/2);
            ctx.rotate(Math.PI / 4); 
            ctx.fillRect(-puzzle.size/2, -puzzle.size/2, puzzle.size, puzzle.size);
            ctx.restore();
        }
    });

    // 5. 繪製傳送門 (Portal)
    if (portal) {
        ctx.save();
        if (portal.active) {
            const time = Date.now() / 200;
            ctx.fillStyle = 'rgba(66, 135, 245, 0.4)';
            ctx.shadowColor = '#4287f5';
            ctx.shadowBlur = 30 + Math.sin(time) * 15;
            
            ctx.beginPath();
            ctx.arc(portal.x, portal.y, portal.radius + Math.sin(time) * 5, 0, Math.PI * 2);
            ctx.fill();
            
            ctx.fillStyle = '#ffffff';
            ctx.shadowColor = '#ffffff';
            ctx.shadowBlur = 50;
            ctx.beginPath();
            ctx.arc(portal.x, portal.y, portal.radius * 0.4, 0, Math.PI * 2);
            ctx.fill();
        } else {
            ctx.strokeStyle = 'rgba(66, 135, 245, 0.15)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.arc(portal.x, portal.y, portal.radius, 0, Math.PI * 2);
            ctx.stroke();
        }
        ctx.restore();
    }

    // 6. 繪製巨鳥 Boss (史詩級俯視巨鳥模型)
    if (bossBird) {
        ctx.save();
        ctx.translate(bossBird.x, bossBird.y);
        ctx.rotate(bossBird.angle);

        // 翅膀拍動邏輯 (極致降速、極致減小後方振幅以展現史詩翱翔感)
        const isChasing = bossBird.state === 'CHASE';
        const flapSpeed = isChasing ? 0.09 : 0.035; 
        if (!isReading) bossBird.flap += flapSpeed * dt; // 拍動速度同步縮放
        const wingScale = Math.sin(bossBird.flap); // -1 到 1

        // 1. 底層光暈
        let glow = Math.abs(Math.sin(Date.now() / 150)) * 40 + 60;
        let grd = ctx.createRadialGradient(0, 0, bossBird.radius * 0.3, 0, 0, bossBird.radius * 2.5);
        grd.addColorStop(0, isChasing ? 'rgba(255, 0, 0, 0.5)' : 'rgba(255, 255, 255, 0.3)');
        grd.addColorStop(1, 'rgba(255, 255, 255, 0)');
        ctx.fillStyle = grd;
        ctx.beginPath();
        ctx.arc(0, 0, bossBird.radius * 2.5, 0, Math.PI * 2);
        ctx.fill();

        // 2. 巨大的羽翼 (非對稱拍動：極大化減小向後幅度)
        ctx.fillStyle = '#000000';
        ctx.shadowBlur = glow;
        ctx.shadowColor = isChasing ? '#ff0000' : 'rgba(255, 255, 255, 0.5)';

        // 計算非對稱擺幅 (極限化：向前極闊，向後近乎不動)
        let flapEffect = wingScale * 1.1; // 增加向前幅度
        if (flapEffect > 0) flapEffect *= 0.125; // 向後幅度再次減半 (僅剩 1/8)

        // 左翼 
        ctx.save();
        ctx.translate(20, -25); 
        const leftWingAngle = -0.1 + flapEffect; 
        ctx.rotate(-leftWingAngle);
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.bezierCurveTo(-150, -180, -220, -50, -280, 0); 
        ctx.lineTo(-60, 0);
        ctx.fill();
        // 還原羽毛細節 (使用者滿意版本)
        ctx.strokeStyle = '#000';
        for(let j=0; j<7; j++) {
            ctx.beginPath();
            ctx.lineWidth = 5 - j * 0.5;
            ctx.moveTo(-80 - j*25, 0);
            ctx.lineTo(-110 - j*30, 20 + j*3);
            ctx.stroke();
        }
        ctx.restore();

        // 右翼
        ctx.save();
        ctx.translate(20, 25); 
        const rightWingAngle = -0.1 + flapEffect;
        ctx.rotate(rightWingAngle);
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.bezierCurveTo(-150, 180, -220, 50, -280, 0);
        ctx.lineTo(-60, 0);
        ctx.fill();
        for(let j=0; j<7; j++) {
            ctx.beginPath();
            ctx.lineWidth = 5 - j * 0.5;
            ctx.moveTo(-80 - j*25, 0);
            ctx.lineTo(-110 - j*30, -20 - j*3);
            ctx.stroke();
        }
        ctx.restore();

        // 3. 尾羽
        ctx.beginPath();
        ctx.moveTo(-bossBird.radius * 0.5, 0);
        ctx.lineTo(-bossBird.radius * 1.5, -30);
        ctx.lineTo(-bossBird.radius * 1.8, 0);
        ctx.lineTo(-bossBird.radius * 1.5, 30);
        ctx.fill();

        // 4. 軀幹與頭部
        ctx.beginPath();
        ctx.ellipse(0, 0, bossBird.radius, bossBird.radius * 0.45, 0, 0, Math.PI * 2);
        ctx.fill();
        
        ctx.beginPath();
        ctx.arc(bossBird.radius * 0.7, 0, 18, 0, Math.PI * 2);
        ctx.fill();
        
        ctx.fillStyle = '#ffcc00';
        ctx.beginPath();
        ctx.moveTo(bossBird.radius * 0.9, -5);
        ctx.lineTo(bossBird.radius * 1.4, 0);
        ctx.lineTo(bossBird.radius * 0.9, 5);
        ctx.fill();

        // 5. 眼睛 (發現玩家時變為血紅色)
        if (isChasing) {
            ctx.fillStyle = '#ff0000'; // 血紅色眼睛
            ctx.shadowBlur = 15;
            ctx.shadowColor = '#ff0000';
            ctx.beginPath();
            ctx.arc(bossBird.radius * 0.72, -6, 3, 0, Math.PI * 2);
            ctx.arc(bossBird.radius * 0.72, 6, 3, 0, Math.PI * 2);
            ctx.fill();
            ctx.shadowBlur = 0; // 重置
        }

        ctx.restore();
    }

    // 7. 繪製狼 (精緻俯視野獸模型)
    wolves.forEach(wolf => {
        ctx.save();
        ctx.translate(wolf.x, wolf.y);
        ctx.rotate(wolf.angle);
        
        const isChasing = wolf.state === 'CHASE';
        const bodyColor = isChasing ? '#4a0000' : '#222';
        
        // 陰影
        ctx.shadowColor = isChasing ? 'rgba(255, 0, 0, 0.6)' : 'rgba(0, 0, 0, 0.8)';
        ctx.shadowBlur = isChasing ? 25 : 10;

        // 身體 (長橢圓)
        ctx.fillStyle = bodyColor;
        ctx.beginPath();
        ctx.ellipse(0, 0, wolf.radius * 1.6, wolf.radius * 0.7, 0, 0, Math.PI * 2);
        ctx.fill();

        // 頭部 (尖銳感)
        ctx.beginPath();
        ctx.moveTo(wolf.radius * 1.2, -wolf.radius * 0.5);
        ctx.lineTo(wolf.radius * 2.2, 0); // 狼吻
        ctx.lineTo(wolf.radius * 1.2, wolf.radius * 0.5);
        ctx.closePath();
        ctx.fill();

        // 尖耳朵
        ctx.beginPath();
        ctx.moveTo(wolf.radius * 0.8, -wolf.radius * 0.5);
        ctx.lineTo(wolf.radius * 1.4, -wolf.radius * 0.8);
        ctx.lineTo(wolf.radius * 1.2, -wolf.radius * 0.2);
        ctx.closePath();
        ctx.fill();

        ctx.beginPath();
        ctx.moveTo(wolf.radius * 0.8, wolf.radius * 0.5);
        ctx.lineTo(wolf.radius * 1.4, wolf.radius * 0.8);
        ctx.lineTo(wolf.radius * 1.2, wolf.radius * 0.2);
        ctx.closePath();
        ctx.fill();

        // 尾巴 (加入擺動動畫)
        ctx.save();
        const tailWag = Math.sin(Date.now() / 150) * 0.2;
        ctx.rotate(tailWag);
        ctx.strokeStyle = bodyColor;
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(-wolf.radius * 1.5, 0);
        ctx.quadraticCurveTo(-wolf.radius * 2, 5, -wolf.radius * 2.5, 0);
        ctx.stroke();
        ctx.restore();

        // 邪惡紅眼
        if (isChasing) {
            ctx.fillStyle = '#ff0000';
            ctx.shadowBlur = 10;
            ctx.shadowColor = '#ff0000';
            ctx.beginPath();
            ctx.arc(wolf.radius * 1.6, -3, 2, 0, Math.PI * 2); // 左眼
            ctx.arc(wolf.radius * 1.6, 3, 2, 0, Math.PI * 2);  // 右眼
            ctx.fill();
        } else {
            // 巡邏時的微弱紅光
            ctx.fillStyle = '#500';
            ctx.beginPath();
            ctx.arc(wolf.radius * 1.6, -3, 1.5, 0, Math.PI * 2);
            ctx.arc(wolf.radius * 1.6, 3, 1.5, 0, Math.PI * 2);
            ctx.fill();
        }

        ctx.restore();
    });

    // 8. 繪製主角 (精緻俯視人身模型)
    ctx.save();
    ctx.translate(player.x, player.y);
    ctx.rotate(player.angle);

    // 呼吸動效
    const breath = Math.sin(Date.now() / 400) * 0.8;

    // 陰影
    ctx.shadowBlur = 15;
    ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';

    // 肩膀 (身體基底)
    ctx.fillStyle = '#1a1a1a'; // 深色衣服
    ctx.beginPath();
    ctx.ellipse(0, 0, player.radius * 1.4 + breath, player.radius * 0.8, 0, 0, Math.PI * 2);
    ctx.fill();

    // 頸部
    ctx.fillStyle = '#d2b48c'; // 皮膚色
    ctx.beginPath();
    ctx.arc(0, 0, player.radius * 0.5, 0, Math.PI * 2);
    ctx.fill();

    // 頭部
    let headGrd = ctx.createRadialGradient(-2, -2, 2, 0, 0, player.radius);
    headGrd.addColorStop(0, '#f5deb3'); // 受光面
    headGrd.addColorStop(1, '#a68b5b'); // 陰影面
    ctx.fillStyle = headGrd;
    ctx.beginPath();
    ctx.arc(0, 0, player.radius, 0, Math.PI * 2);
    ctx.fill();

    // 頭髮 (亂髮紋理)
    ctx.strokeStyle = '#2b1d0e'; // 深褐色髮絲
    ctx.lineWidth = 1.5;
    for (let i = 0; i < 8; i++) {
        ctx.beginPath();
        let hairAngle = (i / 8) * Math.PI * 2;
        ctx.moveTo(Math.cos(hairAngle) * (player.radius * 0.3), Math.sin(hairAngle) * (player.radius * 0.3));
        ctx.lineTo(Math.cos(hairAngle * 1.2) * (player.radius * 0.95), Math.sin(hairAngle * 1.2) * (player.radius * 0.95));
        ctx.stroke();
    }
    
    // 耳朵 (細節)
    ctx.fillStyle = '#a68b5b';
    ctx.beginPath();
    ctx.arc(0, -player.radius * 0.9, 3, 0, Math.PI * 2); // 左耳
    ctx.arc(0, player.radius * 0.9, 3, 0, Math.PI * 2);  // 右耳
    ctx.fill();

    ctx.restore();

    ctx.restore(); // 結束運鏡
}

let lastTime = 0;
function gameLoop(timestamp) {
    if (!lastTime) {
        lastTime = timestamp;
        requestAnimationFrame(gameLoop);
        return;
    }
    const dt = Math.min((timestamp - lastTime) / (1000 / 60), 2.0); // 獲取係數，最高限制在 2.0 (30fps) 以防跳針
    lastTime = timestamp;

    // 隨機假 Lag 系統 (干擾操作體驗)
    if (artificialLagFrames > 0) {
        artificialLagFrames--;
        requestAnimationFrame(gameLoop);
        return; 
    }
    
    // 如果巨鳥正處於攻擊/暴走，產生 0.5% 的機率觸發長達 0.1~0.3秒的凍結延遲
    if (bossBird && (bossBird.state === 'DIVE' || bossBird.state === 'STEAL') && Math.random() < 0.005) {
        artificialLagFrames = Math.floor(Math.random() * 12) + 6; 
    }

    update(dt);
    draw(dt);
    requestAnimationFrame(gameLoop);
}

resizeCanvas(); 
requestAnimationFrame(gameLoop); // 改由 rAF 啟動以獲取初始 timestamp
