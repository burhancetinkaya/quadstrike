import Phaser from 'phaser';

import './styles.css';

import { FRONTEND_CONFIG } from './config';
import { getActivePlayerIds, MATCH_DURATION_MS, PLAYER_DEFINITIONS, SIMULATION_HZ } from './game/constants';
import { ArenaScene } from './game/scene';
import { MatchRuntime } from './game/runtime';
import { observeLandscape } from './platform/orientation';
import { registerServiceWorker } from './platform/pwa';
import type { GameSnapshot, MatchSize, SessionInfo } from './game/types';

const root = document.querySelector<HTMLDivElement>('#app');
if (!root) {
  throw new Error('Missing #app root container.');
}

const DEFAULT_ROOM_ID = 'ARENA';

const ensureStitchFonts = (): void => {
  const stylesheetId = 'quadstrike-stitch-fonts';
  if (document.getElementById(stylesheetId)) {
    return;
  }

  const appendLink = (id: string, rel: string, href: string, crossOrigin?: string): void => {
    if (document.getElementById(id)) {
      return;
    }

    const link = document.createElement('link');
    link.id = id;
    link.rel = rel;
    link.href = href;
    if (crossOrigin !== undefined) {
      link.crossOrigin = crossOrigin;
    }
    document.head.appendChild(link);
  };

  appendLink('quadstrike-fonts-preconnect', 'preconnect', 'https://fonts.googleapis.com');
  appendLink('quadstrike-fonts-preconnect-static', 'preconnect', 'https://fonts.gstatic.com', 'anonymous');
  appendLink(
    stylesheetId,
    'stylesheet',
    'https://fonts.googleapis.com/css2?family=Orbitron:wght@400;700;900&family=Inter:wght@300;400;600;700&display=swap',
  );
};

ensureStitchFonts();

