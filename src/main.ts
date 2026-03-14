import Phaser from 'phaser';

import './styles.css';

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

root.innerHTML = `
  <div class="shell">
    <header class="topbar">
      <div class="brand">
        <h1>QuadStrike</h1>
        <p>Host-authoritative WebRTC prototype with deterministic fixed-step physics.</p>
      </div>
      <div class="status-pill">
        <span>Build</span>
        <strong>PWA / Phaser 3 / Matter.js</strong>
      </div>
    </header>

    <main class="layout">
      <section class="arena-card">
        <div class="game-frame">
          <div id="game-root"></div>
          <div class="hud-layer">
            <div class="scoreboard" id="scoreboard"></div>
            <div class="metrics">
              <div class="metric"><span>Mode</span><strong id="mode-value">Practice</strong></div>
              <div class="metric"><span>Player</span><strong id="player-value">White</strong></div>
              <div class="metric"><span>Room</span><strong id="room-value">LOCAL</strong></div>
              <div class="metric"><span>Peers</span><strong id="peers-value">0</strong></div>
            </div>
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
        <div class="control-grid">
          <div class="field">
            <label for="signal-url">Signaling URL</label>
            <input id="signal-url" value="ws://localhost:8080" />
          </div>
          <div class="field">
            <label for="room-id">Room ID</label>
            <input id="room-id" value="ARENA" maxlength="8" />
          </div>
          <div class="button-row">
            <button id="practice-button">Practice</button>
            <button id="host-button" class="secondary">Host Room</button>
            <button id="join-button" class="secondary">Join Room</button>
            <button id="leave-button" class="ghost">Leave Room</button>
          </div>
        </div>

        <section class="session-summary">
          <div class="session-row"><span>Transport</span><strong>WebRTC DataChannel</strong></div>
          <div class="session-row"><span>State Packets</span><strong>48 bytes</strong></div>
          <div class="session-row"><span>Input Packets</span><strong>8 bytes</strong></div>
          <div class="session-row"><span>Tick Rate</span><strong>60 Hz</strong></div>
          <div class="session-row"><span>Net Send</span><strong>20 Hz</strong></div>
        </section>

        <section class="notes">
          <h3>Controls</h3>
          <p><strong>Move:</strong> <code>A / D</code> or <code>Left / Right</code></p>
          <p><strong>Boost:</strong> <code>Space</code> or the mobile button</p>
          <p><strong>Debug:</strong> <code>F1</code> stats, <code>F2</code> physics, <code>F3</code> bounds</p>
        </section>

        <p class="footer-status" id="status-text"></p>
      </aside>
    </main>
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
const signalUrlInput = root.querySelector<HTMLInputElement>('#signal-url');
const roomIdInput = root.querySelector<HTMLInputElement>('#room-id');
const practiceButton = root.querySelector<HTMLButtonElement>('#practice-button');
const hostButton = root.querySelector<HTMLButtonElement>('#host-button');
const joinButton = root.querySelector<HTMLButtonElement>('#join-button');
const leaveButton = root.querySelector<HTMLButtonElement>('#leave-button');
const moveLeft = root.querySelector<HTMLButtonElement>('#move-left');
const moveRight = root.querySelector<HTMLButtonElement>('#move-right');
const boostButton = root.querySelector<HTMLButtonElement>('#boost-button');

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
  !signalUrlInput ||
  !roomIdInput ||
  !practiceButton ||
  !hostButton ||
  !joinButton ||
  !leaveButton ||
  !moveLeft ||
  !moveRight ||
  !boostButton
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

runtime = new MatchRuntime({
  onStatus: (message) => {
    statusText.textContent = message;
  },
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
  keyboard: 0 as -1 | 0 | 1,
  touch: 0 as -1 | 0 | 1,
};

const applyMovementAxis = (): void => {
  runtime?.setMovementAxis((inputState.touch !== 0 ? inputState.touch : inputState.keyboard) as -1 | 0 | 1);
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
    goalToast.textContent = scorer ? `${scorer.label} SCORED` : 'GOAL';
    goalToast.style.color = scorer?.color ?? '#ffffff';
    goalToast.classList.add('visible');
    window.clearTimeout(goalToastTimer);
    goalToastTimer = window.setTimeout(() => goalToast.classList.remove('visible'), 1400);
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
    inputState.touch = axis;
    applyMovementAxis();
  };

  const release = (): void => {
    inputState.touch = 0;
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
      inputState.keyboard = -1;
      applyMovementAxis();
      break;
    case 'ArrowRight':
    case 'KeyD':
      inputState.keyboard = 1;
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
  if (
    event.code === 'ArrowLeft' ||
    event.code === 'KeyA' ||
    event.code === 'ArrowRight' ||
    event.code === 'KeyD'
  ) {
    inputState.keyboard = 0;
    applyMovementAxis();
  }
});

practiceButton.addEventListener('click', () => {
  runtime?.startPractice();
});

hostButton.addEventListener('click', async () => {
  try {
    await runtime?.startHost(signalUrlInput.value.trim(), roomIdInput.value.trim().toUpperCase() || 'ARENA');
  } catch (error) {
    statusText.textContent = error instanceof Error ? error.message : 'Failed to host the room.';
  }
});

joinButton.addEventListener('click', async () => {
  try {
    await runtime?.startClient(signalUrlInput.value.trim(), roomIdInput.value.trim().toUpperCase() || 'ARENA');
  } catch (error) {
    statusText.textContent = error instanceof Error ? error.message : 'Failed to join the room.';
  }
});

leaveButton.addEventListener('click', () => {
  runtime?.leaveSession();
});

observeLandscape((landscape) => {
  orientationOverlay.classList.toggle('visible', !landscape);
  runtime?.setPaused(!landscape);
});

void registerServiceWorker();
