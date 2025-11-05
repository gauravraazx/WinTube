// Firebase SDK (CDN via ES Modules)
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getDatabase,
  ref,
  get,
  set,
  update
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";

// 🔑 Firebase Config
const firebaseConfig = {
  apiKey: "AIzaSyD0Q-bGCEAYMvk0FuF-33dF7xboDz16PVM",
  authDomain: "wintubebot.firebaseapp.com",
  databaseURL: "https://wintubebot-default-rtdb.firebaseio.com",
  projectId: "wintubebot",
  storageBucket: "wintubebot.firebasestorage.app",
  messagingSenderId: "34432972395",
  appId: "1:34432972395:web:ffb60dae121e406b32a32e",
  measurementId: "G-FN6Z44CQHW"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

// 🧠 State
let userId = 'NOT_APP'; // Default fallback
let adsWatched = 0;
let isPlaying = false;

// Expose to global for inline HTML (copy button, nav)
window.copyID = copyID;
window.showPage = showPage;

// 🎁 Prize Distribution Rules (Rank → %)
const PRIZE_RULES = {
  1: 15,
  2: 10,
  3: 7,
  4: 6,
  5: 5,
  6: 4,
  7: 3.5,
  8: 3,
  9: 2.5,
  10: 2
};
const RANGE_RULES = [
  { min: 11, max: 20, pct: 1.5 },
  { min: 21, max: 30, pct: 1 },
  { min: 31, max: 40, pct: 0.75 },
  { min: 41, max: 50, pct: 0.5 }
];

function getPrizePercentage(rank) {
  if (PRIZE_RULES[rank] !== undefined) return PRIZE_RULES[rank];
  for (const r of RANGE_RULES) {
    if (rank >= r.min && rank <= r.max) return r.pct;
  }
  return 0; // No prize beyond rank 50
}

// 🏁 End current session & save winners + prizes
async function endCurrentSession(currentSession, prizePoolAmount, topUsers) {
  const winnersPath = `session${currentSession}_winners`;
  const prizesPath = `session${currentSession}_prizes`;

  const winnersUpdates = {};
  const prizesUpdates = {};

  const top50 = topUsers.slice(0, 50);
  for (let i = 0; i < top50.length; i++) {
    const user = top50[i];
    const rank = i + 1;
    const pct = getPrizePercentage(rank);
    if (pct > 0) {
      winnersUpdates[user.userId] = rank.toString();
      const prize = (prizePoolAmount * pct) / 100;
      prizesUpdates[user.userId] = parseFloat(prize.toFixed(2));
    }
  }

  // Update DB: winners, prizes, next session
  await update(ref(db), {
    [winnersPath]: winnersUpdates,
    [prizesPath]: prizesUpdates,
    session: (parseInt(currentSession) + 1).toString(),
    session_ended: null // Remove lock
  });
}

// 🔄 Load full app state from Firebase
async function loadFromFirebase() {
  try {
    const snapshot = await get(ref(db));
    if (!snapshot.exists()) return;

    const data = snapshot.val();
    const currentSession = data.session || '1';
    const currentTarget = data.Target || 1000;
    const currentPrize = data.price_pool || '$10000';

    // Update header
    document.getElementById('prizePoolDisplay').textContent = currentPrize;
    document.getElementById('sessionDisplay').textContent = `(Session: ${currentSession})`;
    document.getElementById('target').textContent = currentTarget;

    // User & leaderboard
    const users = data.users || {};
    const userEntry = users[userId];
    const localAds = userEntry ? userEntry.AdsWatched || 0 : 0;
    const leaderboard = Object.entries(users).map(([uid, info]) => ({
      userId: uid,
      ads: info.AdsWatched || 0
    }));
    const globalWatched = leaderboard.reduce((sum, u) => sum + u.ads, 0);
    const remaining = Math.max(currentTarget - globalWatched, 0);

    // Sync UI
    document.getElementById('adsview').textContent = localAds;
    document.getElementById('youAdsWatched').textContent = localAds;
    document.getElementById('watched').textContent = globalWatched;
    document.getElementById('remaining').textContent = remaining;
    document.getElementById('progress').style.width = `${Math.min((globalWatched / currentTarget) * 100, 100)}%`;

    // You Page stats
    const total = globalWatched || 1;
    const prob = (localAds / total) * 100;
    document.getElementById('probability').textContent = `${Math.min(prob, 100).toFixed(1)}%`;
    document.getElementById('probFill').style.width = `${Math.min(prob, 100)}%`;
    const rank = leaderboard.filter(u => u.ads > localAds).length + 1;
    document.getElementById('globalRank').textContent = rank;

    // Leaderboard
    const rankList = document.getElementById('rankList');
    rankList.innerHTML = '';
    [...leaderboard].sort((a, b) => b.ads - a.ads).slice(0, 20).forEach((user, i) => {
      const probUser = ((user.ads / total) * 100).toFixed(1);
      const isMe = user.userId === userId;
      let cls = '';
      if (i === 0) cls = 'gold';
      else if (i === 1) cls = 'silver';
      else if (i === 2) cls = 'bronze';

      const el = document.createElement('div');
      el.className = `rank-item${isMe ? ' highlight' : ''}`;
      el.innerHTML = `
        <div class="rank-number ${cls}">${i + 1}</div>
        <div class="rank-info">
          <div class="rank-name">${user.userId}${isMe ? ' (You)' : ''}</div>
          <div class="rank-stats">Win Probability: ${probUser}%</div>
        </div>
        <div class="rank-ads">${user.ads}</div>
      `;
      rankList.appendChild(el);
    });

    // 🔥 Auto-end session if target reached
    if (globalWatched >= currentTarget) {
      const lockSnap = await get(ref(db, 'session_ended'));
      if (!lockSnap.exists()) {
        await set(ref(db, 'session_ended'), true);
        const sortedUsers = [...leaderboard].sort((a, b) => b.ads - a.ads);
        const prizeNum = parseFloat(currentPrize.replace(/[^0-9.]/g, '')) || 10000;
        await endCurrentSession(currentSession, prizeNum, sortedUsers);
        showToast(`🎉 Session ${currentSession} ended! Winners saved.`);
      }
    }

    // Update local state
    adsWatched = localAds;

  } catch (e) {
    console.error("Firebase load error:", e);
  }
}

// 💾 Save user ad count to Firebase
function saveUserAds() {
  if (userId !== 'NOT_APP') {
    set(ref(db, `users/${userId}/AdsWatched`), adsWatched);
  }
}

// 🍞 Toast
function showToast(message) {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 3000);
}

