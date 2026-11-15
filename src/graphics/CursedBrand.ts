import * as THREE from 'three';

/**
 * The glowing Soul-Debt brand on the player's wrist. Level 0 = gone, 1..4 = spreading curse
 * (brighter, faster heartbeat pulse). Attached to the left-hand bone so it follows animation.
 */
export class CursedBrand {
  private group = new THREE.Group();
  private ringMat: THREE.MeshBasicMaterial;
  private runeMat: THREE.MeshBasicMaterial;
  private light: THREE.PointLight;
  private level = 0;
  private t = 0;
  private fadeGold = 0;

  constructor() {
    this.ringMat = new THREE.MeshBasicMaterial({ color: 0xa855f7, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false });
    this.runeMat = new THREE.MeshBasicMaterial({ color: 0xd8b4fe, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.075, 0.014, 6, 24), this.ringMat);
    ring.rotation.x = Math.PI / 2;
    const ring2 = new THREE.Mesh(new THREE.TorusGeometry(0.09, 0.008, 6, 24), this.runeMat);
    ring2.rotation.x = Math.PI / 2;
    ring2.position.y = 0.035;
    this.group.add(ring, ring2);
    this.light = new THREE.PointLight(0xa855f7, 0, 1.2, 2);
    this.group.add(this.light);
    this.group.visible = false;
  }

  public attach(character: THREE.Object3D): void {
    this.group.removeFromParent();
    const bone =
      character.getObjectByName('handl') ??
      character.getObjectByName('wristl') ??
      character.getObjectByName('handslotl') ??
      character.getObjectByName('handslot.l');
    if (bone) {
      bone.add(this.group);
      // Bones are in rig units; counter the character scale so the ring stays wrist-sized
      this.group.position.set(0, 0, 0);
    } else {
      character.add(this.group);
      this.group.position.set(-0.35, 0.95, 0.1);
    }
  }

  public setLevel(level: number): void {
    if (level <= 0 && this.level > 0) this.fadeGold = 1;
    this.level = Math.max(0, Math.min(4, level));
    this.group.visible = this.level > 0 || this.fadeGold > 0;
  }

  public getLevel(): number {
    return this.level;
  }

  public update(dt: number): void {
    if (!this.group.visible) return;
    this.t += dt;
    if (this.level <= 0) {
      // Curse lifted: flare gold, then fade away
      this.fadeGold = Math.max(0, this.fadeGold - dt * 0.6);
      this.ringMat.color.setHex(0xffd166).multiplyScalar(this.fadeGold);
      this.runeMat.color.setHex(0xfff1b8).multiplyScalar(0.8 * this.fadeGold);
      this.light.color.setHex(0xffd166);
      this.light.intensity = 0.4 * this.fadeGold;
      if (this.fadeGold <= 0) this.group.visible = false;
      return;
    }
    // Heartbeat pulse that quickens as the curse spreads
    const rate = 1.1 + this.level * 0.45;
    const beat = Math.pow(Math.max(0, Math.sin(this.t * rate * Math.PI)), 6);
    // Kept below the bloom threshold so the brand reads as a mark, not a glowing halo
    const k = 0.75 + this.level * 0.08 + beat * 0.3;
    this.ringMat.color.setHex(0xa855f7).multiplyScalar(k);
    this.runeMat.color.setHex(0xd8b4fe).multiplyScalar(k * 0.7);
    this.group.rotation.y += dt * (0.6 + this.level * 0.3);
    this.light.intensity = 0.1 + beat * 0.3;
    this.group.scale.setScalar(1 + this.level * 0.12 + beat * 0.08);
  }
}
