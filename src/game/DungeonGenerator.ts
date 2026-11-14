import * as THREE from 'three';
import { AssetManager } from '../assets/AssetManager';
import { RoomData } from '../types';

export const TILE = 4.0;
export const ROOM_STEP = 28.0; // 5x5 room (20m) + 2-tile (8m) corridor = 28m center-to-center

export interface WalkRect {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface CircleObstacle {
  x: number;
  z: number;
  r: number;
}

export interface SpikeTrap {
  x: number;
  z: number;
  mesh: THREE.Object3D;
  phaseOffset: number;
  active: boolean;
}

export interface Interactable {
  id: string;
  kind: 'chest' | 'shrine' | 'trapdoor';
  x: number;
  z: number;
  mesh: THREE.Object3D;
  light?: THREE.PointLight;
  used: boolean;
  label: string;
}

interface TorchLight {
  light: THREE.PointLight;
  baseIntensity: number;
  seed: number;
}

export class DungeonFloorBuilder {
  public group = new THREE.Group();
  public rooms: RoomData[] = [];
  public walkRects: WalkRect[] = [];
  public obstacles: CircleObstacle[] = [];
  public traps: SpikeTrap[] = [];
  public interactables: Interactable[] = [];
  private torches: TorchLight[] = [];
  private doorGates: THREE.Object3D[] = [];
  public gatesLocked = false;
  private gateLerp = 0;

  constructor(private assets: AssetManager) {}

  public generate(floorNum: number): void {
    this.clear();

    // Generate 6-7 connected rooms on a grid
    const targetRooms = Math.min(8, 6 + Math.floor((floorNum - 1) / 2));
    const grid = new Map<string, RoomData>();
    const dirs = [
      { dx: 0, dy: -1, key: 'n' as const, opp: 's' as const },
      { dx: 0, dy: 1, key: 's' as const, opp: 'n' as const },
      { dx: 1, dy: 0, key: 'e' as const, opp: 'w' as const },
      { dx: -1, dy: 0, key: 'w' as const, opp: 'e' as const },
    ];

    const startRoom: RoomData = {
      gx: 0,
      gy: 0,
      type: 'start',
      widthTiles: 5,
      depthTiles: 5,
      worldX: 0,
      worldZ: 0,
      cleared: true,
      discovered: true,
      doors: {},
    };
    grid.set('0,0', startRoom);
    const list: RoomData[] = [startRoom];

    while (list.length < targetRooms) {
      const parent = list[Math.floor(Math.random() * list.length)];
      const d = dirs[Math.floor(Math.random() * dirs.length)];
      const nx = parent.gx + d.dx;
      const ny = parent.gy + d.dy;
      const k = `${nx},${ny}`;
      if (!grid.has(k)) {
        const room: RoomData = {
          gx: nx,
          gy: ny,
          type: 'combat',
          widthTiles: 5,
          depthTiles: 5,
          worldX: nx * ROOM_STEP,
          worldZ: ny * ROOM_STEP,
          cleared: false,
          discovered: false,
          doors: {},
        };
        parent.doors[d.key] = true;
        room.doors[d.opp] = true;
        grid.set(k, room);
        list.push(room);
      }
    }

    // Assign farthest room as Boss Chamber
    let bossRoom = list[list.length - 1];
    let maxDist = -1;
    for (const r of list) {
      if (r === startRoom) continue;
      const dist = Math.abs(r.gx) + Math.abs(r.gy);
      if (dist > maxDist) {
        maxDist = dist;
        bossRoom = r;
      }
    }
    bossRoom.type = 'boss';
    bossRoom.widthTiles = 7;
    bossRoom.depthTiles = 7;

    // Assign 1 treasure room & 1 trap room from remaining
    const middle = list.filter((r) => r !== startRoom && r !== bossRoom);
    if (middle.length >= 1) {
      middle[0].type = 'treasure';
      middle[0].cleared = true;
    }
    if (middle.length >= 2) {
      middle[1].type = 'trap';
    }

    this.rooms = list;
    this.buildGeometry(grid);
  }

  private buildGeometry(grid: Map<string, RoomData>): void {
    const builtCorridors = new Set<string>();

    for (const room of this.rooms) {
      this.buildRoom(room);

      // Build corridors to neighbors (East and South only to avoid duplicates)
      if (room.doors.e) {
        const neighbor = grid.get(`${room.gx + 1},${room.gy}`);
        if (neighbor) {
          const key = `${room.gx},${room.gy}-e`;
          if (!builtCorridors.has(key)) {
            builtCorridors.add(key);
            this.buildCorridor(room, neighbor, 'x');
          }
        }
      }
      if (room.doors.s) {
        const neighbor = grid.get(`${room.gx},${room.gy + 1}`);
        if (neighbor) {
          const key = `${room.gx},${room.gy}-s`;
          if (!builtCorridors.has(key)) {
            builtCorridors.add(key);
            this.buildCorridor(room, neighbor, 'z');
          }
        }
      }
    }
  }

