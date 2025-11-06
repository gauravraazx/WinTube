// Firebase setup
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getDatabase,
  ref,
  get,
  set,
  update,
  onValue
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";

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

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

// ==================== STATE VARIABLES ====================
let userId = 'NOT_APP';
let adsWatched = 0;
let target = 1000;
let session = '1';
let prizePool = '$10000';
let isPlaying = false;
let globalWatched = 0;
let leaderboard = [];
let usdtBalance = 0;
let walletAddress = '';
let totalReferred = 0;
let bonusAds = 0;
let countdownInterval = null;

// Ad SDK status tracking
let gigaPubReady = false;
let libtlReady = false;

// Expose functions to global scope
window.copyID = copyID;
window.showPage = showPage;
window.withdraw = withdraw;
window.saveWalletAddress = saveWalletAddress;
window.copyRefLink = copyRefLink;

// ==================== AD SDK INITIALIZATION ====================
function initializeAdSDKs() {
  // Check LibTL availability
  const checkLibTL = setInterval(() => {
    if (typeof window.show_10142875 === 'function') {
      libtlReady = true;
      console.log('✅ LibTL SDK ready');
      clearInterval(checkLibTL);
    }
  }, 500);

  // Timeout for LibTL
  setTimeout(() => {
    clearInterval(checkLibTL);
    if (!libtlReady) {
      console.warn('⚠️ LibTL SDK failed to load');
    }
  }, 10000);

  // Check GigaPub availability
  const checkGigaPub = setInterval(() => {
    if (typeof window.showGiga === 'function') {
      gigaPubReady = true;
      console.log('✅ GigaPub SDK ready');
      clearInterval(checkGigaPub);
    }
  }, 500);

  // Timeout for GigaPub
  setTimeout(() => {
    clearInterval(checkGigaPub);
    if (!gigaPubReady) {
      console.warn('⚠️ GigaPub SDK failed to load');
      console.log('Checking window.showGiga:', typeof window.showGiga);
    }
  }, 10000);
}

// ==================== COUNTDOWN LOGIC ====================
function startCountdown(seconds, onComplete) {
  let remaining = seconds;
  const btn1 = document.getElementById('libtlAdBtn');
  const btn2 = document.getElementById('gigaAdBtn');
  
  btn1.disabled = true;
  btn2.disabled = true;
  
  const updateCountdown = () => {
    if (remaining <= 0) {
      clearInterval(countdownInterval);
      countdownInterval = null;
      document.getElementById('adScreen').innerHTML = `
        <svg width="64" height="64" viewBox="0 0 24 24">
          <polygon points="6,4 20,12 6,20" fill="#111111"></polygon>
        </svg>
      `;
      btn1.disabled = false;
      btn2.disabled = false;
      if (onComplete) onComplete();
      return;
    }
    
    document.getElementById('adScreen').innerHTML = `
      <div style="font-weight:700;font-size:48px;color:var(--primary);">${remaining}</div>
      <div style="font-size:12px;color:var(--muted);margin-top:8px;">Next ad available in...</div>
    `;
    remaining--;
  };
  
  updateCountdown();
  countdownInterval = setInterval(updateCountdown, 1000);
}

// ==================== PRIZE DISTRIBUTION RULES ====================
const PRIZE_RULES = {
  1: 15,    // 1st: 15%
  2: 10,    // 2nd: 10%
  3: 7,     // 3rd: 7%
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
  return 0;
}

// ==================== SESSION END & WINNER CALCULATION ====================
async function endCurrentSession(currentSession, prizePoolAmount, topUsers) {
  const winnersPath = `session${currentSession}_winners`;
  const prizesPath = `session${currentSession}_prizes`;
  const resetAdsUpdates = {};

  const winnersUpdates = {};
  const prizesUpdates = {};

  // Distribute prizes to top 50
  const top50 = topUsers.slice(0, 50);
  for (let i = 0; i < top50.length; i++) {
    const user = top50[i];
    const rank = i + 1;
    const pct = getPrizePercentage(rank);
    if (pct > 0) {
      winnersUpdates[user.userId] = rank;
      const prize = (prizePoolAmount * pct) / 100;
      prizesUpdates[user.userId] = parseFloat(prize.toFixed(2));

      // Update USDT balance
      const balanceRef = ref(db, `users/${user.userId}/USDTBalance`);
      const balanceSnap = await get(balanceRef);
      const current = balanceSnap.exists() ? balanceSnap.val() : 0;
      await set(balanceRef, parseFloat((current + prize).toFixed(2)));
    }
  }

  // 🔁 RESET ALL USERS' ADS TO 0 FOR NEW SESSION
  for (const user of topUsers) {
    resetAdsUpdates[`users/${user.userId}/AdsWatched`] = 0;
  }

  // Final update: winners, prizes, reset ads, new session
  await update(ref(db), {
    [winnersPath]: winnersUpdates,
    [prizesPath]: prizesUpdates,
    session: (parseInt(currentSession) + 1).toString(),
    session_ended: null,
    ...resetAdsUpdates
  });

  console.log(`✅ Session ${currentSession} ended. Prizes sent. All ads reset.`);
}