root.innerHTML = `
  <div class="shell">
    <div class="shell-noise" aria-hidden="true"></div>
    <div class="shell-orb orb-emerald" aria-hidden="true"></div>
    <div class="shell-orb orb-blue" aria-hidden="true"></div>
    <header class="topbar">
      <div class="topbar-row topbar-row-primary">
        <div class="brand">
          <h1>QUAD<span>STRIKE</span></h1>
        </div>
        <div class="mobile-score-strip" id="mobile-score-strip">
          <div class="mobile-score-card white" data-mobile-player-key="white" data-mobile-player-id="0">
            <span class="mobile-score-dot" aria-hidden="true"></span>
            <span class="mobile-score-value" data-mobile-score="white">0</span>
          </div>
          <div class="mobile-score-card orange" data-mobile-player-key="orange" data-mobile-player-id="2">
            <span class="mobile-score-dot" aria-hidden="true"></span>
            <span class="mobile-score-value" data-mobile-score="orange">0</span>
          </div>
          <div class="mobile-clock-panel">
            <span class="mobile-clock-label">Time</span>
            <span class="mobile-match-clock" id="mobile-match-clock">2:00</span>
          </div>
          <div class="mobile-score-card green" data-mobile-player-key="green" data-mobile-player-id="3">
            <span class="mobile-score-dot" aria-hidden="true"></span>
            <span class="mobile-score-value" data-mobile-score="green">0</span>
          </div>
          <div class="mobile-score-card blue" data-mobile-player-key="blue" data-mobile-player-id="1">
            <span class="mobile-score-dot" aria-hidden="true"></span>
            <span class="mobile-score-value" data-mobile-score="blue">0</span>
          </div>
        </div>
        <div class="topbar-actions">
          <button id="practice-button">
            <span class="button-dot"></span>
            <span>Practice</span>
          </button>
          <button id="host-button" class="secondary">
            <span class="button-icon">+</span>
            <span>Create Match</span>
          </button>
          <button id="join-button" class="secondary">
            <span class="button-icon">↗</span>
            <span>Join Match</span>
          </button>
        </div>
      </div>
      <div class="topbar-row topbar-row-secondary">
        <p class="footer-status" id="status-text"></p>
        <div class="telemetry-strip">
          <div class="metric-card compact">
            <span class="metric-label">FPS</span>
            <strong class="metric-value" id="fps-value">0</strong>
          </div>
          <div class="metric-card compact">
            <span class="metric-label">Ping</span>
            <strong class="metric-value" id="ping-value">0 ms</strong>
          </div>
          <div class="metric-card compact">
            <span class="metric-label">Connected</span>
            <strong class="metric-value" id="peers-value">0</strong>
          </div>
          <div class="metric-card compact network-card">
            <span class="metric-label">Network</span>
            <div class="network-pill" id="network-pill" data-state="local">
              <span class="network-dot" aria-hidden="true"></span>
              <strong id="network-value">LOCAL</strong>
            </div>
          </div>
        </div>
      </div>
      <div class="session-state-hooks" hidden aria-hidden="true">
        <span id="mode-value">Practice</span>
        <span id="player-value">Gold</span>
        <span id="room-value">LOCAL</span>
      </div>
    </header>

    <main class="layout">
      <section class="match-header-wrap">
        <div class="match-header">
          <div class="scoreboard scoreboard-side" id="scoreboard-left"></div>
          <div class="match-clock-panel">
            <span class="match-clock-label">Time Remaining</span>
            <div class="match-clock" id="match-clock">2:00</div>
          </div>
          <div class="scoreboard scoreboard-side scoreboard-side-right" id="scoreboard-right"></div>
        </div>
      </section>

      <section class="arena-card">
        <div class="game-frame">
          <div class="arena-plate" aria-hidden="true"></div>
          <div class="arena-grid" aria-hidden="true"></div>
          <div id="game-root"></div>
          <div class="hud-layer">
            <div class="goal-toast" id="goal-toast">Goal</div>
            <div class="countdown-overlay" id="countdown-overlay" aria-hidden="true">
              <span class="countdown-value" id="countdown-value">3</span>
            </div>
            <div class="lobby-overlay" id="lobby-overlay" aria-hidden="true">
              <div class="lobby-panel">
                <p class="lobby-title" id="lobby-title">Waiting For Players</p>
                <p class="lobby-copy" id="lobby-copy">1 / 2 connected</p>
              </div>
            </div>
            <pre class="debug-overlay" id="debug-overlay"></pre>
            <div class="orientation-overlay" id="orientation-overlay">
              <div class="orientation-panel">
                <h2>Rotate Phone</h2>
                <div class="rotate-icon" aria-hidden="true"></div>
                <p>Please rotate your phone to landscape mode.</p>
              </div>
            </div>
            <div class="touch-controls">
              <div class="move-buttons">
                <button class="touch-button" id="move-left" aria-label="Move left">◀</button>
                <button class="touch-button" id="move-right" aria-label="Move right">▶</button>
              </div>
            </div>
          </div>
        </div>
      </section>
    </main>

    <div class="modal-shell" id="result-modal" aria-hidden="true">
      <div class="modal-backdrop"></div>
      <div class="modal-panel result-panel" role="dialog" aria-modal="true" aria-labelledby="result-modal-title">
        <button class="modal-close" id="result-close" aria-label="Close result dialog">×</button>
        <p class="modal-eyebrow">Match Finished</p>
        <h2 id="result-modal-title">Winner</h2>
        <p class="result-winner" id="result-winner">GOLD WINS</p>
        <p class="modal-copy" id="result-summary">Conceded the fewest goals.</p>
      </div>
    </div>

    <div class="modal-shell" id="session-modal" aria-hidden="true">
      <div class="modal-backdrop" id="session-modal-backdrop"></div>
      <div class="modal-panel" role="dialog" aria-modal="true" aria-labelledby="session-modal-title">
        <button class="modal-close" id="session-modal-close" aria-label="Close dialog">×</button>
        <p class="modal-eyebrow" id="session-modal-eyebrow">Multiplayer</p>
        <h2 id="session-modal-title">Connection Setup</h2>
        <p class="modal-copy" id="session-modal-copy">
          Enter the room details and validate the signaling connection before starting.
        </p>
        <div class="control-grid modal-grid">
          <div class="field" id="session-match-size-field">
            <label for="session-match-size">Match Size</label>
            <select id="session-match-size">
              <option value="2">2 Players</option>
              <option value="4" selected>4 Players</option>
            </select>
          </div>
          <div class="field" id="session-room-id-field">
            <label for="session-room-id">Room ID</label>
            <input id="session-room-id" value="${DEFAULT_ROOM_ID}" maxlength="8" />
          </div>
        </div>
        <p class="modal-feedback" id="session-modal-feedback">Connection idle.</p>
        <div class="modal-actions">
          <button id="session-modal-cancel" class="ghost">Cancel</button>
          <button id="session-modal-submit" class="secondary">Continue</button>
        </div>
      </div>
    </div>
  </div>
`;

