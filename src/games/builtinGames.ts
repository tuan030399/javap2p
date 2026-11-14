import { BuiltinGameId, BuiltinGameMeta, J2MEKey, JavaGameEngine, SoftkeyLabels } from '../types/j2me';
import { getHighScore, saveHighScore } from '../utils/jarStorage';
import { retroAudio } from '../utils/sound';

export const BUILTIN_GAMES_META: BuiltinGameMeta[] = [
  {
    id: 'snake',
    title: 'Rắn Săn Mồi II',
    subtitle: 'Thu thập mồi thưởng và tránh tường mê cung qua từng cấp độ.',
    category: 'Arcade',
    vendor: 'Nokia Classic Series',
    version: '2.4',
    year: '2003',
    controlsHint: 'D-Pad hoặc 2 / 4 / 6 / 8 để đổi hướng · 5 để tạm dừng',
    accentColor: '#10B981',
  },
  {
    id: 'bounce',
    title: 'Bóng Nảy Phiêu Lưu',
    subtitle: 'Điều khiển bóng cao su vượt chướng ngại gai và xuyên qua các vòng vàng.',
    category: 'Phiêu lưu',
    vendor: 'J2ME Platformer',
    version: '1.8',
    year: '2004',
    controlsHint: 'Trái / Phải (4 / 6) di chuyển · Lên / 2 / 5 để nhảy',
    accentColor: '#EF4444',
  },
  {
    id: 'space',
    title: 'Chiến Cơ Không Gian',
    subtitle: 'Bắn hạ hạm đội ngoài hành tinh, ăn đạn nâng cấp và tiêu diệt trùm cuối.',
    category: 'Bắn súng',
    vendor: 'Space Impact DX',
    version: '3.0',
    year: '2005',
    controlsHint: 'D-Pad di chuyển · 5 / OK bắn đạn · # phóng tên lửa',
    accentColor: '#38BDF8',
  },
  {
    id: 'brick',
    title: 'Phá Gạch Kim Cương',
    subtitle: 'Đón bóng phá hủy các tầng gạch đá quý và thu thập vật phẩm hỗ trợ.',
    category: 'Giải đố',
    vendor: 'MIDP Arcade Studio',
    version: '1.5',
    year: '2006',
    controlsHint: 'Trái / Phải (4 / 6) di chuyển thanh đỡ · 5 / OK phóng bóng',
    accentColor: '#F59E0B',
  },
];

type PlayState = 'TITLE_MENU' | 'PLAYING' | 'PAUSED' | 'GAME_OVER' | 'VICTORY';

function isUp(k: number) { return k === J2MEKey.UP || k === J2MEKey.KEY_2; }
function isDown(k: number) { return k === J2MEKey.DOWN || k === J2MEKey.KEY_8; }
function isLeft(k: number) { return k === J2MEKey.LEFT || k === J2MEKey.KEY_4; }
function isRight(k: number) { return k === J2MEKey.RIGHT || k === J2MEKey.KEY_6; }
function isFire(k: number) { return k === J2MEKey.FIRE || k === J2MEKey.KEY_5; }

function hasAnyHeld(held: Set<number>, fn: (k: number) => boolean): boolean {
  for (const k of held) if (fn(k)) return true;
  return false;
}

// ============================================================================
// 1. SNAKE CLASSIC II
// ============================================================================
class SnakeClassicGame implements JavaGameEngine {
  id = 'snake';
  title = 'Rắn Săn Mồi II';
  private w = 240;
  private h = 320;
  private state: PlayState = 'TITLE_MENU';
  private score = 0;
  private highScore = getHighScore('snake');
  private level = 1;
  private cols = 20;
  private rows = 22;
  private cellSize = 10;
  private offsetX = 20;
  private offsetY = 44;

  private snake: { x: number; y: number }[] = [];
  private dir = { x: 1, y: 0 };
  private nextDir = { x: 1, y: 0 };
  private food = { x: 12, y: 10 };
  private bonusFood: { x: number; y: number; timer: number } | null = null;
  private walls: Set<string> = new Set();
  private stepTimer = 0;
  private stepInterval = 135;

  init(width: number, height: number) {
    this.w = width;
    this.h = height;
    this.computeGrid();
    this.state = 'TITLE_MENU';
  }

  private computeGrid() {
    const usableH = this.h - 68;
    const usableW = this.w - 16;
    this.cellSize = Math.max(7, Math.min(12, Math.floor(Math.min(usableW / 20, usableH / 22))));
    this.cols = Math.max(14, Math.floor(usableW / this.cellSize));
    this.rows = Math.max(14, Math.floor(usableH / this.cellSize));
    this.offsetX = Math.floor((this.w - this.cols * this.cellSize) / 2);
    this.offsetY = 38;
  }

  private startNewGame() {
    this.computeGrid();
    this.score = 0;
    this.level = 1;
    this.stepInterval = 135;
    this.setupBoard();
    this.state = 'PLAYING';
  }

  private setupBoard() {
    const cy = Math.floor(this.rows / 2);
    const cx = Math.floor(this.cols / 2);
    this.snake = [
      { x: cx, y: cy },
      { x: cx - 1, y: cy },
      { x: cx - 2, y: cy },
      { x: cx - 3, y: cy },
    ];
    this.dir = { x: 1, y: 0 };
    this.nextDir = { x: 1, y: 0 };
    this.walls.clear();
    if (this.level >= 2) {
      for (let x = 3; x < this.cols - 3; x++) {
        if (Math.abs(x - cx) > 2) {
          this.walls.add(`${x},3`);
          this.walls.add(`${x},${this.rows - 4}`);
        }
      }
    }
    if (this.level >= 3) {
      for (let y = 6; y < this.rows - 6; y++) {
        if (Math.abs(y - cy) > 2) {
          this.walls.add(`3,${y}`);
          this.walls.add(`${this.cols - 4},${y}`);
        }
      }
    }
    this.bonusFood = null;
    this.spawnFood();
  }

  private spawnFood() {
    for (let tries = 0; tries < 200; tries++) {
      const x = Math.floor(Math.random() * this.cols);
      const y = Math.floor(Math.random() * this.rows);
      const occupied =
        this.walls.has(`${x},${y}`) ||
        this.snake.some((s) => s.x === x && s.y === y);
      if (!occupied) {
        this.food = { x, y };
        return;
      }
    }
  }