async function checkAndEndSessionIfComplete() {
  if (globalWatched >= target) {
    const lockRef = ref(db, 'session_ended');
    const snap = await get(lockRef);
    if (!snap.exists()) {
      await set(lockRef, true);

      const dbSnap = await get(ref(db, 'users'));
      let users = [];
      if (dbSnap.exists()) {
        const raw = dbSnap.val();
        users = Object.entries(raw).map(([uid, data]) => ({
          userId: uid,
          ads: data.AdsWatched || 0
        }));
      }

      users.sort((a, b) => b.ads - a.ads);
      const prizeNum = parseFloat(prizePool.replace(/[^0-9.]/g, '')) || 10000;

      await endCurrentSession(session, prizeNum, users);
      showToast(`🎉 Session ${session} ended! Prizes distributed. New session loading...`);
      setTimeout(() => window.location.reload(), 3000);
    }
  }
}

// ==================== REFERRAL LOGIC ====================
function generateRefLink() {
  return `https://t.me/Win_Tube_Bot/WinTube?startapp=${userId}`;
}

async function loadReferralData() {
  const refRef = ref(db, `referrals/${userId}`);
  const snap = await get(refRef);
  if (snap.exists()) {
    const data = snap.val();
    totalReferred = data.totalReferred || 0;
    bonusAds = data.bonusAds || 0;
  } else {
    totalReferred = 0;
    bonusAds = 0;
  }
  updateReferralUI();
}

async function processReferral(referrerId, newUserId) {
  if (!referrerId || !newUserId || referrerId === newUserId) return;

  // Check if already rewarded
  const recordRef = ref(db, `referrals/${referrerId}/referred/${newUserId}`);
  const recordSnap = await get(recordRef);
  if (recordSnap.exists()) return;

  // Ensure new user has watched at least 1 ad
  const newUserRef = ref(db, `users/${newUserId}`);
  const newUserSnap = await get(newUserRef);
  if (!newUserSnap.exists() || (newUserSnap.val().AdsWatched || 0) < 1) return;

  // Grant 10 bonus ads to referrer
  const referrerUserRef = ref(db, `users/${referrerId}`);
  const refSnap = await get(referrerUserRef);
  if (refSnap.exists()) {
    const currentAds = refSnap.val().AdsWatched || 0;
    await update(referrerUserRef, { AdsWatched: currentAds + 10 });
  }

  // Update referral stats
  const refStatsRef = ref(db, `referrals/${referrerId}`);
  const statsSnap = await get(refStatsRef);
  const currentStats = statsSnap.exists() ? statsSnap.val() : { totalReferred: 0, bonusAds: 0 };
  await update(refStatsRef, {
    totalReferred: (currentStats.totalReferred || 0) + 1,
    bonusAds: (currentStats.bonusAds || 0) + 10
  });

  // Mark as processed
  await set(recordRef, { timestamp: Date.now() });
  console.log(`✅ Referral processed: ${newUserId} → ${referrerId} (+10 ads)`);
}

// Check URL for referral on app start
function getReferrerFromUrl() {
  // Check Telegram WebApp start parameter
  if (window.Telegram?.WebApp?.initDataUnsafe?.start_param) {
    return window.Telegram.WebApp.initDataUnsafe.start_param;
  }
  
  // Check URL path
  const pathParts = window.location.pathname.split('/');
  const lastPart = pathParts[pathParts.length - 1];
  if (lastPart && lastPart.startsWith('TG_')) {
    return lastPart;
  }
  
  // Check URL query parameter
  const urlParams = new URLSearchParams(window.location.search);
  return urlParams.get('ref') || urlParams.get('startapp');
}