  private buildRoom(room: RoomData): void {
    const hw = (room.widthTiles * TILE) / 2;
    const hd = (room.depthTiles * TILE) / 2;
    const halfW = Math.floor(room.widthTiles / 2);
    const halfD = Math.floor(room.depthTiles / 2);

    // Walkable AABB (with 0.65m wall margin)
    this.walkRects.push({
      minX: room.worldX - hw + 0.65,
      maxX: room.worldX + hw - 0.65,
      minZ: room.worldZ - hd + 0.65,
      maxZ: room.worldZ + hd - 0.65,
    });

    // Floor tiles
    for (let ix = -halfW; ix <= halfW; ix++) {
      for (let iz = -halfD; iz <= halfD; iz++) {
        const wx = room.worldX + ix * TILE;
        const wz = room.worldZ + iz * TILE;
        const isCenter = ix === 0 && iz === 0;
        const tileName =
          room.type === 'boss' && Math.abs(ix) <= 1 && Math.abs(iz) <= 1
            ? 'dungeon/tileBrickB_largeCrackedA.gltf.glb'
            : (ix + iz) % 2 === 0
              ? 'dungeon/tileBrickA_medium.gltf.glb'
              : 'dungeon/tileBrickB_medium.gltf.glb';
        const tile = this.assets.cloneProp(tileName);
        tile.position.set(wx, -1.04, wz);
        if (!isCenter && Math.random() < 0.35) {
          tile.rotation.y = (Math.floor(Math.random() * 4) * Math.PI) / 2;
        }
        this.group.add(tile);
      }
    }

    // Perimeter Walls + Doorways
    const placeWallSeg = (wx: number, wz: number, rotY: number, isDoor: boolean) => {
      if (isDoor) {
        const arch = this.assets.cloneProp('dungeon/wall_gate.gltf.glb');
        arch.position.set(wx, -0.4, wz);
        arch.rotation.y = rotY;
        this.group.add(arch);

        const gate = this.assets.cloneProp('dungeon/door_gate.gltf.glb');
        gate.position.set(wx, -3.2, wz); // starts open (retracted down)
        gate.rotation.y = rotY;
        this.group.add(gate);
        this.doorGates.push(gate);
      } else {
        const wallName = Math.random() < 0.16 ? 'dungeon/wall_broken.gltf.glb' : 'dungeon/wall.gltf.glb';
        const wall = this.assets.cloneProp(wallName);
        wall.position.set(wx, -0.4, wz);
        wall.rotation.y = rotY;
        this.group.add(wall);
      }
    };

    for (let ix = -halfW; ix <= halfW; ix++) {
      const wx = room.worldX + ix * TILE;
      placeWallSeg(wx, room.worldZ - hd, 0, ix === 0 && !!room.doors.n);
      placeWallSeg(wx, room.worldZ + hd, Math.PI, ix === 0 && !!room.doors.s);
    }
    for (let iz = -halfD; iz <= halfD; iz++) {
      const wz = room.worldZ + iz * TILE;
      placeWallSeg(room.worldX - hw, wz, Math.PI / 2, iz === 0 && !!room.doors.w);
      placeWallSeg(room.worldX + hw, wz, -Math.PI / 2, iz === 0 && !!room.doors.e);
    }

    // Wall Torches with warm flickering lights
    const torchPositions = [
      { x: room.worldX - hw + 0.55, z: room.worldZ - TILE, ry: Math.PI / 2 },
      { x: room.worldX + hw - 0.55, z: room.worldZ + TILE, ry: -Math.PI / 2 },
      { x: room.worldX + TILE, z: room.worldZ - hd + 0.55, ry: 0 },
    ];
    for (let i = 0; i < torchPositions.length; i++) {
      const tp = torchPositions[i];
      const torch = this.assets.cloneProp('dungeon/torchWall.gltf.glb');
      torch.position.set(tp.x, 2.1, tp.z);
      torch.rotation.y = tp.ry;
      this.group.add(torch);

      if (i < 2 || room.type === 'boss' || room.type === 'treasure') {
        const light = new THREE.PointLight(0xff8a33, room.type === 'boss' ? 18 : 14, 18, 1.6);
        light.position.set(tp.x, 2.5, tp.z);
        this.group.add(light);
        this.torches.push({ light, baseIntensity: light.intensity, seed: Math.random() * 100 });
      }
    }

    // Room-specific props & interactables
    if (room.type === 'combat' || room.type === 'boss') {
      const offset = room.type === 'boss' ? 6.5 : 4.5;
      const pillarSpots = [
        [room.worldX - offset, room.worldZ - offset],
        [room.worldX + offset, room.worldZ - offset],
        [room.worldX - offset, room.worldZ + offset],
        [room.worldX + offset, room.worldZ + offset],
      ];
      for (const [px, pz] of pillarSpots) {
        const pName = Math.random() < 0.25 ? 'dungeon/pillar_broken.gltf.glb' : 'dungeon/pillar.gltf.glb';
        const pillar = this.assets.cloneProp(pName);
        pillar.position.set(px, 0, pz);
        this.group.add(pillar);
        this.obstacles.push({ x: px, z: pz, r: 0.9 });
      }
    }

    if (room.type === 'trap') {
      const offsets = [-TILE, 0, TILE];
      for (const ox of offsets) {
        for (const oz of offsets) {
          if (Math.abs(ox) === TILE && Math.abs(oz) === TILE) continue;
          const spikes = this.assets.cloneProp('dungeon/tileSpikes.gltf.glb');
          spikes.position.set(room.worldX + ox, -0.45, room.worldZ + oz);
          this.group.add(spikes);
          this.traps.push({
            x: room.worldX + ox,
            z: room.worldZ + oz,
            mesh: spikes,
            phaseOffset: (ox + oz) * 0.35,
            active: false,
          });
        }
      }
    }

    if (room.type === 'treasure') {
      this.spawnChest(room.worldX - 2.4, room.worldZ - 1.5, 'rare');
      this.spawnShrine(room.worldX + 2.4, room.worldZ - 1.5);
    }

    if (room.type === 'start') {
      const banner = this.assets.cloneProp('dungeon/banner.gltf.glb');
      banner.position.set(room.worldX, 0.2, room.worldZ - hd + 0.7);
      this.group.add(banner);
    }

    // Corner crates/barrels for dungeon flavor
    if (room.type !== 'start') {
      const barrel = this.assets.cloneProp('dungeon/barrel.gltf.glb');
      barrel.position.set(room.worldX - hw + 1.5, 0, room.worldZ + hd - 1.5);
      this.group.add(barrel);
      const crate = this.assets.cloneProp('dungeon/crate.gltf.glb');
      crate.position.set(room.worldX + hw - 1.5, 0, room.worldZ - hd + 1.5);
      this.group.add(crate);
    }
  }