const gameRoot = root.querySelector<HTMLDivElement>('#game-root');
const scoreboardLeft = root.querySelector<HTMLDivElement>('#scoreboard-left');
const scoreboardRight = root.querySelector<HTMLDivElement>('#scoreboard-right');
const matchClock = root.querySelector<HTMLDivElement>('#match-clock');
const mobileMatchClock = root.querySelector<HTMLSpanElement>('#mobile-match-clock');
const goalToast = root.querySelector<HTMLDivElement>('#goal-toast');
const countdownOverlay = root.querySelector<HTMLDivElement>('#countdown-overlay');
const countdownValue = root.querySelector<HTMLSpanElement>('#countdown-value');
const lobbyOverlay = root.querySelector<HTMLDivElement>('#lobby-overlay');
const lobbyTitle = root.querySelector<HTMLParagraphElement>('#lobby-title');
const lobbyCopy = root.querySelector<HTMLParagraphElement>('#lobby-copy');
const debugOverlay = root.querySelector<HTMLPreElement>('#debug-overlay');
const statusText = root.querySelector<HTMLParagraphElement>('#status-text');
const orientationOverlay = root.querySelector<HTMLDivElement>('#orientation-overlay');
const modeValue = root.querySelector<HTMLElement>('#mode-value');
const playerValue = root.querySelector<HTMLElement>('#player-value');
const roomValue = root.querySelector<HTMLElement>('#room-value');
const peersValue = root.querySelector<HTMLElement>('#peers-value');
const fpsValue = root.querySelector<HTMLElement>('#fps-value');
const pingValue = root.querySelector<HTMLElement>('#ping-value');
const networkPill = root.querySelector<HTMLDivElement>('#network-pill');
const networkValue = root.querySelector<HTMLElement>('#network-value');
const practiceButton = root.querySelector<HTMLButtonElement>('#practice-button');
const hostButton = root.querySelector<HTMLButtonElement>('#host-button');
const joinButton = root.querySelector<HTMLButtonElement>('#join-button');
const moveLeft = root.querySelector<HTMLButtonElement>('#move-left');
const moveRight = root.querySelector<HTMLButtonElement>('#move-right');
const resultModal = root.querySelector<HTMLDivElement>('#result-modal');
const resultWinner = root.querySelector<HTMLParagraphElement>('#result-winner');
const resultSummary = root.querySelector<HTMLParagraphElement>('#result-summary');
const resultClose = root.querySelector<HTMLButtonElement>('#result-close');
const sessionModal = root.querySelector<HTMLDivElement>('#session-modal');
const sessionModalBackdrop = root.querySelector<HTMLDivElement>('#session-modal-backdrop');
const sessionModalClose = root.querySelector<HTMLButtonElement>('#session-modal-close');
const sessionModalCancel = root.querySelector<HTMLButtonElement>('#session-modal-cancel');
const sessionModalSubmit = root.querySelector<HTMLButtonElement>('#session-modal-submit');
const sessionModalEyebrow = root.querySelector<HTMLElement>('#session-modal-eyebrow');
const sessionModalTitle = root.querySelector<HTMLElement>('#session-modal-title');
const sessionModalCopy = root.querySelector<HTMLElement>('#session-modal-copy');
const sessionModalFeedback = root.querySelector<HTMLParagraphElement>('#session-modal-feedback');
const sessionRoomIdInput = root.querySelector<HTMLInputElement>('#session-room-id');
const sessionRoomIdField = root.querySelector<HTMLDivElement>('#session-room-id-field');
const sessionMatchSizeField = root.querySelector<HTMLDivElement>('#session-match-size-field');
const sessionMatchSizeSelect = root.querySelector<HTMLSelectElement>('#session-match-size');
const sessionModalGrid = root.querySelector<HTMLDivElement>('.modal-grid');

if (
  !gameRoot ||
  !scoreboardLeft ||
  !scoreboardRight ||
  !matchClock ||
  !mobileMatchClock ||
  !goalToast ||
  !countdownOverlay ||
  !countdownValue ||
  !lobbyOverlay ||
  !lobbyTitle ||
  !lobbyCopy ||
  !debugOverlay ||
  !statusText ||
  !orientationOverlay ||
  !modeValue ||
  !playerValue ||
  !roomValue ||
  !peersValue ||
  !fpsValue ||
  !pingValue ||
  !networkPill ||
  !networkValue ||
  !practiceButton ||
  !hostButton ||
  !joinButton ||
  !moveLeft ||
  !moveRight ||
  !resultModal ||
  !resultWinner ||
  !resultSummary ||
  !resultClose ||
  !sessionModal ||
  !sessionModalBackdrop ||
  !sessionModalClose ||
  !sessionModalCancel ||
  !sessionModalSubmit ||
  !sessionModalEyebrow ||
  !sessionModalTitle ||
  !sessionModalCopy ||
  !sessionModalFeedback ||
  !sessionRoomIdInput ||
  !sessionRoomIdField ||
  !sessionMatchSizeField ||
  !sessionMatchSizeSelect ||
  !sessionModalGrid
) {
  throw new Error('Failed to build the game shell.');
}

const buildScoreCard = (playerId: 0 | 1 | 2 | 3): string => {
  const player = PLAYER_DEFINITIONS[playerId];
  return `
    <div class="score-card ${player.key}" data-player-key="${player.key}" data-player-id="${player.id}">
      <span class="crown" aria-hidden="true">♛</span>
      <span class="score-chip" aria-hidden="true"><span class="score-chip-dot"></span></span>
      <div class="score-copy">
        <span class="label">${player.label}</span>
        <span class="value" data-score="${player.key}">0</span>
      </div>
    </div>
  `;
};

scoreboardLeft.innerHTML = ([0, 2] as const).map((playerId) => buildScoreCard(playerId)).join('');
scoreboardRight.innerHTML = ([3, 1] as const).map((playerId) => buildScoreCard(playerId)).join('');

const scoreCards = PLAYER_DEFINITIONS.map((player) => {
  const card = root.querySelector<HTMLDivElement>(`[data-player-key="${player.key}"]`);
  const value = root.querySelector<HTMLElement>(`[data-score="${player.key}"]`);
  if (!card || !value) {
    throw new Error(`Missing scoreboard card for ${player.key}.`);
  }

  return {
    definition: player,
    card,
    value,
  };
});

const mobileScoreCards = PLAYER_DEFINITIONS.map((player) => {
  const card = root.querySelector<HTMLDivElement>(`[data-mobile-player-key="${player.key}"]`);
  const value = root.querySelector<HTMLElement>(`[data-mobile-score="${player.key}"]`);
  if (!card || !value) {
    throw new Error(`Missing mobile scoreboard card for ${player.key}.`);
  }

  return {
    definition: player,
    card,
    value,
  };
});