  update(dtMs: number) {
    if (this.state !== 'PLAYING') return;
    if (this.bonusFood) {
      this.bonusFood.timer -= dtMs;
      if (this.bonusFood.timer <= 0) this.bonusFood = null;
    }

    this.stepTimer += dtMs;
    if (this.stepTimer < this.stepInterval) return;
    this.stepTimer -= this.stepInterval;

    this.dir = this.nextDir;
    let nx = this.snake[0].x + this.dir.x;
    let ny = this.snake[0].y + this.dir.y;

    // Wrap edges cleanly on Level 1, solid walls on Level 2+
    if (this.level === 1) {
      nx = (nx + this.cols) % this.cols;
      ny = (ny + this.rows) % this.rows;
    } else if (nx < 0 || nx >= this.cols || ny < 0 || ny >= this.rows) {
      this.triggerGameOver();
      return;
    }

    if (this.walls.has(`${nx},${ny}`) || this.snake.some((s) => s.x === nx && s.y === ny)) {
      this.triggerGameOver();
      return;
    }

    const head = { x: nx, y: ny };
    this.snake.unshift(head);

    if (nx === this.food.x && ny === this.food.y) {
      this.score += 10 * this.level;
      this.highScore = saveHighScore('snake', this.score);
      retroAudio.playScore();
      this.spawnFood();
      if (this.score >= this.level * 120 && this.level < 4) {
        this.level++;
        this.stepInterval = Math.max(75, 135 - (this.level - 1) * 16);
        retroAudio.playLevelClear();
        this.setupBoard();
      } else if (!this.bonusFood && Math.random() < 0.28) {
        this.spawnBonus();
      }
    } else if (this.bonusFood && nx === this.bonusFood.x && ny === this.bonusFood.y) {
      this.score += 45;
      this.highScore = saveHighScore('snake', this.score);
      retroAudio.playLevelClear();
      this.bonusFood = null;
    } else {
      this.snake.pop();
    }
  }

  private spawnBonus() {
    for (let i = 0; i < 60; i++) {
      const x = Math.floor(Math.random() * this.cols);
      const y = Math.floor(Math.random() * this.rows);
      if (!this.walls.has(`${x},${y}`) && !this.snake.some((s) => s.x === x && s.y === y)) {
        this.bonusFood = { x, y, timer: 5500 };
        return;
      }
    }
  }

  private triggerGameOver() {
    this.state = 'GAME_OVER';
    this.highScore = saveHighScore('snake', this.score);
    retroAudio.playGameOver();
  }

  onKeyDown(keyCode: number) {
    if (this.state === 'TITLE_MENU') {
      if (isFire(keyCode) || keyCode === J2MEKey.SOFT_LEFT) {
        retroAudio.playBlip();
        this.startNewGame();
      }
      return;
    }
    if (this.state === 'GAME_OVER') {
      if (isFire(keyCode) || keyCode === J2MEKey.SOFT_LEFT) {
        retroAudio.playBlip();
        this.startNewGame();
      } else if (keyCode === J2MEKey.SOFT_RIGHT) {
        this.state = 'TITLE_MENU';
      }
      return;
    }
    if (keyCode === J2MEKey.SOFT_LEFT || keyCode === J2MEKey.SOFT_RIGHT) {
      this.state = this.state === 'PLAYING' ? 'PAUSED' : 'PLAYING';
      retroAudio.playBlip();
      return;
    }
    if (this.state === 'PAUSED') {
      if (isFire(keyCode)) {
        this.state = 'PLAYING';
        retroAudio.playBlip();
      }
      return;
    }

    if (isUp(keyCode) && this.dir.y !== 1) this.nextDir = { x: 0, y: -1 };
    else if (isDown(keyCode) && this.dir.y !== -1) this.nextDir = { x: 0, y: 1 };
    else if (isLeft(keyCode) && this.dir.x !== 1) this.nextDir = { x: -1, y: 0 };
    else if (isRight(keyCode) && this.dir.x !== -1) this.nextDir = { x: 1, y: 0 };
    else if (isFire(keyCode)) {
      this.state = 'PAUSED';
    }
  }

  onKeyUp() {}

  getSoftkeys(): SoftkeyLabels {
    if (this.state === 'TITLE_MENU') return { left: 'Bắt đầu', center: 'Chơi', right: '' };
    if (this.state === 'GAME_OVER') return { left: 'Chơi lại', center: 'Thử lại', right: 'Menu' };
    if (this.state === 'PAUSED') return { left: 'Tiếp tục', center: 'Tiếp', right: 'Menu' };
    return { left: 'Tạm dừng', center: 'Dừng', right: 'Menu' };
  }

  getHighScore() {
    return this.highScore;
  }