  private buildCorridor(a: RoomData, b: RoomData, axis: 'x' | 'z'): void {
    const startEdge = axis === 'x' ? a.worldX + (a.widthTiles * TILE) / 2 : a.worldZ + (a.depthTiles * TILE) / 2;
    const endEdge = axis === 'x' ? b.worldX - (b.widthTiles * TILE) / 2 : b.worldZ - (b.depthTiles * TILE) / 2;
    const span = endEdge - startEdge;
    if (span <= 0.1) return;

    const steps = Math.max(1, Math.round(span / TILE));
    const fixedCoord = axis === 'x' ? a.worldZ : a.worldX;

    this.walkRects.push(
      axis === 'x'
        ? { minX: startEdge - 1.0, maxX: endEdge + 1.0, minZ: fixedCoord - 1.45, maxZ: fixedCoord + 1.45 }
        : { minX: fixedCoord - 1.45, maxX: fixedCoord + 1.45, minZ: startEdge - 1.0, maxZ: endEdge + 1.0 }
    );

    for (let i = 0; i < steps; i++) {
      const c = startEdge + TILE * 0.5 + i * TILE;
      const wx = axis === 'x' ? c : fixedCoord;
      const wz = axis === 'x' ? fixedCoord : c;

      const tile = this.assets.cloneProp('dungeon/tileBrickA_medium.gltf.glb');
      tile.position.set(wx, -1.04, wz);
      this.group.add(tile);

      // Corridor side walls
      if (axis === 'x') {
        const w1 = this.assets.cloneProp('dungeon/wall.gltf.glb');
        w1.position.set(wx, -0.4, wz - TILE / 2);
        const w2 = this.assets.cloneProp('dungeon/wall.gltf.glb');
        w2.position.set(wx, -0.4, wz + TILE / 2);
        w2.rotation.y = Math.PI;
        this.group.add(w1, w2);
      } else {
        const w1 = this.assets.cloneProp('dungeon/wall.gltf.glb');
        w1.position.set(wx - TILE / 2, -0.4, wz);
        w1.rotation.y = Math.PI / 2;
        const w2 = this.assets.cloneProp('dungeon/wall.gltf.glb');
        w2.position.set(wx + TILE / 2, -0.4, wz);
        w2.rotation.y = -Math.PI / 2;
        this.group.add(w1, w2);
      }
    }
  }