// ==================== FIREBASE & UI ====================
async function loadFromFirebase() {
  const dbRef = ref(db);
  const snapshot = await get(dbRef);
  
  if (snapshot.exists()) {
    const data = snapshot.val();
    session = data.session || '1';
    target = data.Target || 1000;
    prizePool = data.price_pool || '$10000';

    document.getElementById('prizePoolDisplay').textContent = prizePool;
    document.getElementById('sessionDisplay').textContent = `(Session: ${session})`;
    document.getElementById('target').textContent = target;

    const users = data.users || {};
    const userEntry = users[userId];
    adsWatched = userEntry ? userEntry.AdsWatched || 0 : 0;
    usdtBalance = userEntry ? userEntry.USDTBalance || 0 : 0;
    walletAddress = userEntry ? userEntry.WalletAddress || '' : '';

    document.getElementById('adsview').textContent = adsWatched;
    document.getElementById('usdtBalanceDisplay').textContent = `$${usdtBalance.toFixed(2)}`;
    
    const walletInput = document.getElementById('walletAddressInput');
    if (walletInput && walletAddress) {
      walletInput.value = walletAddress;
    }

    leaderboard = Object.entries(users).map(([uid, info]) => ({
      userId: uid,
      ads: info.AdsWatched || 0
    }));
    globalWatched = leaderboard.reduce((sum, u) => sum + u.ads, 0);

    await loadReferralData();
  } else {
    await set(ref(db, 'session'), '1');
    await set(ref(db, 'Target'), 1000);
    await set(ref(db, 'price_pool'), '$10000');
  }
}

function saveUserAds() {
  set(ref(db, `users/${userId}/AdsWatched`), adsWatched);
}

function setupRealtimeListeners() {
  onValue(ref(db, 'Target'), (s) => {
    if (s.exists()) {
      target = s.val();
      document.getElementById('target').textContent = target;
      updateDisplay();
    }
  });

  onValue(ref(db, 'session'), (s) => {
    if (s.exists()) {
      const newSession = s.val();
      if (newSession !== session) {
        session = newSession;
        document.getElementById('sessionDisplay').textContent = `(Session: ${session})`;
        showToast(`🎊 New session started: ${session}`);
      }
    }
  });

  onValue(ref(db, 'price_pool'), (s) => {
    if (s.exists()) {
      prizePool = s.val();
      document.getElementById('prizePoolDisplay').textContent = prizePool;
    }
  });

  onValue(ref(db, 'users'), (s) => {
    if (s.exists()) {
      const users = s.val();
      leaderboard = Object.entries(users).map(([uid, info]) => ({
        userId: uid,
        ads: info.AdsWatched || 0
      }));
      globalWatched = leaderboard.reduce((sum, u) => sum + u.ads, 0);
      
      const userEntry = users[userId];
      if (userEntry) {
        const newBalance = userEntry.USDTBalance || 0;
        if (newBalance !== usdtBalance) {
          usdtBalance = newBalance;
          document.getElementById('usdtBalanceDisplay').textContent = `$${usdtBalance.toFixed(2)}`;
        }
        const newWallet = userEntry.WalletAddress || '';
        if (newWallet !== walletAddress) {
          walletAddress = newWallet;
          const walletInput = document.getElementById('walletAddressInput');
          if (walletInput) walletInput.value = walletAddress;
        }
      }
      updateDisplay();
      updateYouPage();
      if (document.getElementById('rankPage').classList.contains('active')) updateLeaderboard();
      if (document.getElementById('referPage').classList.contains('active')) updateReferralUI();
    }
  });
}

// ==================== UI HELPERS ====================
function showToast(message) {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 3000);
}

function copyID() {
  if (navigator.clipboard) {
    navigator.clipboard.writeText(userId).then(() => showToast('✅ User ID copied!'));
  } else {
    showToast('User ID: ' + userId);
  }
}

function copyRefLink() {
  const link = generateRefLink();
  if (navigator.clipboard) {
    navigator.clipboard.writeText(link).then(() => showToast('✅ Invite link copied!'));
  } else {
    showToast('Link: ' + link);
  }
}

function showPage(page) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  
  if (page === 'win') {
    document.getElementById('winPage').classList.add('active');
    document.querySelectorAll('.nav-item')[0].classList.add('active');
  } else if (page === 'you') {
    document.getElementById('youPage').classList.add('active');
    document.querySelectorAll('.nav-item')[1].classList.add('active');
    updateYouPage();
  } else if (page === 'rank') {
    document.getElementById('rankPage').classList.add('active');
    document.querySelectorAll('.nav-item')[2].classList.add('active');
    updateLeaderboard();
  } else if (page === 'refer') {
    document.getElementById('referPage').classList.add('active');
    document.querySelectorAll('.nav-item')[3].classList.add('active');
    updateReferralUI();
  }
}

