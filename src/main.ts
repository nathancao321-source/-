import './style.css';
import type { LevelDirectoryEntry, RenderFrame } from './shared/contracts';
import { createGame } from './game';
import { createKeyboardInput } from './input';
import { createRenderer } from './render';
import { levelById, levels } from './levels';

function boot(): void {
  const canvas = document.getElementById('game');
  const errorBox = document.getElementById('boot-error');
  if (!(canvas instanceof HTMLCanvasElement)) {
    throw new Error('Canvas element #game is missing');
  }

  try {
    canvas.tabIndex = 0;
    canvas.addEventListener('pointerdown', () => {
      canvas.focus();
      window.focus();
    });

    // Developer / demo shortcut: ?level=solar-exodus starts at that chapter.
    const requested = new URLSearchParams(window.location.search).get('level');
    const startLevel = (requested ? levelById.get(requested) : undefined) ?? levels[0]!;
    const runtime = createGame(startLevel, levels);
    const input = createKeyboardInput(window);
    const renderer = createRenderer(canvas);

    let accumulator = 0;
    let lastFrameTime = performance.now();
    let lastVisualTime = 0;
    let pausedForBlur = false;

    let menuOpen = false;
    let menuIndex = 0;
    let menuPaused = false;

    const levelLabels = ['0A', '0B', '01', '02'];
    const levelDirectory: LevelDirectoryEntry[] = levels.map((level, index) => ({
      id: level.id,
      label: levelLabels[index] ?? String(index).padStart(2, '0'),
      title: level.title,
      chapter: level.narrative.chapter,
      sector: level.narrative.sector,
      objective: level.mission?.objective ?? '护送方舟',
    }));

    const resetClock = () => {
      accumulator = 0;
      lastFrameTime = performance.now();
    };

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      renderer.resize(
        Math.max(1, canvas.clientWidth),
        Math.max(1, canvas.clientHeight),
        dpr,
      );
    };

    resize();
    window.addEventListener('resize', resize);
    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(resize);
      observer.observe(canvas);
    }

    const campaignInfo = () => {
      const snapshot = runtime.snapshot();
      const index = levels.findIndex((level) => level.id === snapshot.levelId);
      const safeIndex = index >= 0 ? index : 0;
      return {
        index: safeIndex,
        total: levels.length,
        hasNext: safeIndex < levels.length - 1,
      };
    };

    const openMenu = (open: boolean) => {
      if (menuOpen === open) return;
      menuOpen = open;
      input.clear();
      resetClock();

      if (open) {
        const snapshot = runtime.snapshot();
        const index = levels.findIndex((level) => level.id === snapshot.levelId);
        menuIndex = index >= 0 ? index : 0;
        menuPaused = snapshot.phase === 'running';
        if (menuPaused) runtime.command({ type: 'toggle-pause' });
      } else {
        if (menuPaused && runtime.snapshot().phase === 'paused') {
          runtime.command({ type: 'toggle-pause' });
        }
        menuPaused = false;
      }
    };

    const selectDirectoryLevel = () => {
      const entry = levelDirectory[menuIndex];
      if (!entry) return;
      runtime.command({ type: 'load-level', levelId: entry.id });
      input.clear();
      menuOpen = false;
      menuPaused = false;
      resetClock();
    };

    const advance = () => {
      const snapshot = runtime.snapshot();
      const index = levels.findIndex((level) => level.id === snapshot.levelId);
      const next =
        index >= 0 && index < levels.length - 1 ? levels[index + 1]! : levels[0]!;
      runtime.command({ type: 'load-level', levelId: next.id });
      input.resetFields();
      resetClock();
    };

    const onHidden = () => {
      input.clear();
      if (runtime.snapshot().phase === 'running') {
        runtime.command({ type: 'toggle-pause' });
      }
    };

    // Level directory is host UI: capture the keys before the game adapter so
    // menu navigation cannot move nodes, toggle fields or start the level.
    const onMenuKey = (event: KeyboardEvent) => {
      if (event.code === 'KeyM' || event.code === 'Escape') {
        if (event.repeat) return;
        event.preventDefault();
        event.stopPropagation();
        openMenu(!menuOpen);
        return;
      }
      if (!menuOpen) return;
      event.preventDefault();
      event.stopPropagation();

      if (event.code === 'ArrowUp' || event.code === 'KeyW') {
        menuIndex = (menuIndex - 1 + levelDirectory.length) % levelDirectory.length;
      } else if (event.code === 'ArrowDown' || event.code === 'KeyS') {
        menuIndex = (menuIndex + 1) % levelDirectory.length;
      } else if (event.code === 'Enter' || event.code === 'Space') {
        selectDirectoryLevel();
      }
    };
    window.addEventListener('keydown', onMenuKey, { capture: true });

    window.addEventListener('blur', () => {
      pausedForBlur = true;
      onHidden();
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) onHidden();
    });
    window.addEventListener('focus', () => {
      // Returning to the page never resumes automatically: the player must
      // press Space. This avoids hidden-tab catch-up and sticky keys.
      if (pausedForBlur) pausedForBlur = false;
    });

    const frame = (now: number) => {
      const wallDelta = Math.min(0.1, Math.max(0, (now - lastFrameTime) / 1000));
      lastFrameTime = now;
      lastVisualTime = now / 1000;

      const before = runtime.snapshot();
      if (menuOpen) {
        input.drainCommands(); // the directory owns input while it is open
      } else {
        for (const command of input.drainCommands()) {
          if (before.phase === 'won' && command.type === 'toggle-pause') {
            advance();
            continue;
          }
          if (before.phase === 'lost' && command.type === 'toggle-pause') {
            continue;
          }
          runtime.command(command);
          if (command.type === 'restart' || command.type === 'load-level') {
            input.resetFields();
          }
        }
      }

      let snapshot = runtime.snapshot();
      if (snapshot.phase !== before.phase) {
        accumulator = 0;
        lastFrameTime = now;
      }

      const level = levelById.get(snapshot.levelId) ?? levels[0]!;
      const fixedDt = level.physics.fixedDt;

      if (!menuOpen && (snapshot.phase === 'ready' || snapshot.phase === 'running')) {
        accumulator += wallDelta;
        let steps = 0;
        const maxSteps = level.physics.maxCatchUpSteps;
        while (accumulator >= fixedDt && steps < maxSteps) {
          runtime.step(input.sample());
          accumulator -= fixedDt;
          steps += 1;
          const current = runtime.snapshot();
          if (current.phase === 'won' || current.phase === 'lost') {
            accumulator = 0;
            break;
          }
        }
        if (steps >= maxSteps) accumulator = 0; // drop backlog instead of teleporting
      } else {
        accumulator = 0;
      }

      snapshot = runtime.snapshot();
      const events = runtime.drainEvents();
      const alpha =
        snapshot.phase === 'running'
          ? Math.max(0, Math.min(1, accumulator / fixedDt))
          : 1;

      const renderFrameData: RenderFrame = {
        snapshot,
        events,
        interpolationAlpha: alpha,
        visualTimeSeconds: lastVisualTime,
        narrative: level.narrative,
        level,
        campaign: campaignInfo(),
        menu: {
          open: menuOpen,
          index: menuIndex,
          levels: levelDirectory,
        },
      };
      renderer.render(renderFrameData);
      requestAnimationFrame(frame);
    };

    requestAnimationFrame(frame);

    window.addEventListener('beforeunload', () => {
      window.removeEventListener('keydown', onMenuKey, { capture: true });
      input.dispose();
      renderer.dispose();
    });
  } catch (error) {
    if (errorBox instanceof HTMLElement) {
      errorBox.hidden = false;
      errorBox.textContent =
        error instanceof Error ? `无法启动游戏：${error.message}` : '无法启动游戏。';
    }
    throw error;
  }
}

boot();
