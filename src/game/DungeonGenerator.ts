import * as THREE from 'three';
import { AssetManager } from '../assets/AssetManager';
import { RoomData, TownNpcId } from '../types';

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
  kind: 'chest' | 'shrine' | 'trapdoor' | 'npc';
  npcId?: TownNpcId;
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
  public lockedRoom: RoomData | null = null;
  private gateLerp = 0;

  constructor(private assets: AssetManager) {}

  public generate(floorNum: number): void {
    this.clear();
    if (floorNum === 0) {
      this.buildOakhavenTown();
      return;
    }

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
    this.buildGeometry(grid, floorNum);
  }

  private buildGeometry(grid: Map<string, RoomData>, floorNum: number): void {
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

    // Apply Biome Tinting to reused dungeon meshes
    if (floorNum === 2) {
      // Floor 2: Overgrown Subterranean Ruins (emerald moss tint)
      this.group.traverse((obj) => {
        if (obj instanceof THREE.Mesh && obj.material instanceof THREE.MeshStandardMaterial) {
          obj.material = obj.material.clone();
          obj.material.color.multiply(new THREE.Color(0x9be7b0));
        }
      });
    } else if (floorNum >= 3) {
      // Floor 3+: Obsidian Spire Core (obsidian & crimson tint)
      this.group.traverse((obj) => {
        if (obj instanceof THREE.Mesh && obj.material instanceof THREE.MeshStandardMaterial) {
          obj.material = obj.material.clone();
          obj.material.color.multiply(new THREE.Color(0x8b6ba8));
        }
      });
    }
  }

  private createNpcLabelSprite(text: string, colorHex: string): THREE.Sprite {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 96;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = 'rgba(10, 14, 24, 0.82)';
    ctx.beginPath();
    ctx.roundRect(16, 14, 480, 68, 16);
    ctx.fill();
    ctx.strokeStyle = colorHex;
    ctx.lineWidth = 4;
    ctx.stroke();
    ctx.font = 'bold 30px Segoe UI, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = colorHex;
    ctx.fillText(text, 256, 48);

    const tex = new THREE.CanvasTexture(canvas);
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(3.2, 0.6, 1);
    return sprite;
  }

  private buildOakhavenTown(): void {
    const townRoom: RoomData = {
      gx: 0,
      gy: 0,
      type: 'start',
      widthTiles: 7,
      depthTiles: 7,
      worldX: 0,
      worldZ: 0,
      cleared: true,
      discovered: true,
      doors: {},
    };
    this.rooms = [townRoom];
    const hw = (7 * TILE) / 2;
    this.walkRects.push({
      minX: -hw + 0.8,
      maxX: hw - 0.8,
      minZ: -hw + 0.8,
      maxZ: hw - 0.8,
    });

    for (let ix = -3; ix <= 3; ix++) {
      for (let iz = -3; iz <= 3; iz++) {
        const tile = this.assets.cloneProp((ix + iz) % 2 === 0 ? 'dungeon/tileBrickA_medium.gltf.glb' : 'dungeon/tileBrickB_medium.gltf.glb');
        tile.position.set(ix * TILE, -1.04, iz * TILE);
        this.group.add(tile);
      }
    }

    for (let i = -3; i <= 3; i++) {
      const segs = [
        { x: i * TILE, z: -hw, ry: 0 },
        { x: i * TILE, z: hw, ry: Math.PI },
        { x: -hw, z: i * TILE, ry: Math.PI / 2 },
        { x: hw, z: i * TILE, ry: -Math.PI / 2 },
      ];
      for (const s of segs) {
        const w = this.assets.cloneProp('dungeon/wall.gltf.glb');
        w.position.set(s.x, 0, s.z);
        w.rotation.y = s.ry;
        this.group.add(w);
      }
    }

    const townLight = new THREE.PointLight(0xffdca8, 3.2, 34);
    townLight.position.set(0, 6.5, 0);
    this.group.add(townLight);

    const npcs: Array<{
      npcId: TownNpcId;
      model: string;
      prop?: string;
      x: number;
      z: number;
      ry: number;
      tag: string;
      color: string;
      prompt: string;
    }> = [
      {
        npcId: 'blacksmith',
        model: 'Barbarian.glb',
        prop: 'props_fantasy/Anvil.gltf',
        x: -7.5,
        z: -5.5,
        ry: 0.6,
        tag: '[⚒] Blacksmith (Refine)',
        color: '#f97316',
        prompt: '[E] Talk to Blacksmith (+1 to +10 Refine)',
      },
      {
        npcId: 'kafra',
        model: 'Ranger.glb',
        prop: 'dungeon/chest_rare.gltf.glb',
        x: 7.5,
        z: -5.5,
        ry: -0.6,
        tag: '[📦] Kafra Storage',
        color: '#38bdf8',
        prompt: '[E] Open Kafra Card Storage',
      },
      {
        npcId: 'hypnotist',
        model: 'Mage.glb',
        prop: 'props_fantasy/BookStand.gltf',
        x: -7.5,
        z: 5.5,
        ry: 2.5,
        tag: '[✦] Hypnotist (Reset)',
        color: '#c084fc',
        prompt: '[E] Talk to Hypnotist (Stat/Skill Reset)',
      },
      {
        npcId: 'alchemist',
        model: 'Rogue.glb',
        prop: 'props_fantasy/Cauldron.gltf',
        x: 7.5,
        z: 5.5,
        ry: -2.5,
        tag: '[⚗] Alchemist (Potions)',
        color: '#34d399',
        prompt: '[E] Buy Red/Blue Potions',
      },
      {
        npcId: 'guildmaster',
        model: 'Knight.glb',
        prop: 'props_fantasy/Banner_1.gltf',
        x: 0,
        z: -8.5,
        ry: 0,
        tag: '[!] Enter Dungeon',
        color: '#facc15',
        prompt: '[E] Enter Sunken Crypt (Floor 1)',
      },
    ];

    for (const n of npcs) {
      const charMesh = this.assets.cloneCharacter(n.model);
      charMesh.position.set(n.x, 0, n.z);
      charMesh.rotation.y = n.ry;
      this.group.add(charMesh);

      const labelSprite = this.createNpcLabelSprite(n.tag, n.color);
      labelSprite.position.set(n.x, 2.75, n.z);
      this.group.add(labelSprite);

      if (n.prop) {
        const propMesh = this.assets.cloneProp(n.prop);
        propMesh.position.set(n.x + (n.x < 0 ? 1.5 : -1.5), 0, n.z + 0.6);
        this.group.add(propMesh);
      }

      this.obstacles.push({ x: n.x, z: n.z, r: 0.75 });
      this.interactables.push({
        id: `npc_${n.npcId}`,
        kind: n.npcId === 'guildmaster' ? 'trapdoor' : 'npc',
        npcId: n.npcId,
        x: n.x,
        z: n.z,
        mesh: charMesh,
        used: false,
        label: n.prompt,
      });
    }

    const portal = this.assets.cloneProp('dungeon/trapdoor.gltf.glb');
    portal.position.set(0, 0.04, -10.5);
    this.group.add(portal);
    const portalLight = new THREE.PointLight(0x38bdf8, 3.0, 9);
    portalLight.position.set(0, 1.5, -10.5);
    this.group.add(portalLight);
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
        const arch = this.assets.cloneProp('dungeon/wall_door.gltf.glb');
        arch.position.set(wx, -0.4, wz);
        arch.rotation.y = rotY;
        this.group.add(arch);

        // Hinged iron gate inside the doorway: swings open 105 deg when unlocked, closes to 0 when locked
        const hinge = new THREE.Group();
        hinge.position.set(wx, 1.08, wz);
        hinge.rotation.y = rotY;
        const gatePivot = new THREE.Group();
        gatePivot.position.set(-1.0, 0, 0);
        const gate = this.assets.cloneProp('dungeon/door_gate.gltf.glb');
        gatePivot.add(gate);
        hinge.add(gatePivot);
        this.group.add(hinge);
        this.doorGates.push(gatePivot);
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
      for (const side of [-1, 1]) {
        const candle = this.assets.cloneProp('props_fantasy/CandleStick_Triple.gltf');
        candle.position.set(room.worldX + side * 4.4, 0, room.worldZ - 1.5);
        candle.scale.setScalar(1.25);
        this.group.add(candle);
      }
    }

    if (room.type === 'start') {
      const banner = this.assets.cloneProp('dungeon/banner.gltf.glb');
      banner.position.set(room.worldX, 0.2, room.worldZ - hd + 0.7);
      this.group.add(banner);

      const bookStand = this.assets.cloneProp('props_fantasy/BookStand.gltf');
      bookStand.position.set(room.worldX - hw + 2.0, 0, room.worldZ - hd + 2.0);
      bookStand.rotation.y = Math.PI * 0.25;
      this.group.add(bookStand);

      const candle = this.assets.cloneProp('props_fantasy/CandleStick_Triple.gltf');
      candle.position.set(room.worldX + hw - 2.0, 0, room.worldZ - hd + 2.0);
      candle.scale.setScalar(1.25);
      this.group.add(candle);
    }

    if (room.type === 'boss') {
      for (const side of [-1, 1]) {
        const banner = this.assets.cloneProp('props_fantasy/Banner_1.gltf');
        banner.position.set(room.worldX + side * 5.2, 0, room.worldZ - hd + 1.0);
        banner.scale.setScalar(1.15);
        this.group.add(banner);
      }
    }

    // Corner crates/barrels & fantasy props for dungeon flavor
    if (room.type !== 'start') {
      const barrel = this.assets.cloneProp('dungeon/barrel.gltf.glb');
      barrel.position.set(room.worldX - hw + 1.5, 0, room.worldZ + hd - 1.5);
      this.group.add(barrel);
      const crate = this.assets.cloneProp('dungeon/crate.gltf.glb');
      crate.position.set(room.worldX + hw - 1.5, 0, room.worldZ - hd + 1.5);
      this.group.add(crate);

      const propList = [
        'props_fantasy/Cauldron.gltf',
        'props_fantasy/Anvil.gltf',
        'props_fantasy/BookStand.gltf',
        'props_fantasy/CandleStick_Triple.gltf',
      ];
      const roomSeed = Math.abs(Math.round(room.worldX + room.worldZ));
      const fantasyPropPath = propList[roomSeed % propList.length];
      const fProp = this.assets.cloneProp(fantasyPropPath);
      fProp.position.set(room.worldX - hw + 1.8, 0, room.worldZ - hd + 1.8);
      fProp.rotation.y = (roomSeed * 0.8) % (Math.PI * 2);
      if (fantasyPropPath.includes('CandleStick')) fProp.scale.setScalar(1.25);
      this.group.add(fProp);
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
        ? { minX: startEdge - 2.5, maxX: endEdge + 2.5, minZ: fixedCoord - 1.5, maxZ: fixedCoord + 1.5 }
        : { minX: fixedCoord - 1.5, maxX: fixedCoord + 1.5, minZ: startEdge - 2.5, maxZ: endEdge + 2.5 }
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
    if (this.gatesLocked && this.lockedRoom) {
      const hw = (this.lockedRoom.widthTiles * TILE) / 2;
      const hd = (this.lockedRoom.depthTiles * TILE) / 2;
      const minX = this.lockedRoom.worldX - hw + 0.65 + radius;
      const maxX = this.lockedRoom.worldX + hw - 0.65 - radius;
      const minZ = this.lockedRoom.worldZ - hd + 0.65 + radius;
      const maxZ = this.lockedRoom.worldZ + hd - 0.65 - radius;
      if (x < minX || x > maxX || z < minZ || z > maxZ) return false;
    }

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

  public getRoomAt(x: number, z: number, margin = 0): RoomData | null {
    for (const r of this.rooms) {
      const hw = (r.widthTiles * TILE) / 2 - margin;
      const hd = (r.depthTiles * TILE) / 2 - margin;
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

    // Animate swinging door gates (0 = closed, 1 = swung open 105 deg)
    const target = this.gatesLocked ? 0 : 1;
    this.gateLerp += (target - this.gateLerp) * Math.min(1, dt * 8);
    const openAngle = this.gateLerp * (Math.PI * 0.58);
    for (const g of this.doorGates) {
      g.rotation.y = openAngle;
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
    this.lockedRoom = null;
    this.gateLerp = 1;
  }
}
