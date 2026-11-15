import './style.css';
import './ui/story.css';
import { GameEngine } from './engine/GameEngine';

const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
const engine = new GameEngine(canvas);
// Dev-only debugging handle (tree-shaken out of production builds)
if (import.meta.env.DEV) (window as unknown as { __engine: GameEngine }).__engine = engine;
engine.init().catch((err) => {
  console.error('Failed to initialize Cryptfall:', err);
});