const scoreValues = {
  white: root.querySelector<HTMLElement>('[data-score="white"]'),
  blue: root.querySelector<HTMLElement>('[data-score="blue"]'),
  orange: root.querySelector<HTMLElement>('[data-score="orange"]'),
  green: root.querySelector<HTMLElement>('[data-score="green"]'),
};

const mobileScoreValues = {
  white: root.querySelector<HTMLElement>('[data-mobile-score="white"]'),
  blue: root.querySelector<HTMLElement>('[data-mobile-score="blue"]'),
  orange: root.querySelector<HTMLElement>('[data-mobile-score="orange"]'),
  green: root.querySelector<HTMLElement>('[data-mobile-score="green"]'),
};

let runtime: MatchRuntime | undefined;
let latestStatusMessage = 'Select Practice or Multiplayer to begin.';
let lastRoomId = DEFAULT_ROOM_ID;
let lastMatchSize: MatchSize = 4;
let sessionDialogMode: 'practice' | 'host' | 'join' | null = null;
let sessionDialogPending = false;
let countdownActive = false;
let countdownRunId = 0;
let countdownMode: 'practice' | 'multiplayer' | null = null;
let isLandscape = true;
let resultModalOpen = false;
let matchFinished = false;
let currentSessionInfo: SessionInfo | null = null;
let networkCountdownTimer = 0;
let networkCountdownStartAtMs: number | null = null;
let networkCountdownValue: string | null = null;

const updateMetricsHud = (session: SessionInfo, fps = 0): void => {
  const stats = runtime?.getNetworkStats() ?? {
    pingMs: 0,
    packetLoss: 0,
    tickDriftMs: 0,
    interpolationDelayMs: 0,
    connectedPeers: 0,
  };

  fpsValue.textContent = fps > 0 ? fps.toFixed(0) : '0';
  pingValue.textContent = `${stats.pingMs.toFixed(0)} ms`;
  peersValue.textContent = String(stats.connectedPeers);

  const networkState =
    session.mode === 'practice'
      ? 'LOCAL'
      : session.lobbyState === 'live'
        ? 'STABLE'
        : session.lobbyState === 'countdown'
          ? 'SYNCING'
          : 'WAITING';

  networkValue.textContent = networkState;
  networkPill.dataset.state =
    session.mode === 'practice'
      ? 'local'
      : session.lobbyState === 'live'
        ? 'live'
        : session.lobbyState === 'countdown'
          ? 'countdown'
          : 'waiting';
};

const syncRuntimePause = (): void => {
  runtime?.setPaused(!isLandscape || resultModalOpen || matchFinished || (countdownActive && countdownMode === 'practice'));
};

const resetMatchResultState = (): void => {
  resultModal.classList.remove('visible');
  resultModal.setAttribute('aria-hidden', 'true');
  resultModalOpen = false;
  matchFinished = false;
};

const setCountdownDisplay = (value: string): void => {
  countdownValue.textContent = value;
  countdownValue.classList.remove('animate');
  void countdownValue.offsetWidth;
  countdownValue.classList.add('animate');
};

const hideCountdownOverlay = (): void => {
  countdownOverlay.classList.remove('visible');
  countdownOverlay.setAttribute('aria-hidden', 'true');
};

const hideLobbyOverlay = (): void => {
  lobbyOverlay.classList.remove('visible');
  lobbyOverlay.setAttribute('aria-hidden', 'true');
};

const showLobbyOverlay = (title: string, copy: string): void => {
  lobbyTitle.textContent = title;
  lobbyCopy.textContent = copy;
  lobbyOverlay.classList.add('visible');
  lobbyOverlay.setAttribute('aria-hidden', 'false');
};

const stopNetworkCountdownVisual = (): void => {
  if (networkCountdownTimer) {
    window.clearInterval(networkCountdownTimer);
    networkCountdownTimer = 0;
  }

  networkCountdownStartAtMs = null;
  networkCountdownValue = null;
  if (countdownMode === 'multiplayer') {
    countdownActive = false;
    countdownMode = null;
    hideCountdownOverlay();
    syncRuntimePause();
  }
};

const cancelPracticeCountdown = (): void => {
  if (countdownMode !== 'practice') {
    return;
  }

  countdownRunId += 1;
  countdownActive = false;
  countdownMode = null;
  hideCountdownOverlay();
  syncRuntimePause();
};

const startNetworkCountdownVisual = (startAtMs: number): void => {
  if (networkCountdownStartAtMs === startAtMs && networkCountdownTimer) {
    return;
  }

  stopNetworkCountdownVisual();
  networkCountdownStartAtMs = startAtMs;
  countdownActive = true;
  countdownMode = 'multiplayer';
  countdownOverlay.classList.add('visible');
  countdownOverlay.setAttribute('aria-hidden', 'false');
  syncRuntimePause();

  const render = (): void => {
    if (networkCountdownStartAtMs === null) {
      return;
    }

    const remainingMs = networkCountdownStartAtMs - Date.now();
    const nextValue = remainingMs > 1300 ? '3' : remainingMs > 650 ? '2' : remainingMs > 0 ? '1' : '0';
    if (nextValue !== networkCountdownValue) {
      networkCountdownValue = nextValue;
      setCountdownDisplay(nextValue);
    }

    if (Date.now() >= networkCountdownStartAtMs + 320) {
      stopNetworkCountdownVisual();
    }
  };

  render();
  networkCountdownTimer = window.setInterval(render, 50);
};

