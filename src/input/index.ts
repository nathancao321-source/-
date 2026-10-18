import type { GameCommand, InputAdapter, InputFrame } from '../shared/contracts';

const PREVENT_DEFAULT = new Set([
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Space',
  'Enter',
]);

export interface KeyboardInput extends InputAdapter {
  /** Clear both field switches. Used on restart / level load so a held-over
   * toggle cannot silently change the next run. */
  resetFields(): void;
}

/**
 * Keyboard adapter.
 *
 * Movement is held state. Fields are toggles: press F / Enter once to turn the
 * field on, press again to turn it off. Space/R remain one-shot edge commands.
 * KeyboardEvent.code keeps the layout stable across keyboards.
 */
export function createKeyboardInput(target: Window): KeyboardInput {
  const doc = target.document;
  const held = new Set<string>();
  let commands: GameCommand[] = [];
  let p1Field = false;
  let p2Field = false;
  let disposed = false;

  const resetFields = () => {
    p1Field = false;
    p2Field = false;
  };

  const onKeyDown = (event: KeyboardEvent) => {
    const code = event.code;
    if (PREVENT_DEFAULT.has(code)) event.preventDefault();

    if (!event.repeat && !held.has(code)) {
      if (code === 'Space') commands.push({ type: 'toggle-pause' });
      else if (code === 'KeyR') commands.push({ type: 'restart' });
      else if (code === 'KeyF') p1Field = !p1Field;
      else if (code === 'Enter') p2Field = !p2Field;
    }
    held.add(code);
  };

  const onKeyUp = (event: KeyboardEvent) => {
    held.delete(event.code);
  };

  const clear = () => {
    held.clear();
    commands = [];
    resetFields();
  };

  const onBlur = () => clear();
  const onVisibility = () => {
    if (doc.hidden) clear();
  };

  target.addEventListener('keydown', onKeyDown, { passive: false });
  target.addEventListener('keyup', onKeyUp);
  target.addEventListener('blur', onBlur);
  doc.addEventListener('visibilitychange', onVisibility);

  return {
    sample(): InputFrame {
      const p1x = (held.has('KeyD') ? 1 : 0) - (held.has('KeyA') ? 1 : 0);
      const p1y = (held.has('KeyS') ? 1 : 0) - (held.has('KeyW') ? 1 : 0);
      const p2x = (held.has('ArrowRight') ? 1 : 0) - (held.has('ArrowLeft') ? 1 : 0);
      const p2y = (held.has('ArrowDown') ? 1 : 0) - (held.has('ArrowUp') ? 1 : 0);
      return {
        players: {
          attractor: {
            move: { x: p1x, y: p1y },
            fieldActive: p1Field,
          },
          repulsor: {
            move: { x: p2x, y: p2y },
            fieldActive: p2Field,
          },
        },
      };
    },

    drainCommands(): readonly GameCommand[] {
      const drained = commands;
      commands = [];
      return drained;
    },

    clear,

    resetFields,

    dispose() {
      if (disposed) return;
      disposed = true;
      target.removeEventListener('keydown', onKeyDown);
      target.removeEventListener('keyup', onKeyUp);
      target.removeEventListener('blur', onBlur);
      doc.removeEventListener('visibilitychange', onVisibility);
      clear();
    },
  };
}
