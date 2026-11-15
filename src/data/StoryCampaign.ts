import * as THREE from 'three';
import { CutsceneDirector } from '../systems/CutsceneDirector';

export async function runAct0Foreclosure(d: CutsceneDirector, playerPos: THREE.Vector3): Promise<void> {
  await d.fadeScreen(true, 0.05);
  d.spawnActor('ledger', 'dungeon/artifact.gltf.glb', new THREE.Vector3(0, 1.8, -5.0), {
    scale: 1.4,
    tintHex: 0xfacc15,
  });
  d.spawnActor('vance', 'characters/Mage.glb', new THREE.Vector3(0, 0, -6.5), {
    tintHex: 0xdc2626,
    rightWeapon: 'weapons/pack_scythe.glb',
    idleClip: 'Idle_A',
  });

  await d.moveCameraTo(new THREE.Vector3(0, 3.2, -1.5), new THREE.Vector3(0, 1.8, -5.5), 0.1);
  await d.fadeScreen(false, 1.1);
  await d.showChapterCard('PROLOGUE', 'THE FORECLOSURE OF OAKHAVEN', 'Ledger of Souls — Page I', 2.4);

  // Crane shot & player walk up to Mayor Vance
  await Promise.all([
    d.moveCameraTo(new THREE.Vector3(5.5, 6.0, 5.5), new THREE.Vector3(0, 1.3, -4.5), 2.0),
    d.moveActor('player', new THREE.Vector3(0, 0, -2.5), 'Running_A', 1.6),
  ]);
  d.rotateActorToward('vance', new THREE.Vector3(0, 0, -2.5));

  await d.say(
    'Mayor Vance',
    'Architect of Oakhaven',
    '#dc2626',
    'Ah, the Royal Relic Auditor! Right on schedule to inspect our books... though I fear the ink has already dried.'
  );

  d.playAnimation('vance', 'Ranged_Magic_Summon', false);
  d.shakeCamera(0.45, 0.7);
  d.spawnVFXBurst(new THREE.Vector3(0, 1.2, -6.5), 0xa855f7, 36);
  d.spawnVFXBurst(playerPos.clone().add(new THREE.Vector3(0, 1.0, 0)), 0xa855f7, 22);
  await d.wait(0.85);

  await d.say(
    'Mayor Vance',
    'Architect of the Pact',
    '#a855f7',
    'I did not embezzle Oakhaven’s gold—I sold its souls to the Abyssal Warden beneath the Spire! Every hour the Core stays unsealed, the Ledger claims another debt.'
  );

  d.spawnVFXBurst(new THREE.Vector3(0, 0.8, -9.5), 0x38bdf8, 28);
  await d.moveActor('vance', new THREE.Vector3(0, 0, -10.5), 'Running_A', 0.9);
  d.removeActor('vance');
  d.removeActor('ledger');

  await d.say(
    'Runesmith Torgar',
    'Oakhaven Forgemaster',
    '#f97316',
    'The purple chains—they are burning into our chests! Auditor, please... descend through Warden Aldric’s Crypt Gate before the final page closes!'
  );

  await d.showChapterCard('ACT I', 'THE DEBT OF OAKHAVEN', 'Speak to Warden Aldric to Enter the Crypt', 2.2);
}

export async function runAct1ForgedSignature(d: CutsceneDirector, bossCenter: THREE.Vector3): Promise<void> {
  d.spawnActor('malakor', 'characters/Skeleton_Mage.glb', bossCenter.clone().add(new THREE.Vector3(0, 0, -3.5)), {
    scale: 1.65,
    tintHex: 0x38bdf8,
    rightWeapon: 'weapons/Skeleton_Staff.gltf',
    idleClip: 'Skeletons_Idle',
  });

  await d.moveCameraTo(
    bossCenter.clone().add(new THREE.Vector3(4.5, 4.8, 6.5)),
    bossCenter.clone().add(new THREE.Vector3(0, 1.8, -3.5)),
    1.4
  );
  d.spawnVFXBurst(bossCenter.clone().add(new THREE.Vector3(0, 1.5, -3.5)), 0x38bdf8, 28);

  await d.say(
    'Archivist Malakor',
    'Keeper of the First Seal',
    '#38bdf8',
    'Another pawn bearing the Soul-Debt Mark! Tell me, Auditor—did Oakhaven’s Runesmith tell you who forged the key that broke this Seal?'
  );
  await d.say(
    'Archivist Malakor',
    'Keeper of the First Seal',
    '#38bdf8',
    'Torgar signed the Ledger in his own blood to cure his dying daughter! Now face the weight of his forged signature!'
  );

  d.removeActor('malakor');
  await d.showChapterCard('BOSS', 'ARCHIVIST MALAKOR', 'Keeper of the First Seal', 2.0);
}