const setStatus = (message: string): void => {
  latestStatusMessage = message;
  statusText.textContent = message;
  if (sessionDialogMode) {
    sessionModalFeedback.textContent = message;
    if (sessionDialogPending) {
      sessionModalFeedback.dataset.state = 'pending';
    } else if (sessionModalFeedback.dataset.state !== 'error' && sessionModalFeedback.dataset.state !== 'success') {
      sessionModalFeedback.dataset.state = 'neutral';
    }
  }
};

const updateSessionDialogSubmit = (): void => {
  sessionModalSubmit.textContent =
    sessionDialogMode === 'practice'
      ? 'Start Practice'
      : sessionDialogMode === 'host'
        ? 'Create Match'
        : sessionDialogMode === 'join'
          ? 'Join Match'
          : 'Continue';
};

const closeSessionDialog = (): void => {
  sessionDialogMode = null;
  sessionDialogPending = false;
  sessionModal.classList.remove('visible');
  sessionModal.setAttribute('aria-hidden', 'true');
  sessionModalFeedback.dataset.state = 'neutral';
  sessionModalFeedback.textContent = latestStatusMessage;
  sessionModalSubmit.disabled = false;
  sessionRoomIdInput.disabled = false;
  updateSessionDialogSubmit();
};

const openSessionDialog = (mode: 'practice' | 'host' | 'join'): void => {
  sessionDialogMode = mode;
  sessionDialogPending = false;
  sessionModal.classList.add('visible');
  sessionModal.setAttribute('aria-hidden', 'false');
  sessionModalGrid.hidden = false;
  sessionRoomIdInput.value = lastRoomId;
  sessionMatchSizeSelect.value = String(lastMatchSize);
  sessionMatchSizeField.hidden = mode === 'join';
  sessionMatchSizeSelect.disabled = mode === 'join';
  sessionRoomIdField.hidden = mode === 'practice';
  if (mode === 'practice') {
    sessionModalEyebrow.textContent = 'Practice Mode';
    sessionModalTitle.textContent = 'Start local practice';
    sessionModalCopy.textContent =
      'Are you sure you want to start Practice Mode? This will launch a local match with bots and begin play immediately.';
  } else if (mode === 'host') {
    sessionModalEyebrow.textContent = 'Create Multiplayer Match';
    sessionModalTitle.textContent = 'Open a host session';
    sessionModalCopy.textContent =
      `Enter a room code. QuadStrike will use the configured signaling server at ${FRONTEND_CONFIG.signalingUrl} and create the room if available.`;
  } else {
    sessionModalEyebrow.textContent = 'Join Multiplayer Match';
    sessionModalTitle.textContent = 'Connect to an existing room';
    sessionModalCopy.textContent =
      `Enter the same room code as the host. QuadStrike will detect the room size automatically and connect only if that room already exists on ${FRONTEND_CONFIG.signalingUrl}.`;
  }
  sessionModalFeedback.dataset.state = 'neutral';
  sessionModalFeedback.textContent =
    mode === 'practice' ? 'Ready to start local practice.' : `Ready to ${mode === 'host' ? 'create' : 'join'} a multiplayer match.`;
  sessionModalSubmit.disabled = false;
  sessionRoomIdInput.disabled = mode === 'practice';
  updateSessionDialogSubmit();
  if (mode === 'practice') {
    sessionModalSubmit.focus();
  } else {
    sessionRoomIdInput.focus();
    sessionRoomIdInput.select();
  }
};

const normalizeMatchSize = (value: string): MatchSize => (value === '2' ? 2 : 4);

const getConfiguredSignalUrl = (): string => {
  const trimmed = FRONTEND_CONFIG.signalingUrl.trim();
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error('Frontend signaling URL config is invalid. Update `src/config.ts` or `VITE_SIGNALING_URL`.');
  }

  if (parsed.protocol !== 'ws:' && parsed.protocol !== 'wss:') {
    throw new Error('Frontend signaling URL config must use ws:// or wss://.');
  }

  return parsed.toString();
};

const normalizeRoomId = (value: string): string => {
  const normalized = value.trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 8);
  if (!normalized) {
    throw new Error('Room ID cannot be empty.');
  }
  return normalized;
};

const syncLobbyPresentation = (session: SessionInfo): void => {
  if (matchFinished) {
    hideLobbyOverlay();
    stopNetworkCountdownVisual();
    return;
  }

  if (session.mode === 'practice') {
    if (session.lobbyState === 'waiting') {
      cancelPracticeCountdown();
    }
    hideLobbyOverlay();
    stopNetworkCountdownVisual();
    return;
  }

  const connectedCount = session.connectedPlayerIds.length;

  if (session.lobbyState === 'waiting') {
    stopNetworkCountdownVisual();
    showLobbyOverlay('Waiting For Players', `${connectedCount} / ${session.expectedPlayerCount} connected`);
    setStatus(`Waiting for players (${connectedCount}/${session.expectedPlayerCount}).`);
    return;
  }

  hideLobbyOverlay();

  if (session.lobbyState === 'countdown' && session.countdownStartAtMs !== null) {
    startNetworkCountdownVisual(session.countdownStartAtMs);
    setStatus('All players connected. Match countdown started.');
    return;
  }

  setStatus(session.isHost ? `Room ${session.roomId} is live.` : `Connected to room ${session.roomId}. Match live.`);
};

