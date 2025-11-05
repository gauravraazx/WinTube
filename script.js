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

// Expose functions to global scope for inline HTML onclick handlers
window.copyID = copyID;
window.showPage = showPage;

// ==================== PRIZE DISTRIBUTION RULES ====================
// Prize percentage for top 50 ranks
const PRIZE_RULES = {
  1: 15,    // 1st place: 15%
  2: 10,    // 2nd place: 10%
  3: 7,     // 3rd place: 7%
  4: 6,     // 4th place: 6%
  5: 5,     // 5th place: 5%
  6: 4,     // 6th place: 4%
  7: 3.5,   // 7th place: 3.5%
  8: 3,     // 8th place: 3%
  9: 2.5,   // 9th place: 2.5%
  10: 2     // 10th place: 2%
};

// Prize ranges for ranks 11-50
const RANGE_RULES = [
  { min: 11, max: 20, pct: 1.5 },  // Ranks 11-20: 1.5% each
  { min: 21, max: 30, pct: 1 },    // Ranks 21-30: 1% each
  { min: 31, max: 40, pct: 0.75 }, // Ranks 31-40: 0.75% each
  { min: 41, max: 50, pct: 0.5 }   // Ranks 41-50: 0.5% each
];

/**
 * Get prize percentage based on rank
 */
function getPrizePercentage(rank) {
  if (PRIZE_RULES[rank] !== undefined) {
    return PRIZE_RULES[rank];
  }
  for (const r of RANGE_RULES) {
    if (rank >= r.min && rank <= r.max) {
      return r.pct;
    }
  }
  return 0; // No prize for ranks below 50
}

// ==================== SESSION END & WINNER CALCULATION ====================
/**
 * End current session and calculate winners
 */
async function endCurrentSession(currentSession, prizePoolAmount, topUsers) {
  const winnersPath = `session${currentSession}_winners`;
  const prizesPath = `session${currentSession}_prizes`;

  const winnersUpdates = {};
  const prizesUpdates = {};

  // Calculate prizes for top 50 users
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

  // Save winners, prizes, and increment session
  await update(ref(db), {
    [winnersPath]: winnersUpdates,
    [prizesPath]: prizesUpdates,
    session: (parseInt(currentSession) + 1).toString(),
    session_ended: null // Remove lock
  });

  console.log(`Session ${currentSession} ended. Winners saved.`);
}

/**
 * Check if target is reached and end session
 */
async function checkAndEndSessionIfComplete() {
  if (globalWatched >= target) {
    const lockRef = ref(db, 'session_ended');
    const snap = await get(lockRef);
    
    // Check if session is not already being ended
    if (!snap.exists()) {
      // Lock to prevent duplicate processing
      await set(lockRef, true);

      // Fetch latest user data
      const dbSnap = await get(ref(db, 'users'));
      let users = [];
      
      if (dbSnap.exists()) {
        const raw = dbSnap.val();
        users = Object.entries(raw).map(([uid, data]) => ({
          userId: uid,
          ads: data.AdsWatched || 0
        }));
      }

      // Sort users by ads watched (descending)
      users.sort((a, b) => b.ads - a.ads);

      // Parse prize pool amount
      const prizeNum = parseFloat(prizePool.replace(/[^0-9.]/g, '')) || 10000;

      // End session and save winners
      await endCurrentSession(session, prizeNum, users);
      
      showToast(`🎉 Session ${session} ended! Winners saved.`);
      
      // Reload data for new session
      setTimeout(() => {
        window.location.reload();
      }, 2000);
    }
  }
}

// ==================== FIREBASE DATA MANAGEMENT ====================
/**
 * Load all data from Firebase
 */