  render(ctx: CanvasRenderingContext2D, width: number, height: number) {
    // Classic LCD green-tinted dark arena
    ctx.fillStyle = '#0D1912';
    ctx.fillRect(0, 0, width, height);

    if (this.state === 'TITLE_MENU') {
      ctx.fillStyle = '#142A1D';
      ctx.fillRect(14, 24, width - 28, height - 56);
      ctx.strokeStyle = '#10B981';
      ctx.strokeRect(14.5, 24.5, width - 29, height - 57);

      ctx.fillStyle = '#10B981';
      ctx.font = 'bold 16px "JetBrains Mono", monospace';
      ctx.textAlign = 'center';
      ctx.fillText('SNAKE CLASSIC II', width / 2, 74);

      ctx.fillStyle = '#A7F3D0';
      ctx.font = '11px "Plus Jakarta Sans", sans-serif';
      ctx.fillText('Phiên bản J2ME 2.4', width / 2, 96);

      // Decorative pixel snake
      for (let i = 0; i < 7; i++) {
        ctx.fillStyle = i === 0 ? '#34D399' : '#059669';
        ctx.fillRect(width / 2 - 42 + i * 12, 126, 10, 10);
      }
      ctx.fillStyle = '#F59E0B';
      ctx.fillRect(width / 2 + 54, 126, 10, 10);

      ctx.fillStyle = '#CBD5E1';
      ctx.font = '11px "Plus Jakarta Sans", sans-serif';
      ctx.fillText(`Kỷ lục hiện tại: ${this.highScore}`, width / 2, 174);
      ctx.fillText('Nhấn OK hoặc phím 5 để chơi', width / 2, 206);
      ctx.textAlign = 'left';
      return;
    }

    // Top HUD
    ctx.fillStyle = '#12241A';
    ctx.fillRect(0, 0, width, 30);
    ctx.fillStyle = '#10B981';
    ctx.font = 'bold 11px "JetBrains Mono", monospace';
    ctx.fillText(`ĐIỂM: ${this.score}`, 10, 19);
    ctx.fillStyle = '#94A3B8';
    ctx.textAlign = 'right';
    ctx.fillText(`MÀN ${this.level} · KỶ LỤC ${this.highScore}`, width - 10, 19);
    ctx.textAlign = 'left';

    // Arena frame
    const aw = this.cols * this.cellSize;
    const ah = this.rows * this.cellSize;
    ctx.fillStyle = '#09120D';
    ctx.fillRect(this.offsetX, this.offsetY, aw, ah);
    ctx.strokeStyle = this.level >= 2 ? '#F59E0B' : '#1E3A2A';
    ctx.strokeRect(this.offsetX - 0.5, this.offsetY - 0.5, aw + 1, ah + 1);

    // Maze walls
    ctx.fillStyle = '#64748B';
    for (const key of this.walls) {
      const [wx, wy] = key.split(',').map(Number);
      ctx.fillRect(
        this.offsetX + wx * this.cellSize + 1,
        this.offsetY + wy * this.cellSize + 1,
        this.cellSize - 2,
        this.cellSize - 2
      );
    }

    // Food
    ctx.fillStyle = '#F59E0B';
    ctx.fillRect(
      this.offsetX + this.food.x * this.cellSize + 1,
      this.offsetY + this.food.y * this.cellSize + 1,
      this.cellSize - 2,
      this.cellSize - 2
    );

    // Bonus food
    if (this.bonusFood) {
      ctx.fillStyle = Math.floor(this.bonusFood.timer / 150) % 2 === 0 ? '#38BDF8' : '#F43F5E';
      ctx.fillRect(
        this.offsetX + this.bonusFood.x * this.cellSize,
        this.offsetY + this.bonusFood.y * this.cellSize,
        this.cellSize,
        this.cellSize
      );
    }

    // Snake
    this.snake.forEach((seg, idx) => {
      ctx.fillStyle = idx === 0 ? '#34D399' : idx % 2 === 0 ? '#10B981' : '#059669';
      ctx.fillRect(
        this.offsetX + seg.x * this.cellSize + 0.5,
        this.offsetY + seg.y * this.cellSize + 0.5,
        this.cellSize - 1,
        this.cellSize - 1
      );
    });

    if (this.state === 'PAUSED' || this.state === 'GAME_OVER') {
      ctx.fillStyle = 'rgba(9, 14, 11, 0.8)';
      ctx.fillRect(0, 0, width, height);
      ctx.textAlign = 'center';
      ctx.fillStyle = this.state === 'GAME_OVER' ? '#F87171' : '#F59E0B';
      ctx.font = 'bold 15px "JetBrains Mono", monospace';
      ctx.fillText(this.state === 'GAME_OVER' ? 'KẾT THÚC' : 'TẠM DỪNG', width / 2, height / 2 - 14);
      ctx.fillStyle = '#E2E8F0';
      ctx.font = '12px "Plus Jakarta Sans", sans-serif';
      ctx.fillText(`Điểm của bạn: ${this.score}`, width / 2, height / 2 + 12);
      ctx.fillStyle = '#94A3B8';
      ctx.font = '11px "Plus Jakarta Sans", sans-serif';
      ctx.fillText('Nhấn OK để tiếp tục', width / 2, height / 2 + 36);
      ctx.textAlign = 'left';
    }
  }
}

// ============================================================================
// 2. BOUNCE CLASSIC
// ============================================================================
interface BounceRing { x: number; y: number; collected: boolean }
interface BounceSpike { x: number; y: number; w: number; h: number }
interface BouncePlat { x: number; y: number; w: number; h: number }

class BounceClassicGame implements JavaGameEngine {
  id = 'bounce';
  title = 'Bóng Nảy Phiêu Lưu';
  private w = 240;
  private h = 320;
  private state: PlayState = 'TITLE_MENU';
  private score = 0;
  private highScore = getHighScore('bounce');
  private lives = 3;
  private level = 1;

  private ball = { x: 40, y: 180, vx: 0, vy: 0, r: 10 };
  private spawn = { x: 40, y: 180 };
  private camX = 0;
  private worldW = 900;
  private plats: BouncePlat[] = [];
  private spikes: BounceSpike[] = [];
  private rings: BounceRing[] = [];
  private goalX = 840;

  init(width: number, height: number) {
    this.w = width;
    this.h = height;
    this.state = 'TITLE_MENU';
  }

  private startNewGame() {
    this.score = 0;
    this.lives = 3;
    this.level = 1;
    this.loadLevel(1);
    this.state = 'PLAYING';
  }

  private loadLevel(lvl: number) {
    const floorY = this.h - 42;
    this.ball = { x: 36, y: floorY - 30, vx: 0, vy: 0, r: 10 };
    this.spawn = { x: 36, y: floorY - 30 };
    this.camX = 0;
    this.worldW = 860 + lvl * 180;
    this.goalX = this.worldW - 54;

    this.plats = [
      { x: 0, y: floorY, w: this.worldW, h: 42 },
      { x: 110, y: floorY - 52, w: 70, h: 12 },
      { x: 230, y: floorY - 94, w: 84, h: 12 },
      { x: 370, y: floorY - 58, w: 68, h: 12 },
      { x: 485, y: floorY - 106, w: 92, h: 12 },
      { x: 630, y: floorY - 64, w: 78, h: 12 },
      { x: 750, y: floorY - 96, w: 72, h: 12 },
    ];

    this.spikes = [
      { x: 180, y: floorY - 14, w: 26, h: 14 },
      { x: 325, y: floorY - 14, w: 30, h: 14 },
      { x: 445, y: floorY - 14, w: 32, h: 14 },
      { x: 585, y: floorY - 14, w: 32, h: 14 },
    ];
    if (lvl >= 2) {
      this.spikes.push({ x: 710, y: floorY - 14, w: 28, h: 14 });
    }

    this.rings = [
      { x: 145, y: floorY - 76, collected: false },
      { x: 272, y: floorY - 118, collected: false },
      { x: 404, y: floorY - 82, collected: false },
      { x: 530, y: floorY - 130, collected: false },
      { x: 668, y: floorY - 88, collected: false },
      { x: 785, y: floorY - 120, collected: false },
    ];
  }