runtime = new MatchRuntime({
  onStatus: (message) => setStatus(message),
  onSession: (session) => {
    currentSessionInfo = session;
    const resultSnapshot = runtime?.getAuthoritativeSnapshot();
    if (resultSnapshot) {
      maybeShowMatchResult(resultSnapshot);
    }
    modeValue.textContent = session.mode.toUpperCase();
    playerValue.textContent = PLAYER_DEFINITIONS[session.localPlayerId].label;
    roomValue.textContent = session.roomId ?? 'LOCAL';
    lastMatchSize = session.matchSize;
    updateMetricsHud(session);
    syncLobbyPresentation(session);
    syncRuntimePause();
  },
  onSnapshot: () => {
    if (!runtime) {
      return;
    }
    const stats = runtime.getNetworkStats();
    peersValue.textContent = String(stats.connectedPeers);
    if (currentSessionInfo) {
      updateMetricsHud(currentSessionInfo);
    }
  },
});

if (!runtime) {
  throw new Error('Failed to initialize the match runtime.');
}

statusText.textContent = latestStatusMessage;
updateMetricsHud(runtime.getSessionInfo());

let lastGoalTotal = 0;
let goalToastTimer = 0;
let showDebug = false;
const inputState = {
  keyboardLeft: false,
  keyboardRight: false,
  touchLeft: false,
  touchRight: false,
};

const resolveAxis = (negative: boolean, positive: boolean): -1 | 0 | 1 => {
  if (negative === positive) {
    return 0;
  }
  return negative ? -1 : 1;
};

const applyMovementAxis = (): void => {
  const touchAxis = resolveAxis(inputState.touchLeft, inputState.touchRight);
  const keyboardAxis = resolveAxis(inputState.keyboardLeft, inputState.keyboardRight);
  runtime?.setMovementAxis(touchAxis !== 0 ? touchAxis : keyboardAxis);
};

const showToast = (message: string, color = '#ffffff'): void => {
  goalToast.textContent = message;
  goalToast.style.color = color;
  goalToast.classList.add('visible');
  window.clearTimeout(goalToastTimer);
  goalToastTimer = window.setTimeout(() => goalToast.classList.remove('visible'), 1400);
};

const formatMatchClock = (snapshot: GameSnapshot): string => {
  const elapsedMs = Math.min(MATCH_DURATION_MS, Math.round(snapshot.tick * (1000 / SIMULATION_HZ)));
  const remainingMs = Math.max(0, MATCH_DURATION_MS - elapsedMs);
  const totalSeconds = Math.ceil(remainingMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
};

function getWinnerSummary(snapshot: GameSnapshot): { winnerText: string; summaryText: string } {
  const activePlayers =
    currentSessionInfo?.mode === 'practice'
      ? getActivePlayerIds(currentSessionInfo.matchSize)
      : (currentSessionInfo?.connectedPlayerIds ?? [0]);
  const ranked = [...PLAYER_DEFINITIONS]
    .filter((player) => activePlayers.includes(player.id))
    .map((player) => ({
      player,
      conceded: snapshot.score[player.key],
    }))
    .sort((left, right) => {
      if (left.conceded !== right.conceded) {
        return left.conceded - right.conceded;
      }
      return left.player.id - right.player.id;
    });

  const best = ranked[0];
  const tied = ranked.filter((entry) => entry.conceded === best.conceded);
  if (tied.length > 1) {
    return {
      winnerText: 'DRAW',
      summaryText: `${tied.map((entry) => entry.player.label).join(', ')} conceded the fewest goals with ${best.conceded}.`,
    };
  }

  return {
    winnerText: `${best.player.label} WINS`,
    summaryText: `Conceded the fewest goals with ${best.conceded}.`,
  };
}

function maybeShowMatchResult(resultSnapshot: GameSnapshot): void {
  const elapsedMs = Math.min(MATCH_DURATION_MS, Math.round(resultSnapshot.tick * (1000 / SIMULATION_HZ)));
  if (elapsedMs < MATCH_DURATION_MS || matchFinished) {
    return;
  }

  matchFinished = true;
  const result = getWinnerSummary(resultSnapshot);
  resultWinner!.textContent = result.winnerText;
  resultSummary!.textContent = result.summaryText;
  resultModal!.classList.add('visible');
  resultModal!.setAttribute('aria-hidden', 'false');
  resultModalOpen = true;
  syncRuntimePause();
}

const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });

const runStartCountdown = async (): Promise<void> => {
  stopNetworkCountdownVisual();
  resultModal.classList.remove('visible');
  resultModal.setAttribute('aria-hidden', 'true');
  resultModalOpen = false;
  matchFinished = false;
  countdownRunId += 1;
  const currentRun = countdownRunId;
  countdownActive = true;
  countdownMode = 'practice';
  syncRuntimePause();
  countdownOverlay.classList.add('visible');
  countdownOverlay.setAttribute('aria-hidden', 'false');

  for (const value of ['3', '2', '1']) {
    if (currentRun !== countdownRunId) {
      return;
    }
    setCountdownDisplay(value);
    await delay(650);
  }

  if (currentRun !== countdownRunId) {
    return;
  }

  setCountdownDisplay('0');
  countdownActive = false;
  countdownMode = null;
  syncRuntimePause();
  await delay(320);

  if (currentRun !== countdownRunId) {
    return;
  }

  hideCountdownOverlay();
};