export async function runAct1TorgarConfession(d: CutsceneDirector): Promise<void> {
  await d.moveCameraTo(new THREE.Vector3(-4.2, 3.8, -1.8), new THREE.Vector3(-7.5, 1.3, -5.5), 1.3);
  await d.say(
    'Runesmith Torgar',
    'Oakhaven Forgemaster',
    '#f97316',
    'You... you shattered the First Seal. Then you know what I did. Vance promised my daughter would live if I forged the Spire Key...'
  );
  await d.say(
    'Runesmith Torgar',
    'Masterwork Refiner',
    '#facc15',
    'I will not hide from my sin. From this moment on, my anvil burns at Masterwork heat—let me refine your gear to +10 and end Vance’s pact!'
  );
}

export async function runAct2AuditorsName(d: CutsceneDirector): Promise<void> {
  d.spawnActor('monolith', 'dungeon/pillar.gltf.glb', new THREE.Vector3(0, 0, -5.0), {
    scale: 1.4,
    tintHex: 0xa855f7,
  });
  d.spawnActor('vance_echo', 'characters/Mage.glb', new THREE.Vector3(0, 0.2, -4.0), {
    tintHex: 0x38bdf8,
    idleClip: 'Idle_A',
  });

  await d.moveCameraTo(new THREE.Vector3(3.2, 3.4, 1.5), new THREE.Vector3(0, 1.5, -4.5), 1.5);
  d.spawnVFXBurst(new THREE.Vector3(0, 1.5, -4.0), 0xa855f7, 24);

  await d.say(
    'Spectral Vance',
    'Echo in the Obsidian',
    '#a855f7',
    'Still climbing, Auditor? Look closely at the top line of the Ledger carved into this monolith—above Torgar, above every villager in Oakhaven.'
  );
  await d.say(
    'Spectral Vance',
    'Echo in the Obsidian',
    '#38bdf8',
    'Your own name is inscribed as THE FIRST VESSEL. You were the Spire Guardian who broke the seal ten years ago—before the Capital wiped your memory!'
  );

  d.removeActor('vance_echo');
  d.removeActor('monolith');
  await d.showChapterCard('ACT II', 'THE AUDITOR’S NAME', 'Overgrown Subterranean Ruins', 2.2);
}

export async function runAct3AshenPact(d: CutsceneDirector, bossCenter: THREE.Vector3): Promise<void> {
  d.spawnActor('vance_boss', 'characters/Mage.glb', bossCenter.clone().add(new THREE.Vector3(-2.5, 0, -3.5)), {
    scale: 1.2,
    tintHex: 0xfacc15,
    rightWeapon: 'weapons/pack_scythe.glb',
    idleClip: 'Idle_A',
  });
  d.spawnActor('warden_boss', 'monsters/Demon.gltf', bossCenter.clone().add(new THREE.Vector3(2.2, 0, -4.5)), {
    scale: 1.45,
    tintHex: 0xdc2626,
    idleClip: 'Idle',
  });

  await d.moveCameraTo(
    bossCenter.clone().add(new THREE.Vector3(0, 5.2, 7.5)),
    bossCenter.clone().add(new THREE.Vector3(0, 1.8, -4.0)),
    1.6
  );
  d.shakeCamera(0.4, 0.8);
  d.spawnVFXBurst(bossCenter.clone().add(new THREE.Vector3(0, 1.6, -4.0)), 0xdc2626, 36);

  await d.say(
    'Mayor Vance',
    'Architect of the Ashen Pact',
    '#facc15',
    'Welcome to the Spire Core, First Vessel! Behold the Abyssal Warden—and witness the final page of Oakhaven’s debt!'
  );
  await d.say(
    'The Abyssal Warden',
    'Lord of the Spire Core',
    '#dc2626',
    'Your usefulness ends here, Mayor. Step forward, Guardian—reclaim your memories in blood!'
  );

  d.removeActor('vance_boss');
  d.removeActor('warden_boss');
  await d.showChapterCard('ACT III', 'THE ASHEN PACT', 'Spire Core — Final Confrontation', 2.4);
}

export async function runAct3Sunrise(d: CutsceneDirector): Promise<void> {
  await d.fadeScreen(true, 0.5);
  await d.moveCameraTo(new THREE.Vector3(0, 11, 14), new THREE.Vector3(0, 1.0, 0), 0.1);
  await d.fadeScreen(false, 1.2);
  d.spawnVFXBurst(new THREE.Vector3(0, 2.0, 0), 0xfacc15, 40);
  await d.orbitTarget(new THREE.Vector3(0, 0, 0), Math.PI * 0.65, 13, 3.0, 7.5);
  await d.say(
    'Warden Aldric',
    'Oakhaven Watch',
    '#facc15',
    'The purple chains have shattered at last! Oakhaven is free—and the Endless Abyss (Floors 4–99) now awaits any hero bold enough to master it.'
  );
  await d.showChapterCard('ACT IV', 'ENDLESS ABYSS UNLOCKED', 'Floors 4–99 Now Open', 2.4);
}