  update(dtMs: number, heldKeys: Set<number>) {
    if (this.state !== 'PLAYING') return;
    const dt = Math.min(0.032, dtMs / 1000);

    const moveLeft = hasAnyHeld(heldKeys, isLeft);
    const moveRight = hasAnyHeld(heldKeys, isRight);
    const jumpHeld = hasAnyHeld(heldKeys, (k) => isUp(k) || isFire(k));

    if (moveLeft) this.ball.vx = Math.max(-165, this.ball.vx - 620 * dt);
    else if (moveRight) this.ball.vx = Math.min(165, this.ball.vx + 620 * dt);
    else this.ball.vx *= 0.88;

    this.ball.vy += 560 * dt; // Gravity
    this.ball.x += this.ball.vx * dt;
    this.ball.y += this.ball.vy * dt;

    if (this.ball.x < this.ball.r) {
      this.ball.x = this.ball.r;
      this.ball.vx = 0;
    }
    if (this.ball.x > this.worldW - this.ball.r) {
      this.ball.x = this.worldW - this.ball.r;
      this.ball.vx = 0;
    }

    let onGround = false;
    for (const p of this.plats) {
      if (
        this.ball.x + this.ball.r > p.x &&
        this.ball.x - this.ball.r < p.x + p.w &&
        this.ball.y + this.ball.r >= p.y &&
        this.ball.y - this.ball.r < p.y + p.h &&
        this.ball.vy >= 0 &&
        this.ball.y + this.ball.r - this.ball.vy * dt <= p.y + 8
      ) {
        this.ball.y = p.y - this.ball.r;
        if (jumpHeld) {
          this.ball.vy = -275;
          retroAudio.playJump();
        } else if (Math.abs(this.ball.vy) > 95) {
          this.ball.vy = -this.ball.vy * 0.45;
        } else {
          this.ball.vy = 0;
        }
        onGround = true;
      }
    }

    if (onGround && jumpHeld && this.ball.vy === 0) {
      this.ball.vy = -275;
      retroAudio.playJump();
    }

    // Collect rings
    for (const r of this.rings) {
      if (!r.collected) {
        const dx = this.ball.x - r.x;
        const dy = this.ball.y - r.y;
        if (dx * dx + dy * dy < 22 * 22) {
          r.collected = true;
          this.score += 100;
          this.highScore = saveHighScore('bounce', this.score);
          this.spawn = { x: r.x, y: r.y };
          retroAudio.playScore();
        }
      }
    }

    // Spike collisions
    for (const s of this.spikes) {
      if (
        this.ball.x + this.ball.r - 3 > s.x &&
        this.ball.x - this.ball.r + 3 < s.x + s.w &&
        this.ball.y + this.ball.r - 2 > s.y
      ) {
        this.lives--;
        retroAudio.playHit();
        if (this.lives <= 0) {
          this.state = 'GAME_OVER';
          retroAudio.playGameOver();
          return;
        }
        this.ball.x = this.spawn.x;
        this.ball.y = this.spawn.y;
        this.ball.vx = 0;
        this.ball.vy = 0;
        return;
      }
    }

    // Reach goal portal
    const collectedCount = this.rings.filter((r) => r.collected).length;
    if (this.ball.x >= this.goalX && collectedCount >= this.rings.length) {
      this.score += 250;
      this.highScore = saveHighScore('bounce', this.score);
      retroAudio.playLevelClear();
      if (this.level < 3) {
        this.level++;
        this.loadLevel(this.level);
      } else {
        this.state = 'VICTORY';
      }
    }

    const targetCam = this.ball.x - this.w * 0.42;
    this.camX = Math.max(0, Math.min(this.worldW - this.w, targetCam));
  }

  onKeyDown(keyCode: number) {
    if (this.state === 'TITLE_MENU' || this.state === 'GAME_OVER' || this.state === 'VICTORY') {
      if (isFire(keyCode) || keyCode === J2MEKey.SOFT_LEFT) {
        retroAudio.playBlip();
        this.startNewGame();
      } else if (keyCode === J2MEKey.SOFT_RIGHT) {
        this.state = 'TITLE_MENU';
      }
      return;
    }
    if (keyCode === J2MEKey.SOFT_LEFT || keyCode === J2MEKey.SOFT_RIGHT) {
      this.state = this.state === 'PLAYING' ? 'PAUSED' : 'PLAYING';
      retroAudio.playBlip();
    } else if (this.state === 'PAUSED' && isFire(keyCode)) {
      this.state = 'PLAYING';
    }
  }

  onKeyUp() {}

  getSoftkeys(): SoftkeyLabels {
    if (this.state === 'TITLE_MENU') return { left: 'Bắt đầu', center: 'Chơi', right: '' };
    if (this.state === 'GAME_OVER' || this.state === 'VICTORY') return { left: 'Chơi lại', center: 'Thử lại', right: 'Menu' };
    return { left: this.state === 'PAUSED' ? 'Tiếp tục' : 'Tạm dừng', center: 'Nhảy', right: 'Menu' };
  }

  getHighScore() {
    return this.highScore;
  }