const setScoreboard = (snapshot: GameSnapshot): void => {
  const formattedClock = formatMatchClock(snapshot);
  matchClock.textContent = formattedClock;
  mobileMatchClock.textContent = formattedClock;
  maybeShowMatchResult(runtime?.getAuthoritativeSnapshot() ?? snapshot);
  scoreValues.white!.textContent = String(snapshot.score.white);
  scoreValues.blue!.textContent = String(snapshot.score.blue);
  scoreValues.orange!.textContent = String(snapshot.score.orange);
  scoreValues.green!.textContent = String(snapshot.score.green);
  mobileScoreValues.white!.textContent = String(snapshot.score.white);
  mobileScoreValues.blue!.textContent = String(snapshot.score.blue);
  mobileScoreValues.orange!.textContent = String(snapshot.score.orange);
  mobileScoreValues.green!.textContent = String(snapshot.score.green);

  const rankedCards = [...scoreCards].sort((left, right) => {
    const leftScore = snapshot.score[left.definition.key];
    const rightScore = snapshot.score[right.definition.key];
    if (leftScore !== rightScore) {
      return leftScore - rightScore;
    }
    return left.definition.id - right.definition.id;
  });
  const visiblePlayers =
    currentSessionInfo?.mode === 'practice'
      ? getActivePlayerIds(currentSessionInfo.matchSize)
      : (currentSessionInfo?.connectedPlayerIds ?? [0]);
  const activeRankedCards = rankedCards.filter((entry) => visiblePlayers.includes(entry.definition.id));
  const leaderScore =
    activeRankedCards.length > 0 ? snapshot.score[activeRankedCards[0].definition.key] : Number.POSITIVE_INFINITY;

  const applyScoreCardState = (cards: typeof scoreCards): void => {
    cards.forEach((entry) => {
      const visible = visiblePlayers.includes(entry.definition.id);
      entry.card.hidden = !visible;
      if (!visible) {
        entry.card.classList.remove('leader');
        entry.card.dataset.rank = '';
        return;
      }

      const rank = activeRankedCards.findIndex((candidate) => candidate.definition.id === entry.definition.id);
      entry.card.dataset.rank = String(rank + 1);
      entry.card.classList.toggle('leader', snapshot.score[entry.definition.key] === leaderScore);
    });
  };

  applyScoreCardState(scoreCards);
  applyScoreCardState(mobileScoreCards);

  const totalScore = snapshot.score.white + snapshot.score.blue + snapshot.score.orange + snapshot.score.green;
  if (totalScore !== lastGoalTotal) {
    lastGoalTotal = totalScore;
    const scorer = snapshot.scorerId !== null ? PLAYER_DEFINITIONS[snapshot.scorerId] : null;
    showToast(scorer ? `${scorer.label} SCORED` : 'GOAL', scorer?.color ?? '#ffffff');
  }
};

const scene = new ArenaScene(runtime, ({ snapshot, session, fps }) => {
  setScoreboard(snapshot);
  modeValue.textContent = session.mode.toUpperCase();
  playerValue.textContent = PLAYER_DEFINITIONS[session.localPlayerId].label;
  roomValue.textContent = session.roomId ?? 'LOCAL';

  const stats = runtime.getNetworkStats();
  peersValue.textContent = String(stats.connectedPeers);
  updateMetricsHud(session, fps);

  debugOverlay.textContent = [
    `FPS: ${fps.toFixed(0)}`,
    `Ping: ${stats.pingMs.toFixed(0)} ms`,
    `Packet Loss: ${stats.packetLoss.toFixed(1)}%`,
    `Tick Drift: ${stats.tickDriftMs.toFixed(1)} ms`,
    `Interp Delay: ${stats.interpolationDelayMs.toFixed(0)} ms`,
  ].join('\n');
});

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: gameRoot,
  width: gameRoot.clientWidth,
  height: gameRoot.clientHeight,
  transparent: true,
  scene: [scene],
  scale: {
    mode: Phaser.Scale.RESIZE,
    width: gameRoot.clientWidth,
    height: gameRoot.clientHeight,
  },
  render: {
    antialias: true,
    powerPreference: 'high-performance',
  },
});

new ResizeObserver(() => {
  game.scale.resize(gameRoot.clientWidth, gameRoot.clientHeight);
}).observe(gameRoot);

const preventTouchDefaults = (element: HTMLElement): void => {
  ['pointerdown', 'pointermove'].forEach((type) => {
    element.addEventListener(type, (event) => {
      event.preventDefault();
    });
  });
};

preventTouchDefaults(moveLeft);
preventTouchDefaults(moveRight);

const bindTouchAxis = (button: HTMLElement, axis: -1 | 1): void => {
  const activate = (): void => {
    if (axis === -1) {
      inputState.touchLeft = true;
    } else {
      inputState.touchRight = true;
    }
    applyMovementAxis();
  };

  const release = (): void => {
    if (axis === -1) {
      inputState.touchLeft = false;
    } else {
      inputState.touchRight = false;
    }
    applyMovementAxis();
  };

  button.addEventListener('pointerdown', activate);
  button.addEventListener('pointerup', release);
  button.addEventListener('pointercancel', release);
  button.addEventListener('pointerleave', release);
};