// 📋 Copy User ID
function copyID() {
  if (navigator.clipboard) {
    navigator.clipboard.writeText(userId).then(() => showToast('User ID copied!'));
  } else {
    showToast('User ID: ' + userId);
  }
}

// 🧭 Page Navigation
function showPage(page) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const navItems = document.querySelectorAll('.nav-item');
  if (page === 'win') {
    document.getElementById('winPage').classList.add('active');
    navItems[0].classList.add('active');
  } else if (page === 'you') {
    document.getElementById('youPage').classList.add('active');
    navItems[1].classList.add('active');
  } else if (page === 'rank') {
    document.getElementById('rankPage').classList.add('active');
    navItems[2].classList.add('active');
  }
  loadFromFirebase(); // Immediate refresh
}

// 📺 Play Ad (LibTL or Giga)
async function playAd(adType) {
  if (isPlaying) return;
  isPlaying = true;

  const btn1 = document.getElementById('libtlAdBtn');
  const btn2 = document.getElementById('gigaAdBtn');
  btn1.disabled = true;
  btn2.disabled = true;
  document.getElementById('adScreen').innerHTML = `<div style="font-weight:700;font-size:13px;">Loading ${adType}...</div>`;

  let promise;
  if (adType === 'LibTL') {
    promise = typeof window.show_10142875 === 'function' ? window.show_10142875() : Promise.reject();
  } else if (adType === 'Giga') {
    promise = typeof window.showGiga === 'function' ? window.showGiga() : Promise.reject();
  } else {
    resetUI();
    return;
  }

  try {
    await promise;
    adsWatched++;
    saveUserAds();
    showToast('✅ Ad watched! 🎥');
  } catch (e) {
    showToast('❌ Ad skipped or failed.');
  } finally {
    resetUI();
  }
}

// 🔄 Reset Ad UI
function resetUI() {
  isPlaying = false;
  document.getElementById('libtlAdBtn').disabled = false;
  document.getElementById('gigaAdBtn').disabled = false;
  document.getElementById('adScreen').innerHTML = `
    <svg width="64" height="64" viewBox="0 0 24 24">
      <polygon points="6,4 20,12 6,20" fill="#111111"></polygon>
    </svg>
  `;
}

// 🚀 Initialize App
async function init() {
  // 🔹 Detect Telegram Mini App
  if (window.Telegram && window.Telegram.WebApp) {
    const tg = window.Telegram.WebApp;
    tg.ready();
    tg.expand();
    if (tg.initDataUnsafe && tg.initDataUnsafe.user) {
      const u = tg.initDataUnsafe.user;
      // Prefer username > first_name > fallback ID
      userId = u.username || u.first_name || `User_${u.id}`;
    }
  }
  // Else: userId remains "NOT_APP"

  // Sync UI
  document.getElementById('userIdDisplay').textContent = userId;
  document.getElementById('userIdProfile').textContent = userId;

  // First load
  await loadFromFirebase();

  // 🔁 Auto-refresh every 3 seconds
  setInterval(loadFromFirebase, 3000);
}

// 🖱️ Event Listeners
document.getElementById('libtlAdBtn').addEventListener('click', () => playAd('LibTL'));
document.getElementById('gigaAdBtn').addEventListener('click', () => playAd('Giga'));

// 🏁 Start App
init();