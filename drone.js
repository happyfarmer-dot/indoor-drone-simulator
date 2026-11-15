/**
 * Procedural 3D FPV Quadcopter Model & Visual Effects (drone.js)
 *
 * Constructs an authentic 5-inch FPV Quadcopter using Three.js geometries and
 * procedural Carbon-Fiber PBR textures (Normal + Roughness maps).
 */

import * as THREE from 'three';

export class DroneModel {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.propellers = [];
    this.blurDiscs = [];
    this.armLeds = [];

    this.buildProceduralTextures();
    this.buildQuadcopterMesh();
    this.buildSphericalExoskeletonCage();
    this.buildDownwashRing();

    this.scene.add(this.group);
  }

  buildProceduralTextures() {
    // 1. Carbon Fiber Weave Albedo, Normal & Roughness Map
    const size = 128;
    const cfCanvas = document.createElement('canvas');
    cfCanvas.width = size;
    cfCanvas.height = size;
    const ctx = cfCanvas.getContext('2d');

    const normCanvas = document.createElement('canvas');
    normCanvas.width = size;
    normCanvas.height = size;
    const nCtx = normCanvas.getContext('2d');

    ctx.fillStyle = '#181b20';
    ctx.fillRect(0, 0, size, size);
    nCtx.fillStyle = 'rgb(128, 128, 255)';
    nCtx.fillRect(0, 0, size, size);

    const cell = 8;
    for (let y = 0; y < size; y += cell) {
      for (let x = 0; x < size; x += cell) {
        const isEven = ((x / cell + y / cell) % 2) === 0;
        ctx.fillStyle = isEven ? '#23272e' : '#14171c';
        ctx.fillRect(x, y, cell - 1, cell - 1);

        // Normal map bevel variation for weave depth
        nCtx.fillStyle = isEven ? 'rgb(142, 118, 255)' : 'rgb(114, 138, 255)';
        nCtx.fillRect(x, y, cell - 1, cell - 1);
      }
    }

    this.cfTexture = new THREE.CanvasTexture(cfCanvas);
    this.cfTexture.wrapS = THREE.RepeatWrapping;
    this.cfTexture.wrapRepeat = THREE.RepeatWrapping;
    this.cfTexture.repeat.set(4, 4);

    this.cfNormalMap = new THREE.CanvasTexture(normCanvas);
    this.cfNormalMap.wrapS = THREE.RepeatWrapping;
    this.cfNormalMap.wrapT = THREE.RepeatWrapping;
    this.cfNormalMap.repeat.set(4, 4);

    // 2. Rotor Motion Blur Radial Disc Texture
    const discSize = 256;
    const discCanvas = document.createElement('canvas');
    discCanvas.width = discSize;
    discCanvas.height = discSize;
    const dCtx = discCanvas.getContext('2d');
    const c = discSize / 2;

    const grad = dCtx.createRadialGradient(c, c, 8, c, c, c - 4);
    grad.addColorStop(0.0, 'rgba(200, 225, 255, 0.0)');
    grad.addColorStop(0.2, 'rgba(180, 215, 255, 0.22)');
    grad.addColorStop(0.75, 'rgba(150, 200, 255, 0.16)');
    grad.addColorStop(0.94, 'rgba(56, 189, 248, 0.45)');
    grad.addColorStop(1.0, 'rgba(56, 189, 248, 0.0)');
    dCtx.fillStyle = grad;
    dCtx.beginPath();
    dCtx.arc(c, c, c - 2, 0, Math.PI * 2);
    dCtx.fill();

    this.discTexture = new THREE.CanvasTexture(discCanvas);
  }

  buildQuadcopterMesh() {
    const cfMat = new THREE.MeshStandardMaterial({
      map: this.cfTexture,
      normalMap: this.cfNormalMap,
      normalScale: new THREE.Vector2(0.4, 0.4),
      roughness: 0.35,
      metalness: 0.35
    });

    const aluMat = new THREE.MeshStandardMaterial({
      color: 0xe11d48,
      roughness: 0.25,
      metalness: 0.85
    });

    const motorBellMat = new THREE.MeshStandardMaterial({
      color: 0x1e293b,
      roughness: 0.22,
      metalness: 0.90
    });

    const copperMat = new THREE.MeshStandardMaterial({
      color: 0xd97706,
      roughness: 0.3,
      metalness: 0.88
    });

    // 1. Central Carbon-Fiber Bottom & Top Plates
    const bottomPlate = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.004, 0.145), cfMat);
    bottomPlate.position.set(0, -0.012, 0);
    bottomPlate.castShadow = true;
    this.group.add(bottomPlate);

    const topPlate = new THREE.Mesh(new THREE.BoxGeometry(0.064, 0.003, 0.130), cfMat);
    topPlate.position.set(0, 0.016, 0);
    topPlate.castShadow = true;
    this.group.add(topPlate);

    // FC/ESC Stack inside frame
    const stackMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.4, metalness: 0.5 });
    const fcStack = new THREE.Mesh(new THREE.BoxGeometry(0.038, 0.020, 0.038), stackMat);
    fcStack.position.set(0, 0.002, 0);
    this.group.add(fcStack);

    // 8 Anodized Aluminum Standoffs
    const standoffGeo = new THREE.CylinderGeometry(0.0025, 0.0025, 0.026, 8);
    const standoffCoords = [
      [-0.026, -0.055], [0.026, -0.055],
      [-0.026,  0.000], [0.026,  0.000],
      [-0.026,  0.055], [0.026,  0.055]
    ];
    for (const [sx, sz] of standoffCoords) {
      const post = new THREE.Mesh(standoffGeo, aluMat);
      post.position.set(sx, 0.002, sz);
      this.group.add(post);
    }

    // 2. Top 6S LiPo Battery Pack + Strap
    const batteryMat = new THREE.MeshStandardMaterial({
      color: 0x2563eb,
      roughness: 0.42,
      metalness: 0.15
    });
    const batteryMesh = new THREE.Mesh(new THREE.BoxGeometry(0.042, 0.034, 0.078), batteryMat);
    batteryMesh.position.set(0, 0.035, 0.008);
    batteryMesh.castShadow = true;
    this.group.add(batteryMesh);

    const strapMat = new THREE.MeshStandardMaterial({ color: 0x111827, roughness: 0.8 });
    const strapMesh = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.037, 0.016), strapMat);
    strapMesh.position.set(0, 0.035, 0.008);
    this.group.add(strapMesh);

    // 3. FPV Camera Mount & Tilted Lens Assembly (Front = -Z)
    this.fpvMount = new THREE.Group();
    this.fpvMount.position.set(0, 0.006, -0.066);
    this.group.add(this.fpvMount);

    const camBody = new THREE.Mesh(
      new THREE.BoxGeometry(0.022, 0.022, 0.020),
      new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.35, metalness: 0.6 })
    );
    this.fpvMount.add(camBody);

    const lensBarrel = new THREE.Mesh(
      new THREE.CylinderGeometry(0.008, 0.009, 0.012, 16),
      new THREE.MeshStandardMaterial({ color: 0x020617, roughness: 0.12, metalness: 0.9 })
    );
    lensBarrel.rotation.x = Math.PI / 2;
    lensBarrel.position.set(0, 0, -0.012);
    this.fpvMount.add(lensBarrel);

    // Set initial 15 deg uptilt
    this.setCameraUptilt(15);

    // 4. Four Arms, Brushless Motors, Tri-Blade Propellers & LED Strips
    // Motor order matches physics.js:
    // M1: Front-Right (+X, -Z), M2: Rear-Right (+X, +Z), M3: Rear-Left (-X, +Z), M4: Front-Left (-X, -Z)
    const armDiag = 0.125 * Math.SQRT1_2; // ~0.0884 m
    const motorPositions = [
      { x:  armDiag, z: -armDiag, angle: -Math.PI / 4, ccw: true,  isFront: true  }, // M1 FR
      { x:  armDiag, z:  armDiag, angle:  Math.PI / 4, ccw: false, isFront: false }, // M2 RR
      { x: -armDiag, z:  armDiag, angle: -Math.PI / 4, ccw: true,  isFront: false }, // M3 RL
      { x: -armDiag, z: -armDiag, angle:  Math.PI / 4, ccw: false, isFront: true  }  // M4 FL
    ];

    const propMatFront = new THREE.MeshStandardMaterial({
      color: 0x38bdf8,
      roughness: 0.25,
      metalness: 0.1,
      transparent: true,
      opacity: 0.88
    });
    const propMatRear = new THREE.MeshStandardMaterial({
      color: 0xf43f5e,
      roughness: 0.25,
      metalness: 0.1,
      transparent: true,
      opacity: 0.88
    });

    for (let i = 0; i < 4; i++) {
      const mp = motorPositions[i];

      // Carbon fiber arm
      const armGeo = new THREE.BoxGeometry(0.135, 0.006, 0.016);
      const armMesh = new THREE.Mesh(armGeo, cfMat);
      armMesh.position.set(mp.x * 0.52, -0.010, mp.z * 0.52);
      armMesh.rotation.y = mp.angle;
      armMesh.castShadow = true;
      this.group.add(armMesh);

      // Arm LED neon strip
      const ledMat = new THREE.MeshBasicMaterial({ color: mp.isFront ? 0x38bdf8 : 0x10b981 });
      const ledMesh = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.0025, 0.005), ledMat);
      ledMesh.position.set(mp.x * 0.55, -0.005, mp.z * 0.55);
      ledMesh.rotation.y = mp.angle;
      this.group.add(ledMesh);
      this.armLeds.push(ledMat);

      // Landing skid pad under motor
      const skid = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.006, 0.014, 10), strapMat);
      skid.position.set(mp.x, -0.020, mp.z);
      this.group.add(skid);

      // Brushless Motor Copper Windings + Stator Bell
      const stator = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.009, 16), copperMat);
      stator.position.set(mp.x, -0.002, mp.z);
      this.group.add(stator);

      const bell = new THREE.Mesh(new THREE.CylinderGeometry(0.0145, 0.0145, 0.013, 20), motorBellMat);
      bell.position.set(mp.x, 0.003, mp.z);
      bell.castShadow = true;
      this.group.add(bell);

      // Tri-Blade Propeller Hub + 3 Blades
      const propGroup = new THREE.Group();
      propGroup.position.set(mp.x, 0.013, mp.z);

      const pMat = mp.isFront ? propMatFront : propMatRear;
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.007, 0.008, 12), pMat);
      propGroup.add(hub);

      const nut = new THREE.Mesh(new THREE.ConeGeometry(0.0045, 0.009, 10), aluMat);
      nut.position.y = 0.007;
      propGroup.add(nut);

      const bladeGeo = new THREE.BoxGeometry(0.060, 0.0018, 0.013);
      bladeGeo.translate(0.030, 0, 0);
      for (let b = 0; b < 3; b++) {
        const bladePivot = new THREE.Group();
        bladePivot.rotation.y = (b * Math.PI * 2) / 3;
        const blade = new THREE.Mesh(bladeGeo, pMat);
        blade.rotation.x = mp.ccw ? 0.24 : -0.24; // Pitch angle of attack
        bladePivot.add(blade);
        propGroup.add(bladePivot);
      }

      this.group.add(propGroup);
      this.propellers.push({ group: propGroup, dir: mp.ccw ? 1 : -1 });

      // Translucent Rotor Motion-Blur Disc
      const discMat = new THREE.MeshBasicMaterial({
        map: this.discTexture,
        transparent: true,
        opacity: 0.35,
        depthWrite: false,
        side: THREE.DoubleSide
      });
      const discMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.132, 0.132), discMat);
      discMesh.rotation.x = -Math.PI / 2;
      discMesh.position.set(mp.x, 0.014, mp.z);
      this.group.add(discMesh);
      this.blurDiscs.push(discMat);
    }

    // 5. Onboard Forward LED Headlight (illuminates warehouse racks in front of drone)
    this.headlight = new THREE.SpotLight(0xe0f2fe, 4.5, 18, Math.PI / 4, 0.55, 1.5);
    this.headlight.position.set(0, 0.01, -0.07);
    this.headlightTarget = new THREE.Object3D();
    this.headlightTarget.position.set(0, -0.15, -5.0);
    this.group.add(this.headlight);
    this.group.add(this.headlightTarget);
    this.headlight.target = this.headlightTarget;
  }

  /**
   * Build Matte-Black Carbon-Fiber Spherical Protective Exoskeleton Cage
   * with Bright Red Internal LED Strips for Drone Soccer Mode
   */
  buildSphericalExoskeletonCage() {
    this.exoskeletonGroup = new THREE.Group();
    const radius = 0.28;
    const tube = 0.0105;

    const cageMat = new THREE.MeshStandardMaterial({
      map: this.cfTexture,
      normalMap: this.cfNormalMap,
      normalScale: new THREE.Vector2(0.5, 0.5),
      color: 0x161920,
      roughness: 0.28,
      metalness: 0.62
    });

    const jointMat = new THREE.MeshStandardMaterial({
      color: 0x64748b,
      roughness: 0.25,
      metalness: 0.88
    });

    // 3 Orthogonal Primary Carbon-Fiber Guard Rings
    for (let i = 0; i < 3; i++) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(radius, tube, 10, 42), cageMat);
      if (i === 1) ring.rotation.x = Math.PI / 2;
      if (i === 2) ring.rotation.y = Math.PI / 2;
      this.exoskeletonGroup.add(ring);
    }

    // 4 Diagonal Geodesic Carbon Ribs
    for (let i = 0; i < 4; i++) {
      const rib = new THREE.Mesh(new THREE.TorusGeometry(radius * 0.996, tube * 0.82, 8, 36), cageMat);
      rib.rotation.y = (i * Math.PI) / 4;
      rib.rotation.x = Math.PI / 4;
      this.exoskeletonGroup.add(rib);
    }

    // Upper & Lower Latitudinal Guard Rings + Metallic Structural Joints
    for (const latY of [-0.54, 0.54]) {
      const latR = radius * Math.sqrt(1 - latY * latY);
      const latRing = new THREE.Mesh(new THREE.TorusGeometry(latR, tube * 0.78, 8, 32), cageMat);
      latRing.rotation.x = Math.PI / 2;
      latRing.position.y = latY * radius;
      this.exoskeletonGroup.add(latRing);

      for (let j = 0; j < 8; j++) {
        const a = (j / 8) * Math.PI * 2;
        const joint = new THREE.Mesh(new THREE.SphereGeometry(tube * 1.45, 8, 8), jointMat);
        joint.position.set(Math.cos(a) * latR, latY * radius, Math.sin(a) * latR);
        this.exoskeletonGroup.add(joint);
      }
    }

    // Bright Red Internal LED Illumination Rings + PointLight
    const redLedMat = new THREE.MeshBasicMaterial({ color: 0xff1e38 });
    const innerLedRing1 = new THREE.Mesh(new THREE.TorusGeometry(radius * 0.87, 0.012, 8, 36), redLedMat);
    innerLedRing1.rotation.x = Math.PI / 2;
    this.exoskeletonGroup.add(innerLedRing1);

    const innerLedRing2 = new THREE.Mesh(new THREE.TorusGeometry(radius * 0.85, 0.009, 8, 36), redLedMat);
    this.exoskeletonGroup.add(innerLedRing2);

    this.soccerGlowLight = new THREE.PointLight(0xff1e38, 2.2, 4.5, 1.5);
    this.exoskeletonGroup.add(this.soccerGlowLight);

    this.group.add(this.exoskeletonGroup);
  }

  setExoskeletonEnabled(enabled) {
    if (this.exoskeletonGroup) {
      this.exoskeletonGroup.visible = enabled;
    }
  }

  buildDownwashRing() {
    // Subtle ground-effect air ripple ring projected on floor below drone
    const ringGeo = new THREE.RingGeometry(0.18, 0.48, 32);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.0,
      side: THREE.DoubleSide,
      depthWrite: false
    });
    this.downwashMesh = new THREE.Mesh(ringGeo, ringMat);
    this.downwashMesh.rotation.x = -Math.PI / 2;
    this.downwashMesh.position.y = 0.012;
    this.scene.add(this.downwashMesh);
  }

  setCameraUptilt(deg) {
    this.cameraUptiltRad = THREE.MathUtils.degToRad(deg);
    if (this.fpvMount) {
      this.fpvMount.rotation.x = this.cameraUptiltRad;
    }
  }

  /**
   * Synchronize 3D model transform, propeller animation & LED colors with physics state
   */
  update(dt, physics) {
    this.group.position.copy(physics.position);
    this.group.quaternion.copy(physics.quaternion);

    // Spin propellers & modulate blur disc opacity by real-time RPM
    for (let i = 0; i < 4; i++) {
      const rpm = physics.motorRPM[i];
      const radPerSec = (rpm * Math.PI * 2) / 60;
      this.propellers[i].group.rotation.y += this.propellers[i].dir * radPerSec * dt;

      const normRPM = THREE.MathUtils.clamp((rpm - 1800) / 24000, 0, 1);
      this.blurDiscs[i].opacity = 0.15 + 0.55 * normRPM;
    }

    // Update arm LED color based on Flight Mode
    const isAcro = physics.flightMode === 'ACRO';
    for (let i = 0; i < this.armLeds.length; i++) {
      if (i === 0 || i === 3) {
        this.armLeds[i].color.setHex(isAcro ? 0xf59e0b : 0x38bdf8);
      } else {
        this.armLeds[i].color.setHex(isAcro ? 0xf43f5e : 0x10b981);
      }
    }

    // Update ground-effect rotor wash ring on the warehouse floor
    if (physics.position.y < 2.2) {
      const factor = 1.0 - physics.position.y / 2.2;
      this.downwashMesh.visible = true;
      this.downwashMesh.position.x = physics.position.x;
      this.downwashMesh.position.z = physics.position.z;
      const scale = 0.8 + (1.0 - factor) * 1.4;
      this.downwashMesh.scale.set(scale, scale, 1);
      this.downwashMesh.material.opacity = factor * 0.22 * (physics.telemetry.throttlePct / 100 + 0.2);
    } else {
      this.downwashMesh.visible = false;
    }
  }
}