async function loadFromFirebase() {
  const dbRef = ref(db);
  const snapshot = await get(dbRef);
  
  if (snapshot.exists()) {
    const data = snapshot.val();
    
    // Load global settings
    session = data.session || '1';
    target = data.Target || 1000;
    prizePool = data.price_pool || '$10000';

    // Update UI
    document.getElementById('prizePoolDisplay').textContent = prizePool;
    document.getElementById('sessionDisplay').textContent = `(Session: ${session})`;
    document.getElementById('target').textContent = target;

    // Load user data
    const users = data.users || {};
    const userEntry = users[userId];
    adsWatched = userEntry ? userEntry.AdsWatched || 0 : 0;
    document.getElementById('adsview').textContent = adsWatched;

    // Build leaderboard
    leaderboard = Object.entries(users).map(([uid, info]) => ({
      userId: uid,
      ads: info.AdsWatched || 0
    }));
    
    // Calculate global watched count
    globalWatched = leaderboard.reduce((sum, u) => sum + u.ads, 0);

    console.log('Data loaded from Firebase');
    console.log('Session:', session, 'Target:', target, 'Global Watched:', globalWatched);
  } else {
    // Initialize default values if database is empty
    await set(ref(db, 'session'), '1');
    await set(ref(db, 'Target'), 1000);
    await set(ref(db, 'price_pool'), '$10000');
    console.log('Firebase initialized with default values');
  }
}

/**
 * Save user's ad count to Firebase
 */
function saveUserAds() {
  set(ref(db, `users/${userId}/AdsWatched`), adsWatched);
  console.log(`Saved ads for ${userId}: ${adsWatched}`);
}

/**
 * Setup real-time listeners for Firebase updates
 */
function setupRealtimeListeners() {
  // Listen to global target changes
  onValue(ref(db, 'Target'), (snapshot) => {
    if (snapshot.exists()) {
      target = snapshot.val();
      document.getElementById('target').textContent = target;
      updateDisplay();
    }
  });

  // Listen to session changes
  onValue(ref(db, 'session'), (snapshot) => {
    if (snapshot.exists()) {
      const newSession = snapshot.val();
      if (newSession !== session) {
        session = newSession;
        document.getElementById('sessionDisplay').textContent = `(Session: ${session})`;
        showToast(`New session started: ${session}`);
      }
    }
  });

  // Listen to prize pool changes
  onValue(ref(db, 'price_pool'), (snapshot) => {
    if (snapshot.exists()) {
      prizePool = snapshot.val();
      document.getElementById('prizePoolDisplay').textContent = prizePool;
    }
  });

  // Listen to all users for real-time leaderboard
  onValue(ref(db, 'users'), (snapshot) => {
    if (snapshot.exists()) {
      const users = snapshot.val();
      leaderboard = Object.entries(users).map(([uid, info]) => ({
        userId: uid,
        ads: info.AdsWatched || 0
      }));
      globalWatched = leaderboard.reduce((sum, u) => sum + u.ads, 0);
      updateDisplay();
      updateYouPage();
      
      // Update leaderboard if on rank page
      if (document.getElementById('rankPage').classList.contains('active')) {
        updateLeaderboard();
      }
    }
  });
}

// ==================== UI HELPER FUNCTIONS ====================
/**
 * Show toast notification
 */
function showToast(message) {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 3000);
}

/**
 * Copy user ID to clipboard
 */
function copyID() {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(userId)
      .then(() => showToast('✅ User ID copied!'))
      .catch(() => showToast('User ID: ' + userId));
  } else {
    showToast('User ID: ' + userId);
  }
}

/**
 * Switch between pages
 */
function showPage(page) {
  // Hide all pages
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  
  // Show selected page
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
  }
}

/**
 * Update main display (progress bar, remaining, etc.)
 */
function updateDisplay() {
  const remaining = Math.max(target - globalWatched, 0);
  document.getElementById('remaining').textContent = remaining;
  document.getElementById('watched').textContent = globalWatched;
  
  const progressPercent = Math.min((globalWatched / target) * 100, 100);
  document.getElementById('progress').style.width = `${progressPercent}%`;
}

/**
 * Update "You" page with user stats
 */
function updateYouPage() {
  // Update ads watched
  document.getElementById('youAdsWatched').textContent = adsWatched;
  
  // Calculate probability
  const total = globalWatched || 1;
  const prob = (adsWatched / total) * 100;
  document.getElementById('probability').textContent = `${Math.min(prob, 100).toFixed(1)}%`;
  document.getElementById('probFill').style.width = `${Math.min(prob, 100)}%`;
  
  // Calculate rank
  const rank = leaderboard.filter(u => u.ads > adsWatched).length + 1;
  document.getElementById('globalRank').textContent = rank;
}

/**
 * Update leaderboard display
 */
