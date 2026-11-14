import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';

export class AssetManager {
  private loader = new GLTFLoader();
  private texLoader = new THREE.TextureLoader();

  private models = new Map<string, THREE.Group>();
  private clips = new Map<string, THREE.AnimationClip>();
  private modelClips = new Map<string, Map<string, THREE.AnimationClip>>();
  private sharedPaletteMaterials = new Map<string, THREE.MeshStandardMaterial>();
  private sharedDungeonMaterials = new Map<string, THREE.Material>();

  public async preloadAll(onProgress: (pct: number, label: string) => void): Promise<void> {
    const modelPaths = [
      // Characters
      'characters/Knight.glb',
      'characters/Barbarian.glb',
      'characters/Rogue_Hooded.glb',
      'characters/Mage.glb',
      'characters/Ranger.glb',
      'characters/Skeleton_Warrior.glb',
      'characters/Skeleton_Minion.glb',
      'characters/Skeleton_Rogue.glb',
      'characters/Skeleton_Mage.glb',
      // Bestiary & Ultimate Monsters
      'monsters/Imp.glb',
      'monsters/Puglin.glb',
      'monsters/Demon.gltf',
      'monsters/Orc.gltf',
      'monsters/MushroomKing.gltf',
      'monsters/Dragon_Evolved.gltf',
      'monsters/Ghost_Skull.gltf',
      'monsters/GreenSpikyBlob.gltf',
      // Weapons & Shields
      'weapons/sword_1handed.gltf',
      'weapons/shield_badge_color.gltf',
      'weapons/axe_2handed.gltf',
      'weapons/dagger.gltf',
      'weapons/staff.gltf',
      'weapons/bow_withString.gltf',
      'weapons/arrow_bow.gltf',
      'weapons/Skeleton_Blade.gltf',
      'weapons/Skeleton_Shield_Small_A.gltf',
      'weapons/Skeleton_Shield_Large_A.gltf',
      'weapons/Skeleton_Crossbow.gltf',
      'weapons/Skeleton_Staff.gltf',
      'weapons/Skeleton_Axe.gltf',
      // Weapons Pack (Blender-aligned GLBs)
      'weapons/pack_sword_golden.glb',
      'weapons/pack_claymore.glb',
      'weapons/pack_axe_double.glb',
      'weapons/pack_hammer_double.glb',
      'weapons/pack_dagger.glb',
      'weapons/pack_bow_golden.glb',
      'weapons/pack_shield_celtic.glb',
      'weapons/pack_scythe.glb',
      // Dungeon Pack 1.0
      'dungeon/tileBrickA_medium.gltf.glb',
      'dungeon/tileBrickB_medium.gltf.glb',
      'dungeon/tileBrickB_largeCrackedA.gltf.glb',
      'dungeon/floorDecoration_tilesLarge.gltf.glb',
      'dungeon/wall.gltf.glb',
      'dungeon/wall_broken.gltf.glb',
      'dungeon/wall_door.gltf.glb',
      'dungeon/wall_gate.gltf.glb',
      'dungeon/wallCorner.gltf.glb',
      'dungeon/pillar.gltf.glb',
      'dungeon/pillar_broken.gltf.glb',
      'dungeon/torchWall.gltf.glb',
      'dungeon/torch.gltf.glb',
      'dungeon/chest_rare.gltf.glb',
      'dungeon/chest_uncommon.gltf.glb',
      'dungeon/barrel.gltf.glb',
      'dungeon/crate.gltf.glb',
      'dungeon/tileSpikes.gltf.glb',
      'dungeon/door_gate.gltf.glb',
      'dungeon/trapdoor.gltf.glb',
      'dungeon/banner.gltf.glb',
      'dungeon/artifact.gltf.glb',
      // Fantasy Props MegaKit
      'props_fantasy/Cauldron.gltf',
      'props_fantasy/Anvil.gltf',
      'props_fantasy/Banner_1.gltf',
      'props_fantasy/CandleStick_Triple.gltf',
      'props_fantasy/BookStand.gltf',
      'props_fantasy/Potion_1.gltf',
    ];

    const animPaths = [
      'animations/Rig_Medium_General.glb',
      'animations/Rig_Medium_MovementBasic.glb',
      'animations/Rig_Medium_MovementAdvanced.glb',
      'animations/Rig_Medium_CombatMelee.glb',
      'animations/Rig_Medium_CombatRanged.glb',
      'animations/Rig_Medium_Special.glb',
      'animations/Rig_Medium_UAL2.glb',
    ];

    const textures = [
      'characters/knight_texture.png',
      'characters/barbarian_texture.png',
      'characters/rogue_texture.png',
      'characters/mage_texture.png',
      'characters/ranger_texture.png',
      'characters/skeleton_texture.png',
    ];

    const total = textures.length + animPaths.length + modelPaths.length;
    let done = 0;

    // 1. Pre-create shared 1024x1024 KayKit palette MeshStandardMaterials
    for (const texPath of textures) {
      await new Promise<void>((resolve) => {
        this.texLoader.load(
          `./assets/${texPath}`,
          (tex) => {
            tex.colorSpace = THREE.SRGBColorSpace;
            tex.flipY = false;
            const mat = new THREE.MeshStandardMaterial({
              map: tex,
              roughness: 0.78,
              metalness: 0.1,
            });
            const key = texPath.split('/').pop()!;
            this.sharedPaletteMaterials.set(key, mat);
            resolve();
          },
          undefined,
          () => resolve()
        );
      });
      done++;
      onProgress((done / total) * 100, 'Loading KayKit palettes...');
    }

    // 2. Load animation packs
    for (const animPath of animPaths) {
      const gltf = await this.loader.loadAsync(`./assets/${animPath}`);
      for (const clip of gltf.animations) {
        this.clips.set(clip.name, clip);
      }
      done++;
      onProgress((done / total) * 100, 'Loading character animations...');
    }

    // 3. Load models & unify materials
    for (const path of modelPaths) {
      const gltf = await this.loader.loadAsync(`./assets/${path}`);
      this.unifyMaterials(gltf.scene, path);
      this.models.set(path, gltf.scene);
      if (gltf.animations && gltf.animations.length > 0) {
        const clipMap = new Map<string, THREE.AnimationClip>();
        for (const clip of gltf.animations) {
          clipMap.set(clip.name, clip);
        }
        this.modelClips.set(path, clipMap);
      }
      done++;
      onProgress((done / total) * 100, `Loading ${path.split('/').pop()}...`);
    }
  }

