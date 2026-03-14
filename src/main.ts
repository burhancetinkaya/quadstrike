import Phaser from 'phaser';

import './styles.css';

import { FRONTEND_CONFIG } from './config';
import { PLAYER_DEFINITIONS } from './game/constants';
import { ArenaScene } from './game/scene';
import { MatchRuntime } from './game/runtime';
import { observeLandscape } from './platform/orientation';
import { registerServiceWorker } from './platform/pwa';
import type { GameSnapshot } from './game/types';

const root = document.querySelector<HTMLDivElement>('#app');
if (!root) {
  throw new Error('Missing #app root container.');
}

const DEFAULT_ROOM_ID = 'ARENA';

root.innerHTML = `
  <div class="shell">
    <header class="topbar">
      <div class="brand">
        <h1>QuadStrike</h1>
        <p>Host-authoritative WebRTC prototype with deterministic fixed-step physics.</p>
      </div>
      <div class="topbar-status">
        <span>Mode <strong id="mode-value">Practice</strong></span>
        <span>Player <strong id="player-value">White</strong></span>
        <span>Room <strong id="room-value">LOCAL</strong></span>
        <span>Connected <strong id="peers-value">0</strong></span>
      </div>
    </header>

    <main class="layout">
      <section class="arena-card">
        <div class="game-frame">
          <div id="game-root"></div>
          <div class="hud-layer">
            <div class="scoreboard" id="scoreboard"></div>
            <div class="goal-toast" id="goal-toast">Goal</div>
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
              <button class="boost-button" id="boost-button">Boost</button>
            </div>
          </div>
        </div>
      </section>

      <aside class="control-card">
        <h2 class="card-title">Session Control</h2>
        <p class="session-intro">
          Use Practice Mode for a local bot match, Create Multiplayer Match to host a room, and Join Multiplayer Match to connect to an existing one.
        </p>
        <div class="button-row">
          <button id="practice-button">Practice Mode</button>
          <button id="host-button" class="secondary">Create Multiplayer Match</button>
          <button id="join-button" class="secondary">Join Multiplayer Match</button>
          <button id="leave-button" class="ghost">Leave Room</button>
        </div>

        <p class="footer-status" id="status-text"></p>
      </aside>
    </main>

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
          <div class="field">
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
const scoreboard = root.querySelector<HTMLDivElement>('#scoreboard');
const goalToast = root.querySelector<HTMLDivElement>('#goal-toast');
const debugOverlay = root.querySelector<HTMLPreElement>('#debug-overlay');
const statusText = root.querySelector<HTMLParagraphElement>('#status-text');
const orientationOverlay = root.querySelector<HTMLDivElement>('#orientation-overlay');
const modeValue = root.querySelector<HTMLElement>('#mode-value');
const playerValue = root.querySelector<HTMLElement>('#player-value');
const roomValue = root.querySelector<HTMLElement>('#room-value');
const peersValue = root.querySelector<HTMLElement>('#peers-value');
const practiceButton = root.querySelector<HTMLButtonElement>('#practice-button');
const hostButton = root.querySelector<HTMLButtonElement>('#host-button');
const joinButton = root.querySelector<HTMLButtonElement>('#join-button');
const leaveButton = root.querySelector<HTMLButtonElement>('#leave-button');
const moveLeft = root.querySelector<HTMLButtonElement>('#move-left');
const moveRight = root.querySelector<HTMLButtonElement>('#move-right');
const boostButton = root.querySelector<HTMLButtonElement>('#boost-button');
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
const sessionModalGrid = root.querySelector<HTMLDivElement>('.modal-grid');

if (
  !gameRoot ||
  !scoreboard ||
  !goalToast ||
  !debugOverlay ||
  !statusText ||
  !orientationOverlay ||
  !modeValue ||
  !playerValue ||
  !roomValue ||
  !peersValue ||
  !practiceButton ||
  !hostButton ||
  !joinButton ||
  !leaveButton ||
  !moveLeft ||
  !moveRight ||
  !boostButton ||
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
  !sessionModalGrid
) {
  throw new Error('Failed to build the game shell.');
}

scoreboard.innerHTML = PLAYER_DEFINITIONS.map(
  (player) => `
    <div class="score-card ${player.key}">
      <span class="label">${player.label}</span>
      <span class="value" data-score="${player.key}">0</span>
    </div>
  `,
).join('');

const scoreValues = {
  white: scoreboard.querySelector<HTMLElement>('[data-score="white"]'),
  blue: scoreboard.querySelector<HTMLElement>('[data-score="blue"]'),
  orange: scoreboard.querySelector<HTMLElement>('[data-score="orange"]'),
  green: scoreboard.querySelector<HTMLElement>('[data-score="green"]'),
};

let runtime: MatchRuntime | undefined;
let latestStatusMessage = 'Practice mode is live. Use A/D or Left/Right to move and Space to boost.';
let lastRoomId = DEFAULT_ROOM_ID;
let sessionDialogMode: 'practice' | 'host' | 'join' | null = null;
let sessionDialogPending = false;

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
  sessionModalGrid.hidden = mode === 'practice';
  sessionRoomIdInput.value = lastRoomId;
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
      `Enter the same room code as the host. QuadStrike will use the configured signaling server at ${FRONTEND_CONFIG.signalingUrl} and try to attach to the live session.`;
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

runtime = new MatchRuntime({
  onStatus: (message) => setStatus(message),
  onSession: (session) => {
    modeValue.textContent = session.mode.toUpperCase();
    playerValue.textContent = PLAYER_DEFINITIONS[session.localPlayerId].label;
    roomValue.textContent = session.roomId ?? 'LOCAL';
  },
  onSnapshot: () => {
    if (!runtime) {
      return;
    }
    const stats = runtime.getNetworkStats();
    peersValue.textContent = String(stats.connectedPeers);
  },
});

if (!runtime) {
  throw new Error('Failed to initialize the match runtime.');
}

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

const setScoreboard = (snapshot: GameSnapshot): void => {
  scoreValues.white!.textContent = String(snapshot.score.white);
  scoreValues.blue!.textContent = String(snapshot.score.blue);
  scoreValues.orange!.textContent = String(snapshot.score.orange);
  scoreValues.green!.textContent = String(snapshot.score.green);

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
preventTouchDefaults(boostButton);

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
boostButton.addEventListener('pointerdown', () => runtime?.queueBoost());

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
    case 'Space':
      event.preventDefault();
      runtime?.queueBoost();
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
      runtime.startPractice();
      sessionModalFeedback.dataset.state = 'success';
      sessionModalFeedback.textContent = 'Practice is live.';
      showToast('PRACTICE LIVE', '#dcedc8');
    } else if (sessionDialogMode === 'host') {
      const signalUrl = getConfiguredSignalUrl();
      const roomId = normalizeRoomId(sessionRoomIdInput.value);
      await runtime.startHost(signalUrl, roomId);
      sessionModalFeedback.dataset.state = 'success';
      sessionModalFeedback.textContent = `Connected. Room ${roomId} is ready to share.`;
    } else {
      const signalUrl = getConfiguredSignalUrl();
      const roomId = normalizeRoomId(sessionRoomIdInput.value);
      await runtime.startClient(signalUrl, roomId);
      sessionModalFeedback.dataset.state = 'success';
      sessionModalFeedback.textContent = `Connected. Joined room ${roomId}.`;
    }

    window.setTimeout(() => {
      if (!sessionDialogPending) {
        return;
      }
      closeSessionDialog();
    }, 700);
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

sessionRoomIdInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    void submitSessionDialog();
  }
});

leaveButton.addEventListener('click', () => {
  closeSessionDialog();
  runtime?.leaveSession();
});

observeLandscape((landscape) => {
  orientationOverlay.classList.toggle('visible', !landscape);
  runtime?.setPaused(!landscape);
});

window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && sessionDialogMode && !sessionDialogPending) {
    closeSessionDialog();
  }
});

void registerServiceWorker();