function updateDisplay() {
  const remaining = Math.max(target - globalWatched, 0);
  document.getElementById('remaining').textContent = remaining;
  document.getElementById('watched').textContent = globalWatched;
  const progressPercent = Math.min((globalWatched / target) * 100, 100);
  document.getElementById('progress').style.width = `${progressPercent}%`;
}

function updateYouPage() {
  document.getElementById('youAdsWatched').textContent = adsWatched;
  const total = globalWatched || 1;
  const prob = (adsWatched / total) * 100;
  document.getElementById('probability').textContent = `${Math.min(prob, 100).toFixed(1)}%`;
  document.getElementById('probFill').style.width = `${Math.min(prob, 100)}%`;
  const rank = leaderboard.filter(u => u.ads > adsWatched).length + 1;
  document.getElementById('globalRank').textContent = rank;
}

function updateReferralUI() {
  document.getElementById('totalReferred').textContent = totalReferred;
  document.getElementById('bonusAds').textContent = bonusAds;
  document.getElementById('refLinkInput').value = generateRefLink();
}

function updateLeaderboard() {
  const list = document.getElementById('rankList');
  list.innerHTML = '';
  const sortedUsers = [...leaderboard].sort((a, b) => b.ads - a.ads).slice(0, 20);
  sortedUsers.forEach((user, i) => {
    const total = globalWatched || 1;
    const prob = ((user.ads / total) * 100).toFixed(1);
    const isMe = user.userId === userId;
    let medalClass = '';
    if (i === 0) medalClass = 'gold';
    else if (i === 1) medalClass = 'silver';
    else if (i === 2) medalClass = 'bronze';
    const el = document.createElement('div');
    el.className = `rank-item${isMe ? ' highlight' : ''}`;
    el.innerHTML = `
      <div class="rank-number ${medalClass}">${i + 1}</div>
      <div class="rank-info">
        <div class="rank-name">${user.userId}${isMe ? ' (You)' : ''}</div>
        <div class="rank-stats">Win Probability: ${prob}%</div>
      </div>
      <div class="rank-ads">${user.ads}</div>
    `;
    list.appendChild(el);
  });
}

// ==================== AD PLAYBACK ====================
async function playLibTLAd() {
  return new Promise((resolve, reject) => {
    if (!libtlReady || typeof window.show_10142875 !== 'function') {
      reject(new Error('LibTL SDK not ready'));
      return;
    }

    try {
      const result = window.show_10142875();
      if (result && typeof result.then === 'function') {
        result.then(resolve).catch(reject);
      } else {
        // If not a promise, assume success after delay
        setTimeout(resolve, 2000);
      }
    } catch (error) {
      reject(error);
    }
  });
}

async function playGigaPubAd() {
  return new Promise((resolve, reject) => {
    if (!gigaPubReady || typeof window.showGiga !== 'function') {
      reject(new Error('GigaPub SDK not ready'));
      return;
    }

    console.log('🎬 Starting GigaPub ad...');
    
    window.showGiga()
      .then(() => {
        console.log('✅ GigaPub ad completed successfully');
        resolve();
      })
      .catch(e => {
        console.error('❌ GigaPub ad error:', e);
        reject(e);
      });
  });
}

async function playAd(adType) {
  if (isPlaying) {
    showToast('⏳ Please wait for current ad to finish');
    return;
  }

  // Check if countdown is running
  if (countdownInterval) {
    showToast('⏳ Please wait for countdown to finish');
    return;
  }

  // Check SDK readiness
  if (adType === 'LibTL' && !libtlReady) {
    showToast('⚠️ LibTL ad not ready yet. Please wait...');
    return;
  }
  
  if (adType === 'Giga' && !gigaPubReady) {
    showToast('⚠️ GigaPub ad not ready yet. Please wait...');
    return;
  }

  isPlaying = true;
  const btn1 = document.getElementById('libtlAdBtn');
  const btn2 = document.getElementById('gigaAdBtn');
  btn1.disabled = true;
  btn2.disabled = true;
  
  document.getElementById('adScreen').innerHTML = `
    <div style="font-weight:700;font-size:13px;text-align:center;">
      <div style="margin-bottom:10px;">Loading ${adType} Ad...</div>
      <div style="font-size:11px;color:var(--muted);">Please wait</div>
    </div>
  `;

  try {
    if (adType === 'LibTL') {
      await playLibTLAd();
    } else if (adType === 'Giga') {
      await playGigaPubAd();
    }

    // Ad completed successfully
    adsWatched++;
    document.getElementById('adsview').textContent = adsWatched;
    saveUserAds();

    const existing = leaderboard.find(u => u.userId === userId);
    if (existing) existing.ads = adsWatched;
    else leaderboard.push({ userId, ads: adsWatched });

    globalWatched = leaderboard.reduce((sum, u) => sum + u.ads, 0);
    updateDisplay();
    updateYouPage();
    showToast('✅ Ad watched successfully! 🎥');
    
    // Start 6-second countdown
    isPlaying = false;
    startCountdown(6, async () => {
      await checkAndEndSessionIfComplete();
    });

  } catch (error) {
    console.error(`${adType} ad error:`, error);
    showToast(`❌ ${adType} ad failed. Try again or use other ad.`);
    resetUI();
  }
}

