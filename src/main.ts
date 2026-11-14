import './style.css';
import { GameEngine } from './engine/GameEngine';

const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
const engine = new GameEngine(canvas);
engine.init().catch((err) => {
  console.error('Failed to initialize Cryptfall:', err);
});