  render(ctx: CanvasRenderingContext2D, width: number, height: number) {
    // Classic sky blue Bounce backdrop
    ctx.fillStyle = '#0F2544';
    ctx.fillRect(0, 0, width, height);

    if (this.state === 'TITLE_MENU') {
      ctx.fillStyle = '#17345C';
      ctx.fillRect(14, 24, width - 28, height - 56);
      ctx.strokeStyle = '#EF4444';
      ctx.strokeRect(14.5, 24.5, width - 29, height - 57);

      ctx.textAlign = 'center';
      ctx.fillStyle = '#F87171';
      ctx.font = 'bold 16px "JetBrains Mono", monospace';
      ctx.fillText('BOUNCE CLASSIC', width / 2, 74);

      // Red glossy ball icon
      ctx.fillStyle = '#DC2626';
      ctx.beginPath();
      ctx.arc(width / 2, 126, 18, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#FCA5A5';
      ctx.beginPath();
      ctx.arc(width / 2 - 5, 120, 5, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#E2E8F0';
      ctx.font = '11px "Plus Jakarta Sans", sans-serif';
      ctx.fillText(`Kỷ lục: ${this.highScore}`, width / 2, 174);
      ctx.fillText('Thu thập đủ vòng vàng để qua màn', width / 2, 196);
      ctx.fillText('Nhấn OK / 5 để bắt đầu', width / 2, 224);
      ctx.textAlign = 'left';
      return;
    }

    ctx.save();
    ctx.translate(-this.camX, 0);

    // Platforms
    for (const p of this.plats) {
      ctx.fillStyle = '#B45309';
      ctx.fillRect(p.x, p.y, p.w, p.h);
      ctx.fillStyle = '#D97706';
      ctx.fillRect(p.x, p.y, p.w, 4);
    }

    // Spikes
    ctx.fillStyle = '#E2E8F0';
    for (const s of this.spikes) {
      const count = Math.max(2, Math.floor(s.w / 8));
      const sw = s.w / count;
      for (let i = 0; i < count; i++) {
        ctx.beginPath();
        ctx.moveTo(s.x + i * sw, s.y + s.h);
        ctx.lineTo(s.x + i * sw + sw / 2, s.y);
        ctx.lineTo(s.x + (i + 1) * sw, s.y + s.h);
        ctx.closePath();
        ctx.fill();
      }
    }

    // Rings
    for (const r of this.rings) {
      ctx.strokeStyle = r.collected ? '#64748B' : '#FBBF24';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.ellipse(r.x, r.y, 6, 14, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.lineWidth = 1;

    // Exit portal
    const allCollected = this.rings.every((r) => r.collected);
    ctx.fillStyle = allCollected ? '#10B981' : '#334155';
    ctx.fillRect(this.goalX, this.h - 92, 24, 50);
    ctx.strokeStyle = '#F8FAFC';
    ctx.strokeRect(this.goalX + 0.5, this.h - 91.5, 23, 49);

    // Ball
    ctx.fillStyle = '#DC2626';
    ctx.beginPath();
    ctx.arc(this.ball.x, this.ball.y, this.ball.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#FCA5A5';
    ctx.beginPath();
    ctx.arc(this.ball.x - 3, this.ball.y - 3, 3, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();

    // Top HUD
    ctx.fillStyle = 'rgba(10, 18, 32, 0.86)';
    ctx.fillRect(0, 0, width, 28);
    ctx.fillStyle = '#F8FAFC';
    ctx.font = 'bold 11px "JetBrains Mono", monospace';
    const rem = this.rings.filter((r) => !r.collected).length;
    ctx.fillText(`MẠNG:${this.lives}  VÒNG:${rem}`, 8, 18);
    ctx.textAlign = 'right';
    ctx.fillStyle = '#FBBF24';
    ctx.fillText(`ĐIỂM:${this.score}`, width - 8, 18);
    ctx.textAlign = 'left';

    if (this.state === 'PAUSED' || this.state === 'GAME_OVER' || this.state === 'VICTORY') {
      ctx.fillStyle = 'rgba(10, 14, 22, 0.8)';
      ctx.fillRect(0, 0, width, height);
      ctx.textAlign = 'center';
      ctx.fillStyle = this.state === 'VICTORY' ? '#10B981' : this.state === 'GAME_OVER' ? '#F87171' : '#F59E0B';
      ctx.font = 'bold 15px "JetBrains Mono", monospace';
      ctx.fillText(
        this.state === 'VICTORY' ? 'CHIẾN THẮNG!' : this.state === 'GAME_OVER' ? 'HẾT MẠNG' : 'TẠM DỪNG',
        width / 2,
        height / 2 - 12
      );
      ctx.fillStyle = '#E2E8F0';
      ctx.font = '12px "Plus Jakarta Sans", sans-serif';
      ctx.fillText(`Tổng điểm: ${this.score}`, width / 2, height / 2 + 12);
      ctx.textAlign = 'left';
    }
  }
}

// ============================================================================
// 3. SPACE IMPACT DX
// ============================================================================
interface Bullet { x: number; y: number; vx: number; vy: number; fromEnemy?: boolean }
interface Enemy { x: number; y: number; hp: number; maxHp: number; kind: 'scout' | 'wave' | 'boss'; phase: number }

class SpaceImpactGame implements JavaGameEngine {
  id = 'space';
  title = 'Chiến Cơ Không Gian';
  private w = 240;
  private h = 320;
  private state: PlayState = 'TITLE_MENU';
  private score = 0;
  private highScore = getHighScore('space');
  private hp = 3;
  private missiles = 2;
  private wave = 1;

  private ship = { x: 28, y: 150 };
  private fireCooldown = 0;
  private spawnTimer = 0;
  private enemiesSpawned = 0;
  private stars: { x: number; y: number; speed: number }[] = [];
  private bullets: Bullet[] = [];
  private enemies: Enemy[] = [];

  init(width: number, height: number) {
    this.w = width;
    this.h = height;
    this.stars = Array.from({ length: 28 }, () => ({
      x: Math.random() * width,
      y: 32 + Math.random() * (height - 40),
      speed: 25 + Math.random() * 55,
    }));
    this.state = 'TITLE_MENU';
  }

  private startNewGame() {
    this.score = 0;
    this.hp = 3;
    this.missiles = 2;
    this.wave = 1;
    this.ship = { x: 28, y: Math.floor(this.h / 2) };
    this.bullets = [];
    this.enemies = [];
    this.enemiesSpawned = 0;
    this.spawnTimer = 600;
    this.state = 'PLAYING';
  }

  update(dtMs: number, heldKeys: Set<number>) {
    const dt = Math.min(0.04, dtMs / 1000);
    for (const st of this.stars) {
      st.x -= st.speed * dt;
      if (st.x < 0) {
        st.x = this.w;
        st.y = 32 + Math.random() * (this.h - 40);
      }
    }

    if (this.state !== 'PLAYING') return;

    const speed = 135;
    if (hasAnyHeld(heldKeys, isUp)) this.ship.y -= speed * dt;
    if (hasAnyHeld(heldKeys, isDown)) this.ship.y += speed * dt;
    if (hasAnyHeld(heldKeys, isLeft)) this.ship.x -= speed * dt;
    if (hasAnyHeld(heldKeys, isRight)) this.ship.x += speed * dt;

    this.ship.x = Math.max(12, Math.min(this.w - 40, this.ship.x));
    this.ship.y = Math.max(38, Math.min(this.h - 16, this.ship.y));

    this.fireCooldown -= dtMs;
    if (hasAnyHeld(heldKeys, isFire) && this.fireCooldown <= 0) {
      this.bullets.push({ x: this.ship.x + 16, y: this.ship.y, vx: 260, vy: 0 });
      this.fireCooldown = 190;
      retroAudio.playLaser();
    }

    this.spawnTimer -= dtMs;
    if (this.spawnTimer <= 0 && !this.enemies.some((e) => e.kind === 'boss')) {
      this.enemiesSpawned++;
      if (this.enemiesSpawned % 12 === 0) {
        this.enemies.push({
          x: this.w + 20,
          y: this.h / 2,
          hp: 10 + this.wave * 4,
          maxHp: 10 + this.wave * 4,
          kind: 'boss',
          phase: 0,
        });
      } else {
        this.enemies.push({
          x: this.w + 14,
          y: 44 + Math.random() * (this.h - 68),
          hp: 1,
          maxHp: 1,
          kind: Math.random() < 0.45 ? 'wave' : 'scout',
          phase: Math.random() * Math.PI * 2,
        });
      }
      this.spawnTimer = Math.max(450, 1050 - this.wave * 110);
    }

    for (const b of this.bullets) {
      b.x += b.vx * dt;
      b.y += b.vy * dt;
    }
    this.bullets = this.bullets.filter((b) => b.x > -10 && b.x < this.w + 15);

    for (const e of this.enemies) {
      e.phase += dt * 3;
      if (e.kind === 'boss') {
        if (e.x > this.w - 42) e.x -= 40 * dt;
        e.y = this.h / 2 + Math.sin(e.phase * 0.7) * (this.h * 0.28);
        if (Math.random() < dt * 1.8) {
          this.bullets.push({ x: e.x - 14, y: e.y, vx: -145, vy: (Math.random() - 0.5) * 40, fromEnemy: true });
        }
      } else if (e.kind === 'wave') {
        e.x -= (78 + this.wave * 8) * dt;
        e.y += Math.sin(e.phase) * 55 * dt;
      } else {
        e.x -= (95 + this.wave * 10) * dt;
      }
    }

    // Player bullets hit enemies
    for (const b of this.bullets) {
      if (b.fromEnemy) {
        if (Math.abs(b.x - this.ship.x) < 12 && Math.abs(b.y - this.ship.y) < 10) {
          b.x = -999;
          this.damagePlayer();
        }
        continue;
      }
      for (const e of this.enemies) {
        const hitR = e.kind === 'boss' ? 20 : 12;
        if (Math.abs(b.x - e.x) < hitR && Math.abs(b.y - e.y) < hitR) {
          b.x = 9999;
          e.hp--;
          if (e.hp <= 0) {
            this.score += e.kind === 'boss' ? 200 : 25;
            this.highScore = saveHighScore('space', this.score);
            retroAudio.playScore();
            if (e.kind === 'boss') {
              this.wave++;
              this.missiles = Math.min(4, this.missiles + 1);
              retroAudio.playLevelClear();
            }
          }
          break;
        }
      }
    }

    // Ship collision
    for (const e of this.enemies) {
      if (e.hp > 0 && Math.abs(e.x - this.ship.x) < 15 && Math.abs(e.y - this.ship.y) < 13) {
        e.hp = 0;
        this.damagePlayer();
      }
    }

    this.enemies = this.enemies.filter((e) => e.hp > 0 && e.x > -24);
  }

  private damagePlayer() {
    this.hp--;
    retroAudio.playHit();
    if (this.hp <= 0) {
      this.state = 'GAME_OVER';
      retroAudio.playGameOver();
    }
  }

  private fireMissile() {
    if (this.missiles <= 0 || this.state !== 'PLAYING') return;
    this.missiles--;
    retroAudio.playLevelClear();
    for (const e of this.enemies) {
      e.hp -= 5;
      if (e.hp <= 0) {
        this.score += e.kind === 'boss' ? 200 : 25;
      }
    }
    this.highScore = saveHighScore('space', this.score);
    this.enemies = this.enemies.filter((e) => e.hp > 0);
  }

  onKeyDown(keyCode: number) {
    if (this.state === 'TITLE_MENU' || this.state === 'GAME_OVER') {
      if (isFire(keyCode) || keyCode === J2MEKey.SOFT_LEFT) {
        retroAudio.playBlip();
        this.startNewGame();
      } else if (keyCode === J2MEKey.SOFT_RIGHT) {
        this.state = 'TITLE_MENU';
      }
      return;
    }
    if (keyCode === J2MEKey.KEY_POUND || keyCode === J2MEKey.SOFT_LEFT) {
      this.fireMissile();
      return;
    }
    if (keyCode === J2MEKey.SOFT_RIGHT) {
      this.state = this.state === 'PLAYING' ? 'PAUSED' : 'PLAYING';
      retroAudio.playBlip();
      return;
    }
    if (this.state === 'PAUSED' && isFire(keyCode)) {
      this.state = 'PLAYING';
    }
  }

  onKeyUp() {}

  getSoftkeys(): SoftkeyLabels {
    if (this.state === 'TITLE_MENU') return { left: 'Bắt đầu', center: 'Bay', right: '' };
    if (this.state === 'GAME_OVER') return { left: 'Chơi lại', center: 'Thử lại', right: 'Menu' };
    return { left: `Tên lửa(${this.missiles})`, center: 'Bắn', right: 'Dừng' };
  }

  getHighScore() {
    return this.highScore;
  }

  render(ctx: CanvasRenderingContext2D, width: number, height: number) {
    ctx.fillStyle = '#070B14';
    ctx.fillRect(0, 0, width, height);

    ctx.fillStyle = '#64748B';
    for (const st of this.stars) {
      ctx.fillRect(st.x, st.y, 1.5, 1.5);
    }

    if (this.state === 'TITLE_MENU') {
      ctx.fillStyle = '#0E1729';
      ctx.fillRect(14, 24, width - 28, height - 56);
      ctx.strokeStyle = '#38BDF8';
      ctx.strokeRect(14.5, 24.5, width - 29, height - 57);

      ctx.textAlign = 'center';
      ctx.fillStyle = '#38BDF8';
      ctx.font = 'bold 16px "JetBrains Mono", monospace';
      ctx.fillText('SPACE IMPACT DX', width / 2, 74);

      // Draw mini ship
      ctx.fillStyle = '#38BDF8';
      ctx.beginPath();
      ctx.moveTo(width / 2 + 18, 124);
      ctx.lineTo(width / 2 - 14, 112);
      ctx.lineTo(width / 2 - 8, 124);
      ctx.lineTo(width / 2 - 14, 136);
      ctx.closePath();
      ctx.fill();

      ctx.fillStyle = '#CBD5E1';
      ctx.font = '11px "Plus Jakarta Sans", sans-serif';
      ctx.fillText(`Kỷ lục: ${this.highScore}`, width / 2, 174);
      ctx.fillText('5/OK: Bắn laser · #: Tên lửa', width / 2, 198);
      ctx.fillText('Nhấn OK để xuất kích', width / 2, 224);
      ctx.textAlign = 'left';
      return;
    }

    // Player ship
    ctx.fillStyle = '#38BDF8';
    ctx.beginPath();
    ctx.moveTo(this.ship.x + 14, this.ship.y);
    ctx.lineTo(this.ship.x - 10, this.ship.y - 8);
    ctx.lineTo(this.ship.x - 6, this.ship.y);
    ctx.lineTo(this.ship.x - 10, this.ship.y + 8);
    ctx.closePath();
    ctx.fill();

    // Bullets
    for (const b of this.bullets) {
      ctx.fillStyle = b.fromEnemy ? '#FB7185' : '#FDE047';
      ctx.fillRect(b.x - 3, b.y - 1.5, 7, 3);
    }

    // Enemies
    for (const e of this.enemies) {
      if (e.kind === 'boss') {
        ctx.fillStyle = '#F43F5E';
        ctx.fillRect(e.x - 16, e.y - 18, 32, 36);
        ctx.fillStyle = '#FDE047';
        ctx.fillRect(e.x - 10, e.y - 6, 8, 12);
        // Boss HP bar
        ctx.fillStyle = '#334155';
        ctx.fillRect(e.x - 16, e.y - 25, 32, 4);
        ctx.fillStyle = '#10B981';
        ctx.fillRect(e.x - 16, e.y - 25, 32 * (e.hp / e.maxHp), 4);
      } else {
        ctx.fillStyle = e.kind === 'wave' ? '#A78BFA' : '#FB923C';
        ctx.fillRect(e.x - 9, e.y - 7, 18, 14);
        ctx.fillStyle = '#0F172A';
        ctx.fillRect(e.x - 4, e.y - 3, 4, 6);
      }
    }

    // HUD
    ctx.fillStyle = 'rgba(11, 17, 30, 0.9)';
    ctx.fillRect(0, 0, width, 28);
    ctx.fillStyle = '#38BDF8';
    ctx.font = 'bold 11px "JetBrains Mono", monospace';
    ctx.fillText(`HP:${'♥'.repeat(Math.max(0, this.hp))}`, 8, 18);
    ctx.textAlign = 'right';
    ctx.fillStyle = '#FDE047';
    ctx.fillText(`W${this.wave} · ${this.score}`, width - 8, 18);
    ctx.textAlign = 'left';

    if (this.state === 'PAUSED' || this.state === 'GAME_OVER') {
      ctx.fillStyle = 'rgba(7, 11, 20, 0.8)';
      ctx.fillRect(0, 0, width, height);
      ctx.textAlign = 'center';
      ctx.fillStyle = this.state === 'GAME_OVER' ? '#FB7185' : '#F59E0B';
      ctx.font = 'bold 15px "JetBrains Mono", monospace';
      ctx.fillText(this.state === 'GAME_OVER' ? 'CHIẾN CƠ RƠI' : 'TẠM DỪNG', width / 2, height / 2 - 12);
      ctx.fillStyle = '#E2E8F0';
      ctx.font = '12px "Plus Jakarta Sans", sans-serif';
      ctx.fillText(`Điểm số: ${this.score}`, width / 2, height / 2 + 12);
      ctx.textAlign = 'left';
    }
  }
}

// ============================================================================
// 4. DIAMOND BRICK BREAKER
// ============================================================================
interface Brick { x: number; y: number; w: number; h: number; hp: number; color: string }

class BrickBreakerGame implements JavaGameEngine {
  id = 'brick';
  title = 'Phá Gạch Kim Cương';
  private w = 240;
  private h = 320;
  private state: PlayState = 'TITLE_MENU';
  private score = 0;
  private highScore = getHighScore('brick');
  private lives = 3;
  private level = 1;

  private paddle = { x: 90, w: 54, h: 10 };
  private ball = { x: 120, y: 240, vx: 110, vy: -145, r: 5, stuck: true };
  private bricks: Brick[] = [];

  init(width: number, height: number) {
    this.w = width;
    this.h = height;
    this.state = 'TITLE_MENU';
  }

  private startNewGame() {
    this.score = 0;
    this.lives = 3;
    this.level = 1;
    this.setupLevel();
    this.state = 'PLAYING';
  }

  private setupLevel() {
    this.paddle = { x: this.w / 2 - 27, w: 54, h: 9 };
    this.ball = { x: this.w / 2, y: this.h - 46, vx: 115 + this.level * 12, vy: -(150 + this.level * 12), r: 5, stuck: true };
    this.bricks = [];
    const cols = 7;
    const rows = 4 + Math.min(2, this.level);
    const gap = 4;
    const bw = Math.floor((this.w - 20 - gap * (cols - 1)) / cols);
    const palette = ['#F59E0B', '#EC4899', '#38BDF8', '#10B981', '#A78BFA', '#EF4444'];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        this.bricks.push({
          x: 10 + c * (bw + gap),
          y: 42 + r * 16,
          w: bw,
          h: 12,
          hp: r === 0 && this.level >= 2 ? 2 : 1,
          color: palette[r % palette.length],
        });
      }
    }
  }

  update(dtMs: number, heldKeys: Set<number>) {
    if (this.state !== 'PLAYING') return;
    const dt = Math.min(0.032, dtMs / 1000);

    if (hasAnyHeld(heldKeys, isLeft)) this.paddle.x -= 210 * dt;
    if (hasAnyHeld(heldKeys, isRight)) this.paddle.x += 210 * dt;
    this.paddle.x = Math.max(6, Math.min(this.w - this.paddle.w - 6, this.paddle.x));

    if (this.ball.stuck) {
      this.ball.x = this.paddle.x + this.paddle.w / 2;
      this.ball.y = this.h - 46;
      return;
    }

    this.ball.x += this.ball.vx * dt;
    this.ball.y += this.ball.vy * dt;

    if (this.ball.x - this.ball.r < 0) {
      this.ball.x = this.ball.r;
      this.ball.vx = Math.abs(this.ball.vx);
      retroAudio.playKeyClick();
    }
    if (this.ball.x + this.ball.r > this.w) {
      this.ball.x = this.w - this.ball.r;
      this.ball.vx = -Math.abs(this.ball.vx);
      retroAudio.playKeyClick();
    }
    if (this.ball.y - this.ball.r < 30) {
      this.ball.y = 30 + this.ball.r;
      this.ball.vy = Math.abs(this.ball.vy);
      retroAudio.playKeyClick();
    }

    // Paddle bounce
    const py = this.h - 38;
    if (
      this.ball.vy > 0 &&
      this.ball.y + this.ball.r >= py &&
      this.ball.y - this.ball.r <= py + this.paddle.h &&
      this.ball.x >= this.paddle.x - 4 &&
      this.ball.x <= this.paddle.x + this.paddle.w + 4
    ) {
      const hitPos = (this.ball.x - (this.paddle.x + this.paddle.w / 2)) / (this.paddle.w / 2);
      const speed = Math.hypot(this.ball.vx, this.ball.vy);
      const angle = hitPos * 1.1;
      this.ball.vx = Math.sin(angle) * speed;
      this.ball.vy = -Math.cos(angle) * speed;
      this.ball.y = py - this.ball.r;
      retroAudio.playBlip();
    }

    // Brick collisions
    for (const br of this.bricks) {
      if (br.hp <= 0) continue;
      if (
        this.ball.x + this.ball.r > br.x &&
        this.ball.x - this.ball.r < br.x + br.w &&
        this.ball.y + this.ball.r > br.y &&
        this.ball.y - this.ball.r < br.y + br.h
      ) {
        br.hp--;
        this.ball.vy = -this.ball.vy;
        this.score += 20;
        this.highScore = saveHighScore('brick', this.score);
        retroAudio.playScore();
        break;
      }
    }

    this.bricks = this.bricks.filter((b) => b.hp > 0);
    if (this.bricks.length === 0) {
      this.level++;
      retroAudio.playLevelClear();
      this.setupLevel();
      return;
    }

    if (this.ball.y > this.h + 12) {
      this.lives--;
      retroAudio.playHit();
      if (this.lives <= 0) {
        this.state = 'GAME_OVER';
        retroAudio.playGameOver();
      } else {
        this.ball.stuck = true;
      }
    }
  }

  onKeyDown(keyCode: number) {
    if (this.state === 'TITLE_MENU' || this.state === 'GAME_OVER') {
      if (isFire(keyCode) || keyCode === J2MEKey.SOFT_LEFT) {
        retroAudio.playBlip();
        this.startNewGame();
      } else if (keyCode === J2MEKey.SOFT_RIGHT) {
        this.state = 'TITLE_MENU';
      }
      return;
    }
    if (keyCode === J2MEKey.SOFT_LEFT || keyCode === J2MEKey.SOFT_RIGHT) {
      this.state = this.state === 'PLAYING' ? 'PAUSED' : 'PLAYING';
      retroAudio.playBlip();
      return;
    }
    if (this.state === 'PAUSED' && isFire(keyCode)) {
      this.state = 'PLAYING';
      return;
    }
    if (isFire(keyCode) || isUp(keyCode)) {
      if (this.ball.stuck) {
        this.ball.stuck = false;
        retroAudio.playJump();
      }
    }
  }

  onKeyUp() {}

  getSoftkeys(): SoftkeyLabels {
    if (this.state === 'TITLE_MENU') return { left: 'Bắt đầu', center: 'Chơi', right: '' };
    if (this.state === 'GAME_OVER') return { left: 'Chơi lại', center: 'Thử lại', right: 'Menu' };
    return { left: this.state === 'PAUSED' ? 'Tiếp tục' : 'Tạm dừng', center: 'Phóng', right: 'Menu' };
  }

  getHighScore() {
    return this.highScore;
  }

  render(ctx: CanvasRenderingContext2D, width: number, height: number) {
    ctx.fillStyle = '#12101B';
    ctx.fillRect(0, 0, width, height);

    if (this.state === 'TITLE_MENU') {
      ctx.fillStyle = '#1D182C';
      ctx.fillRect(14, 24, width - 28, height - 56);
      ctx.strokeStyle = '#F59E0B';
      ctx.strokeRect(14.5, 24.5, width - 29, height - 57);

      ctx.textAlign = 'center';
      ctx.fillStyle = '#F59E0B';
      ctx.font = 'bold 15px "JetBrains Mono", monospace';
      ctx.fillText('BRICK BREAKER', width / 2, 74);

      // Decorative bricks
      const colors = ['#F59E0B', '#EC4899', '#38BDF8', '#10B981'];
      colors.forEach((col, idx) => {
        ctx.fillStyle = col;
        ctx.fillRect(width / 2 - 58 + idx * 30, 114, 26, 12);
      });

      ctx.fillStyle = '#CBD5E1';
      ctx.font = '11px "Plus Jakarta Sans", sans-serif';
      ctx.fillText(`Kỷ lục: ${this.highScore}`, width / 2, 168);
      ctx.fillText('4/6: Di chuyển · 5/OK: Phóng bóng', width / 2, 194);
      ctx.fillText('Nhấn OK để bắt đầu', width / 2, 222);
      ctx.textAlign = 'left';
      return;
    }

    // HUD
    ctx.fillStyle = '#191627';
    ctx.fillRect(0, 0, width, 28);
    ctx.fillStyle = '#F59E0B';
    ctx.font = 'bold 11px "JetBrains Mono", monospace';
    ctx.fillText(`MẠNG:${this.lives}  MÀN:${this.level}`, 8, 18);
    ctx.textAlign = 'right';
    ctx.fillStyle = '#F8FAFC';
    ctx.fillText(`ĐIỂM:${this.score}`, width - 8, 18);
    ctx.textAlign = 'left';

    // Bricks
    for (const br of this.bricks) {
      ctx.fillStyle = br.hp > 1 ? '#CBD5E1' : br.color;
      ctx.fillRect(br.x, br.y, br.w, br.h);
      ctx.fillStyle = 'rgba(255,255,255,0.22)';
      ctx.fillRect(br.x, br.y, br.w, 3);
    }

    // Paddle
    ctx.fillStyle = '#F59E0B';
    ctx.fillRect(this.paddle.x, this.h - 38, this.paddle.w, this.paddle.h);
    ctx.fillStyle = '#FEF3C7';
    ctx.fillRect(this.paddle.x + 4, this.h - 37, this.paddle.w - 8, 2);

    // Ball
    ctx.fillStyle = '#F8FAFC';
    ctx.beginPath();
    ctx.arc(this.ball.x, this.ball.y, this.ball.r, 0, Math.PI * 2);
    ctx.fill();

    if (this.state === 'PAUSED' || this.state === 'GAME_OVER') {
      ctx.fillStyle = 'rgba(18, 16, 27, 0.82)';
      ctx.fillRect(0, 0, width, height);
      ctx.textAlign = 'center';
      ctx.fillStyle = this.state === 'GAME_OVER' ? '#F87171' : '#F59E0B';
      ctx.font = 'bold 15px "JetBrains Mono", monospace';
      ctx.fillText(this.state === 'GAME_OVER' ? 'THUA CUỘC' : 'TẠM DỪNG', width / 2, height / 2 - 12);
      ctx.fillStyle = '#E2E8F0';
      ctx.font = '12px "Plus Jakarta Sans", sans-serif';
      ctx.fillText(`Điểm của bạn: ${this.score}`, width / 2, height / 2 + 12);
      ctx.textAlign = 'left';
    }
  }
}

export function createBuiltinGameEngine(id: BuiltinGameId): JavaGameEngine {
  switch (id) {
    case 'snake':
      return new SnakeClassicGame();
    case 'bounce':
      return new BounceClassicGame();
    case 'space':
      return new SpaceImpactGame();
    case 'brick':
      return new BrickBreakerGame();
  }
}