  private unifyMaterials(root: THREE.Object3D, assetPath: string): void {
    const isDungeon = assetPath.startsWith('dungeon/');
    const isMonster = assetPath.startsWith('monsters/');
    const isFantasyProp = assetPath.startsWith('props_fantasy/');
    const isPackWeapon = assetPath.startsWith('weapons/pack_');
    root.traverse((obj) => {
      if (!(obj instanceof THREE.Mesh)) return;
      obj.castShadow = true;
      obj.receiveShadow = true;

      if (isMonster || isFantasyProp) return;
      if (isPackWeapon) {
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        for (const m of mats) {
          if (m instanceof THREE.MeshStandardMaterial) {
            m.opacity = 1;
            m.alphaTest = 0;
            m.transparent = false;
            if (/gold|steel|iron|silver|blade/i.test(m.name)) {
              m.metalness = 0.55;
              m.roughness = 0.32;
            }
            m.needsUpdate = true;
          }
        }
        return;
      }
      const origMat = obj.material as THREE.MeshStandardMaterial;
      if (!origMat) return;

      if (isDungeon) {
        const key = origMat.name || `dung_${origMat.color?.getHexString() ?? 'default'}`;
        let shared = this.sharedDungeonMaterials.get(key);
        if (!shared) {
          shared = origMat;
          if (shared instanceof THREE.MeshStandardMaterial) {
            shared.roughness = Math.max(shared.roughness ?? 0.8, 0.72);
          }
          this.sharedDungeonMaterials.set(key, shared);
        }
        obj.material = shared;
      } else {
        // Match character/weapon to its single shared 1024x1024 KayKit palette material
        const paletteKey = this.resolvePaletteKey(assetPath, origMat.name);
        if (paletteKey && this.sharedPaletteMaterials.has(paletteKey)) {
          // Keep emissive glow materials on skeleton eyes if named "Glow"
          if (/glow/i.test(origMat.name)) {
            origMat.emissive = new THREE.Color(0x55ffaa);
            origMat.emissiveIntensity = 1.6;
          } else {
            obj.material = this.sharedPaletteMaterials.get(paletteKey)!;
          }
        }
      }
    });
  }

  private resolvePaletteKey(assetPath: string, matName: string): string | null {
    const lower = `${assetPath} ${matName}`.toLowerCase();
    if (lower.includes('skeleton')) return 'skeleton_texture.png';
    if (lower.includes('knight') || lower.includes('sword') || lower.includes('shield')) return 'knight_texture.png';
    if (lower.includes('barbarian') || lower.includes('axe')) return 'barbarian_texture.png';
    if (lower.includes('rogue') || lower.includes('dagger')) return 'rogue_texture.png';
    if (lower.includes('mage') || lower.includes('staff')) return 'mage_texture.png';
    if (lower.includes('ranger') || lower.includes('bow') || lower.includes('arrow')) return 'ranger_texture.png';
    return null;
  }

  public cloneProp(path: string): THREE.Group {
    const src = this.models.get(path);
    if (!src) {
      console.warn(`Missing prop model: ${path}`);
      return new THREE.Group();
    }
    return src.clone(true);
  }

  public cloneCharacter(path: string): THREE.Group {
    const src = this.models.get(path);
    if (!src) {
      console.warn(`Missing character model: ${path}`);
      return new THREE.Group();
    }
    return SkeletonUtils.clone(src) as THREE.Group;
  }

  public attachToHand(character: THREE.Object3D, weaponPath: string, hand: 'right' | 'left'): void {
    const rawSlot = hand === 'right' ? 'handslot.r' : 'handslot.l';
    const sanitizedSlot = hand === 'right' ? 'handslotr' : 'handslotl';
    const fallbackHand = hand === 'right' ? 'handr' : 'handl';
    const bone =
      character.getObjectByName(sanitizedSlot) ??
      character.getObjectByName(rawSlot) ??
      character.getObjectByName(fallbackHand);
    if (!bone) return;
    while (bone.children.length > 0) {
      bone.remove(bone.children[0]);
    }
    const weapon = this.cloneProp(weaponPath);
    const isPack = weaponPath.startsWith('weapons/pack_');
    weapon.scale.setScalar(isPack ? 1.05 : weaponPath.includes('shield') ? 1.25 : 1.45);
    if (weaponPath.includes('bow')) {
      weapon.rotation.set(0, Math.PI * 0.5, 0);
    } else if (weaponPath.includes('shield')) {
      weapon.rotation.set(0, Math.PI * 0.5, 0);
    }
    bone.add(weapon);
  }

  public getClip(name: string): THREE.AnimationClip | undefined {
    return this.clips.get(name);
  }

  public getModelClips(path: string): Map<string, THREE.AnimationClip> | undefined {
    return this.modelClips.get(path);
  }
}