function resetUI() {
  isPlaying = false;
  const btn1 = document.getElementById('libtlAdBtn');
  const btn2 = document.getElementById('gigaAdBtn');
  btn1.disabled = false;
  btn2.disabled = false;
  document.getElementById('adScreen').innerHTML = `
    <svg width="64" height="64" viewBox="0 0 24 24">
      <polygon points="6,4 20,12 6,20" fill="#111111"></polygon>
    </svg>
  `;
}

// ==================== WITHDRAWAL ====================
async function saveWalletAddress() {
  const input = document.getElementById('walletAddressInput');
  const addr = input.value.trim();
  if (!addr) return showToast('❌ Please enter a wallet address');
  const pattern = /^(UQ|EQ|0:)[a-zA-Z0-9_-]{46,48}$/;
  if (!pattern.test(addr)) return showToast('❌ Invalid TON USDT address');
  try {
    await set(ref(db, `users/${userId}/WalletAddress`), addr);
    walletAddress = addr;
    showToast('✅ Wallet saved!');
  } catch (e) {
    showToast('❌ Save failed');
  }
}

async function withdraw() {
  const MIN = 0.10;
  if (!walletAddress) return showToast('❌ Add wallet first');
  if (usdtBalance < MIN) return showToast(`❌ Min: $${MIN.toFixed(2)}`);
  if (!confirm(`Withdraw $${usdtBalance.toFixed(2)} USDT to:\n${walletAddress}\n\nProcessing: 24-48h?`)) return;

  try {
    const wid = `${userId}_${Date.now()}`;
    await set(ref(db, `withdrawals/${wid}`), {
      userId, walletAddress, amount: parseFloat(usdtBalance.toFixed(2)),
      timestamp: Date.now(), status: 'pending', session, dateCreated: new Date().toISOString()
    });
    await set(ref(db, `users/${userId}/USDTBalance`), 0);
    usdtBalance = 0;
    document.getElementById('usdtBalanceDisplay').textContent = '$0.00';
    showToast('✅ Withdrawal submitted!');
    setTimeout(() => showToast('⏳ Processing: 24-48 hours'), 3000);
  } catch (e) {
    showToast('❌ Withdrawal failed');
  }
}

// ==================== INIT ====================
document.getElementById('libtlAdBtn').addEventListener('click', () => playAd('LibTL'));
document.getElementById('gigaAdBtn').addEventListener('click', () => playAd('Giga'));

async function init() {
  console.log('🚀 Initializing CashTarget...');
  
  // Telegram WebApp
  if (window.Telegram?.WebApp) {
    const tg = window.Telegram.WebApp;
    tg.ready();
    tg.expand();
    if (tg.initDataUnsafe?.user) {
      const u = tg.initDataUnsafe.user;
      userId = `TG_${u.id}`;
    }
  }

  document.getElementById('userIdDisplay').textContent = userId;
  document.getElementById('userIdProfile').textContent = userId;

  // Initialize ad SDKs
  initializeAdSDKs();

  // 🔗 Process referral from URL
  const referrerId = getReferrerFromUrl();
  if (referrerId && referrerId !== userId) {
    console.log('Processing referral:', referrerId, '→', userId);
    await processReferral(referrerId, userId);
  }

  await loadFromFirebase();
  setupRealtimeListeners();
  updateDisplay();
  updateYouPage();

  console.log('✅ Ready. Session:', session, 'User:', userId);
  console.log('📊 LibTL Ready:', libtlReady, '| GigaPub Ready:', gigaPubReady);
}

window.addEventListener('load', init);