  public spawnChest(x: number, z: number, rarity: 'common' | 'rare' = 'common'): void {
    const path = rarity === 'rare' ? 'dungeon/chest_rare.gltf.glb' : 'dungeon/chest_uncommon.gltf.glb';
    const mesh = this.assets.cloneProp(path);
    mesh.position.set(x, 0, z);
    this.group.add(mesh);
    const light = new THREE.PointLight(rarity === 'rare' ? 0xffd54f : 0x38bdf8, 8, 7);
    light.position.set(x, 1.2, z);
    this.group.add(light);
    this.interactables.push({
      id: `chest_${Math.random()}`,
      kind: 'chest',
      x,
      z,
      mesh,
      light,
      used: false,
      label: 'Press [E] Open Chest',
    });
  }

  public spawnShrine(x: number, z: number): void {
    const mesh = this.assets.cloneProp('dungeon/artifact.gltf.glb');
    mesh.position.set(x, 0.2, z);
    mesh.scale.setScalar(1.35);
    this.group.add(mesh);
    const light = new THREE.PointLight(0xa855f7, 14, 9);
    light.position.set(x, 1.8, z);
    this.group.add(light);
    this.interactables.push({
      id: `shrine_${Math.random()}`,
      kind: 'shrine',
      x,
      z,
      mesh,
      light,
      used: false,
      label: 'Press [E] Commune with Relic Shrine',
    });
  }

  public spawnTrapdoor(x: number, z: number): void {
    const mesh = this.assets.cloneProp('dungeon/trapdoor.gltf.glb');
    mesh.position.set(x, 0.05, z);
    mesh.scale.setScalar(1.3);
    this.group.add(mesh);
    const light = new THREE.PointLight(0x34d399, 16, 10);
    light.position.set(x, 1.2, z);
    this.group.add(light);
    this.interactables.push({
      id: `trapdoor_${Math.random()}`,
      kind: 'trapdoor',
      x,
      z,
      mesh,
      light,
      used: false,
      label: 'Press [E] Descend Deeper',
    });
  }

  public isWalkable(x: number, z: number, radius = 0.45): boolean {
    let inside = false;
    for (const r of this.walkRects) {
      if (x >= r.minX + radius && x <= r.maxX - radius && z >= r.minZ + radius && z <= r.maxZ - radius) {
        inside = true;
        break;
      }
    }
    if (!inside) return false;
    for (const obs of this.obstacles) {
      const dx = x - obs.x;
      const dz = z - obs.z;
      if (dx * dx + dz * dz < (obs.r + radius) * (obs.r + radius)) return false;
    }
    return true;
  }

  public getRoomAt(x: number, z: number): RoomData | null {
    for (const r of this.rooms) {
      const hw = (r.widthTiles * TILE) / 2;
      const hd = (r.depthTiles * TILE) / 2;
      if (Math.abs(x - r.worldX) <= hw && Math.abs(z - r.worldZ) <= hd) {
        return r;
      }
    }
    return null;
  }

  public update(dt: number, elapsed: number): void {
    // Flicker wall torches
    for (const t of this.torches) {
      const f = Math.sin(elapsed * 9.5 + t.seed) * 0.12 + Math.sin(elapsed * 23 + t.seed * 2) * 0.06;
      t.light.intensity = t.baseIntensity * (1 + f);
    }

    // Animate door gates
    const target = this.gatesLocked ? 1 : 0;
    this.gateLerp += (target - this.gateLerp) * Math.min(1, dt * 8);
    const gateY = -3.2 + this.gateLerp * 2.8;
    for (const g of this.doorGates) {
      g.position.y = gateY;
    }

    // Animate spike traps (cycle every 2.8s)
    for (const trap of this.traps) {
      const cycle = ((elapsed + trap.phaseOffset) % 2.8) / 2.8;
      trap.active = cycle > 0.62 && cycle < 0.88;
      const targetY = trap.active ? 0.15 : cycle > 0.48 && cycle <= 0.62 ? -0.25 : -0.58;
      trap.mesh.position.y += (targetY - trap.mesh.position.y) * Math.min(1, dt * 16);
    }

    // Pulse shrines
    for (const item of this.interactables) {
      if (item.kind === 'shrine' && !item.used) {
        item.mesh.rotation.y += dt * 0.9;
      }
    }
  }

  public clear(): void {
    while (this.group.children.length > 0) {
      this.group.remove(this.group.children[0]);
    }
    this.rooms = [];
    this.walkRects = [];
    this.obstacles = [];
    this.traps = [];
    this.interactables = [];
    this.torches = [];
    this.doorGates = [];
    this.gatesLocked = false;
    this.gateLerp = 0;
  }
}