function updateLeaderboard() {
  const list = document.getElementById('rankList');
  list.innerHTML = '';
  
  // Sort and get top 20
  const sortedUsers = [...leaderboard].sort((a, b) => b.ads - a.ads).slice(0, 20);
  
  sortedUsers.forEach((user, i) => {
    const total = globalWatched || 1;
    const prob = ((user.ads / total) * 100).toFixed(1);
    const isMe = user.userId === userId;
    
    // Determine medal class
    let medalClass = '';
    if (i === 0) medalClass = 'gold';
    else if (i === 1) medalClass = 'silver';
    else if (i === 2) medalClass = 'bronze';

    // Create rank item
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

// ==================== AD PLAYBACK LOGIC ====================
/**
 * Play advertisement
 */
async function playAd(adType) {
  if (isPlaying) {
    showToast('⏳ Please wait for current ad to finish');
    return;
  }
  
  isPlaying = true;

  // Disable both buttons
  const btn1 = document.getElementById('libtlAdBtn');
  const btn2 = document.getElementById('gigaAdBtn');
  btn1.disabled = true;
  btn2.disabled = true;

  // Show loading state
  document.getElementById('adScreen').innerHTML = `
    <div style="font-weight:700;font-size:13px;">Loading ${adType} Ad...</div>
  `;

  let promise;
  
  // Call appropriate ad SDK
  if (adType === 'LibTL') {
    if (typeof window.show_10142875 === 'function') {
      promise = window.show_10142875();
    } else {
      promise = Promise.reject(new Error('LibTL SDK not loaded'));
    }
  } else if (adType === 'Giga') {
    if (typeof window.showGiga === 'function') {
      promise = window.showGiga();
    } else {
      promise = Promise.reject(new Error('Giga SDK not loaded'));
    }
  } else {
    resetUI();
    return;
  }

  try {
    // Wait for ad to complete
    await promise;
    
    // Increment user's ad count
    adsWatched++;
    document.getElementById('adsview').textContent = adsWatched;

    // Save to Firebase
    saveUserAds();

    // Update local leaderboard
    const existing = leaderboard.find(u => u.userId === userId);
    if (existing) {
      existing.ads = adsWatched;
    } else {
      leaderboard.push({ userId, ads: adsWatched });
    }
    
    // Recalculate global watched
    globalWatched = leaderboard.reduce((sum, u) => sum + u.ads, 0);

    // Update UI
    updateDisplay();
    updateYouPage();
    showToast('✅ Ad watched successfully! 🎥');

    // Check if session should end
    await checkAndEndSessionIfComplete();

  } catch (error) {
    console.error('Ad error:', error);
    showToast('❌ Ad skipped or failed');
  } finally {
    resetUI();
  }
}

/**
 * Reset UI after ad playback
 */
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

// ==================== EVENT LISTENERS ====================
document.getElementById('libtlAdBtn').addEventListener('click', () => playAd('LibTL'));
document.getElementById('gigaAdBtn').addEventListener('click', () => playAd('Giga'));

// ==================== INITIALIZATION ====================
init();

async function init() {
  console.log('Initializing CashTarget...');
  
  // Check if running in Telegram Mini App
  if (window.Telegram?.WebApp) {
    const tg = window.Telegram.WebApp;
    tg.ready();
    tg.expand();
    
    // Get Telegram user data
    if (tg.initDataUnsafe?.user) {
      const u = tg.initDataUnsafe.user;
      // Use Telegram User ID as unique identifier
      userId = `TG_${u.id}`;
      
      console.log('✅ Telegram User ID:', userId);
      console.log('Username:', u.username);
      console.log('First Name:', u.first_name);
    } else {
      console.warn('⚠️ Telegram user data not available');
    }
  } else {
    // Browser fallback - keep NOT_APP for testing
    console.log('🌐 Running in browser mode with userId:', userId);
  }

  // Update UI with user ID
  document.getElementById('userIdDisplay').textContent = userId;
  document.getElementById('userIdProfile').textContent = userId;

  // Load data from Firebase
  await loadFromFirebase();
  
  // Setup real-time listeners
  setupRealtimeListeners();
  
  // Update UI
  updateDisplay();
  updateYouPage();
  
  console.log('✅ Initialization complete');
}