bindTouchAxis(moveLeft, -1);
bindTouchAxis(moveRight, 1);

window.addEventListener('keydown', (event) => {
  switch (event.code) {
    case 'ArrowLeft':
    case 'KeyA':
      inputState.keyboardLeft = true;
      applyMovementAxis();
      break;
    case 'ArrowRight':
    case 'KeyD':
      inputState.keyboardRight = true;
      applyMovementAxis();
      break;
    case 'F1':
      event.preventDefault();
      showDebug = !showDebug;
      debugOverlay.classList.toggle('visible', showDebug);
      break;
    case 'F2':
      event.preventDefault();
      scene.togglePhysicsDebug();
      break;
    case 'F3':
      event.preventDefault();
      scene.toggleBoundsDebug();
      break;
    default:
      break;
  }
});

window.addEventListener('keyup', (event) => {
  switch (event.code) {
    case 'ArrowLeft':
    case 'KeyA':
      inputState.keyboardLeft = false;
      applyMovementAxis();
      break;
    case 'ArrowRight':
    case 'KeyD':
      inputState.keyboardRight = false;
      applyMovementAxis();
      break;
    default:
      break;
  }
});

practiceButton.addEventListener('click', () => openSessionDialog('practice'));

hostButton.addEventListener('click', () => openSessionDialog('host'));

joinButton.addEventListener('click', () => openSessionDialog('join'));

const submitSessionDialog = async (): Promise<void> => {
  if (!runtime || !sessionDialogMode || sessionDialogPending) {
    return;
  }

  try {
    sessionDialogPending = true;
    sessionModalFeedback.dataset.state = 'pending';
    if (sessionDialogMode === 'practice') {
      sessionModalFeedback.textContent = 'Starting local practice session...';
    } else {
      const signalUrl = getConfiguredSignalUrl();
      const roomId = normalizeRoomId(sessionRoomIdInput.value);
      lastRoomId = roomId;
      sessionModalFeedback.textContent =
        sessionDialogMode === 'host'
          ? `Checking signaling server and creating room ${roomId}...`
          : `Checking signaling server and joining room ${roomId}...`;
    }
    sessionModalSubmit.disabled = true;
    sessionRoomIdInput.disabled = true;

    if (sessionDialogMode === 'practice') {
      const matchSize = normalizeMatchSize(sessionMatchSizeSelect.value);
      lastMatchSize = matchSize;
      resetMatchResultState();
      runtime.startPractice(matchSize);
      sessionModalFeedback.dataset.state = 'success';
      sessionModalFeedback.textContent = 'Practice is live.';
      showToast('PRACTICE LIVE', '#dcedc8');
      closeSessionDialog();
      void runStartCountdown();
      return;
    } else if (sessionDialogMode === 'host') {
      const signalUrl = getConfiguredSignalUrl();
      const roomId = normalizeRoomId(sessionRoomIdInput.value);
      const matchSize = normalizeMatchSize(sessionMatchSizeSelect.value);
      lastMatchSize = matchSize;
      await runtime.startHost(signalUrl, roomId, matchSize);
      resetMatchResultState();
      syncRuntimePause();
      sessionModalFeedback.dataset.state = 'success';
      sessionModalFeedback.textContent = `Connected. Room ${roomId} is ready. Waiting for players.`;
      closeSessionDialog();
      return;
    } else {
      const signalUrl = getConfiguredSignalUrl();
      const roomId = normalizeRoomId(sessionRoomIdInput.value);
      await runtime.startClient(signalUrl, roomId);
      resetMatchResultState();
      syncRuntimePause();
      sessionModalFeedback.dataset.state = 'success';
      sessionModalFeedback.textContent = `Connected. Joined room ${roomId}. Waiting for the room to fill.`;
      closeSessionDialog();
      return;
    }
  } catch (error) {
    sessionDialogPending = false;
    sessionModalFeedback.dataset.state = 'error';
    sessionModalFeedback.textContent = error instanceof Error ? error.message : 'Connection failed.';
    sessionModalSubmit.disabled = false;
    sessionRoomIdInput.disabled = false;
    latestStatusMessage = sessionModalFeedback.textContent;
    statusText.textContent = sessionModalFeedback.textContent;
    return;
  }

  sessionDialogPending = true;
};

sessionModalSubmit.addEventListener('click', () => {
  void submitSessionDialog();
});

sessionModalCancel.addEventListener('click', closeSessionDialog);
sessionModalClose.addEventListener('click', closeSessionDialog);
sessionModalBackdrop.addEventListener('click', closeSessionDialog);
resultClose.addEventListener('click', () => {
  resultModal.classList.remove('visible');
  resultModal.setAttribute('aria-hidden', 'true');
  resultModalOpen = false;
  syncRuntimePause();
});

sessionRoomIdInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    void submitSessionDialog();
  }
});

observeLandscape((landscape) => {
  isLandscape = landscape;
  orientationOverlay.classList.toggle('visible', !landscape);
  syncRuntimePause();
});

window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && sessionDialogMode && !sessionDialogPending) {
    closeSessionDialog();
  }
});

void registerServiceWorker();
