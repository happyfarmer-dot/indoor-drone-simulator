/**
 * Procedural 3D Taipei Dome Stadium & 5v5 Drone Soccer Match Engine (taipei_dome.js)
 *
 * Implements:
 * - Taipei Dome iconic white curved steel space-frame roof trusses & metallic structural joints
 * - Overhead stadium floodlights with subtle volumetric light beams
 * - Multi-tiered spectator seating bowl & glowing LED ribbon boards
 * - Center-hung 4-sided Digital Jumbotron Scoreboard (live CanvasTexture: RED vs BLUE + Period Clock)
 * - Central enclosed netted Drone Soccer court with fine mesh safety netting & truss frame
 * - Two glowing circular ring goals (Red & Blue) suspended mid-air at opposite ends
 * - Nine AI Spherical Carbon-Fiber Exoskeleton Drones (4 Red teammates + 5 Electric Blue opponents)
 *   + Player (5th Red Striker) = 10 Spherical Drones in dynamic mid-air combat, banking, blocking & scoring
 */

import * as THREE from 'three';

export class TaipeiDomeSoccerScene {
  constructor(scene, renderer) {
    this.scene = scene;
    this.renderer = renderer;
    this.rootGroup = new THREE.Group();
    this.scene.add(this.rootGroup);

    this.colliders = [];
    this.aiDrones = [];
    this.volumetricBeams = [];

    // Match Score & Timer State
    this.scoreRed = 3;
    this.scoreBlue = 2;
    this.matchTimeSec = 12 * 60 + 45; // Starts at 12:45 (2nd Period) matching broadcast aesthetic
    this.goalCooldown = 0;
    this.lastScorerText = 'DRONE SOCCER GRAND FINALS';
    this.goalFlashTimer = 0;

    this.materials = {};
    this.buildProceduralTextures();
    this.buildStadiumLighting();
    this.buildStadiumArchitecture();
    this.buildNettedSoccerCourt();
    this.buildSuspendedRingGoals();
    this.buildJumbotronScoreboard();
    this.spawnAIDroneSquads();
  }

  addBoxCollider(minX, minY, minZ, maxX, maxY, maxZ, tag = 'soccer', restitution = 0.45) {
    const box = new THREE.Box3(
      new THREE.Vector3(minX, minY, minZ),
      new THREE.Vector3(maxX, maxY, maxZ)
    );
    this.colliders.push({ box, tag, restitution });
  }

  setVisible(visible) {
    this.rootGroup.visible = visible;
  }

  buildStadiumLighting() {
    // Natural Broadcast Stadium Hemisphere + Directional Shadow Lighting
    const hemiLight = new THREE.HemisphereLight(0xe2e8f0, 0x1e293b, 1.15);
    hemiLight.position.set(0, 28, 0);
    this.rootGroup.add(hemiLight);

    const stadiumSun = new THREE.DirectionalLight(0xf8fafc, 2.3);
    stadiumSun.position.set(10, 26, 12);
    stadiumSun.castShadow = true;
    stadiumSun.shadow.mapSize.width = 2048;
    stadiumSun.shadow.mapSize.height = 2048;
    stadiumSun.shadow.camera.near = 2;
    stadiumSun.shadow.camera.far = 60;
    const d = 20;
    stadiumSun.shadow.camera.left = -d;
    stadiumSun.shadow.camera.right = d;
    stadiumSun.shadow.camera.top = d;
    stadiumSun.shadow.camera.bottom = -d;
    stadiumSun.shadow.bias = -0.0005;
    this.rootGroup.add(stadiumSun);
  }

  /**
   * Generate procedural PBR textures:
   * - Fine mesh safety netting (alpha texture)
   * - Carbon-fiber weave for spherical exoskeleton cages
   * - Stadium floor polished concrete + court lines
   * - Multi-tiered spectator crowd & LED ribbon fascia
   */
  buildProceduralTextures() {
    const maxAniso = this.renderer.capabilities.getMaxAnisotropy
      ? this.renderer.capabilities.getMaxAnisotropy()
      : 4;

    // 1. Fine Mesh Safety Netting Texture
    const netCanvas = document.createElement('canvas');
    netCanvas.width = 128;
    netCanvas.height = 128;
    const nCtx = netCanvas.getContext('2d');
    nCtx.clearRect(0, 0, 128, 128);
    nCtx.strokeStyle = 'rgba(210, 225, 245, 0.36)';
    nCtx.lineWidth = 2;
    const step = 16;
    for (let i = 0; i <= 128; i += step) {
      nCtx.beginPath();
      nCtx.moveTo(i, 0); nCtx.lineTo(i, 128);
      nCtx.moveTo(0, i); nCtx.lineTo(128, i);
      nCtx.stroke();
    }
    const netTex = new THREE.CanvasTexture(netCanvas);
    netTex.wrapS = THREE.RepeatWrapping;
    netTex.wrapT = THREE.RepeatWrapping;
    netTex.repeat.set(36, 12);
    this.materials.netting = new THREE.MeshStandardMaterial({
      map: netTex,
      transparent: true,
      alphaTest: 0.05,
      roughness: 0.6,
      metalness: 0.2,
      side: THREE.DoubleSide,
      depthWrite: false
    });

    // 2. Stadium Floor Concrete & Court Markings Texture
    const floorCanvas = document.createElement('canvas');
    floorCanvas.width = 512;
    floorCanvas.height = 512;
    const fCtx = floorCanvas.getContext('2d');
    fCtx.fillStyle = '#333b48';
    fCtx.fillRect(0, 0, 512, 512);

    // Subtle expansion joints & concrete aggregate noise
    fCtx.strokeStyle = 'rgba(15, 23, 42, 0.45)';
    fCtx.lineWidth = 2;
    for (let i = 0; i <= 512; i += 64) {
      fCtx.beginPath();
      fCtx.moveTo(i, 0); fCtx.lineTo(i, 512);
      fCtx.moveTo(0, i); fCtx.lineTo(512, i);
      fCtx.stroke();
    }
    for (let i = 0; i < 6000; i++) {
      const x = Math.random() * 512;
      const y = Math.random() * 512;
      const v = 45 + Math.floor(Math.random() * 25);
      fCtx.fillStyle = `rgba(${v}, ${v + 6}, ${v + 14}, 0.25)`;
      fCtx.fillRect(x, y, 2, 2);
    }
    const floorTex = new THREE.CanvasTexture(floorCanvas);
    floorTex.wrapS = THREE.RepeatWrapping;
    floorTex.wrapT = THREE.RepeatWrapping;
    floorTex.repeat.set(16, 16);
    floorTex.anisotropy = maxAniso;
    floorTex.colorSpace = THREE.SRGBColorSpace;

    this.materials.arenaFloor = new THREE.MeshStandardMaterial({
      map: floorTex,
      roughness: 0.26,
      metalness: 0.14
    });

    // 3. LED Ribbon Fascia Board Texture
    const ribCanvas = document.createElement('canvas');
    ribCanvas.width = 1024;
    ribCanvas.height = 64;
    const rCtx = ribCanvas.getContext('2d');
    rCtx.fillStyle = '#050811';
    rCtx.fillRect(0, 0, 1024, 64);
    const ribGrad = rCtx.createLinearGradient(0, 0, 1024, 0);
    ribGrad.addColorStop(0.0, '#ff1e42');
    ribGrad.addColorStop(0.25, '#0ea5e9');
    ribGrad.addColorStop(0.5, '#f8fafc');
    ribGrad.addColorStop(0.75, '#0ea5e9');
    ribGrad.addColorStop(1.0, '#ff1e42');
    rCtx.fillStyle = ribGrad;
    rCtx.fillRect(0, 0, 1024, 4);
    rCtx.fillRect(0, 60, 1024, 4);
    rCtx.font = 'bold 26px "JetBrains Mono", sans-serif';
    rCtx.fillStyle = '#f8fafc';
    rCtx.textAlign = 'center';
    rCtx.fillText('DRONE SOCCER GRAND FINALS - TAIPEI DOME   •   5v5 STRIKER ARENA   •   FIDA WORLD CUP', 512, 41);

    const ribTex = new THREE.CanvasTexture(ribCanvas);
    ribTex.wrapS = THREE.RepeatWrapping;
    ribTex.wrapT = THREE.ClampToEdgeWrapping;
    ribTex.repeat.set(6, 1);
    ribTex.colorSpace = THREE.SRGBColorSpace;
    this.materials.ribbonLed = new THREE.MeshBasicMaterial({ map: ribTex });

    // 4. Spectator Crowd Bowl Texture
    const crowdCanvas = document.createElement('canvas');
    crowdCanvas.width = 512;
    crowdCanvas.height = 256;
    const cCtx = crowdCanvas.getContext('2d');
    cCtx.fillStyle = '#0b101b';
    cCtx.fillRect(0, 0, 512, 256);
    // Tiered seat rows & colorful stadium audience specks
    for (let row = 0; row < 32; row++) {
      const y = row * 8;
      cCtx.fillStyle = '#131b2e';
      cCtx.fillRect(0, y, 512, 2);
      for (let col = 0; col < 128; col++) {
        if (Math.random() < 0.78) {
          const x = col * 4 + (row % 2) * 2;
          const palette = ['#e11d48', '#38bdf8', '#f8fafc', '#fbbf24', '#94a3b8', '#2563eb'];
          cCtx.fillStyle = palette[Math.floor(Math.random() * palette.length)];
          cCtx.fillRect(x, y + 2, 2.5, 4.5);
        }
      }
    }
    const crowdTex = new THREE.CanvasTexture(crowdCanvas);
    crowdTex.wrapS = THREE.RepeatWrapping;
    crowdTex.wrapT = THREE.RepeatWrapping;
    crowdTex.repeat.set(14, 2);
    crowdTex.colorSpace = THREE.SRGBColorSpace;
    this.materials.crowdBowl = new THREE.MeshStandardMaterial({
      map: crowdTex,
      roughness: 0.85,
      metalness: 0.05,
      side: THREE.BackSide
    });

    // 5. Matte Black Carbon-Fiber Exoskeleton Material
    this.materials.carbonCage = new THREE.MeshStandardMaterial({
      color: 0x161920,
      roughness: 0.28,
      metalness: 0.65
    });
    this.materials.whiteTruss = new THREE.MeshStandardMaterial({
      color: 0xe2e8f0,
      roughness: 0.35,
      metalness: 0.55
    });
    this.materials.aluTruss = new THREE.MeshStandardMaterial({
      color: 0x94a3b8,
      roughness: 0.28,
      metalness: 0.82
    });
  }

  /**
   * Build the Taipei Dome Stadium interior:
   * - Polished arena floor + Drone Soccer court lines
   * - Multi-tiered circular spectator seating bowl + glowing LED ribbon boards
   * - Iconic curved white steel space-frame roof trusses & catwalk floodlights
   */
  buildStadiumArchitecture() {
    // 1. Arena Floor (96m x 96m)
    const floorMesh = new THREE.Mesh(new THREE.PlaneGeometry(96, 96), this.materials.arenaFloor);
    floorMesh.rotation.x = -Math.PI / 2;
    floorMesh.receiveShadow = true;
    this.rootGroup.add(floorMesh);

    // Court Boundary & Center Markings on Floor
    const lineMatWhite = new THREE.MeshBasicMaterial({ color: 0xe2e8f0 });
    const lineMatRed = new THREE.MeshBasicMaterial({ color: 0xf43f5e });
    const lineMatBlue = new THREE.MeshBasicMaterial({ color: 0x38bdf8 });

    // Center line (Z = 0) & Attack lines (Z = ±5m)
    const centerLine = new THREE.Mesh(new THREE.PlaneGeometry(14.0, 0.10), lineMatWhite);
    centerLine.rotation.x = -Math.PI / 2;
    centerLine.position.set(0, 0.008, 0);
    this.rootGroup.add(centerLine);

    const redZoneLine = new THREE.Mesh(new THREE.PlaneGeometry(14.0, 0.08), lineMatRed);
    redZoneLine.rotation.x = -Math.PI / 2;
    redZoneLine.position.set(0, 0.008, 5.2);
    this.rootGroup.add(redZoneLine);

    const blueZoneLine = new THREE.Mesh(new THREE.PlaneGeometry(14.0, 0.08), lineMatBlue);
    blueZoneLine.rotation.x = -Math.PI / 2;
    blueZoneLine.position.set(0, 0.008, -5.2);
    this.rootGroup.add(blueZoneLine);

    // Center FIDA Drone Soccer Logo Circle
    const centerRing = new THREE.Mesh(new THREE.RingGeometry(1.8, 2.05, 48), lineMatWhite);
    centerRing.rotation.x = -Math.PI / 2;
    centerRing.position.set(0, 0.009, 0);
    this.rootGroup.add(centerRing);

    // 2. Multi-Tiered Spectator Seating Bowl & LED Ribbon Fascia Boards
    const lowerBowl = new THREE.Mesh(
      new THREE.CylinderGeometry(38, 28, 8.5, 48, 1, true),
      this.materials.crowdBowl
    );
    lowerBowl.position.y = 4.25;
    this.rootGroup.add(lowerBowl);

    const ledRibbon1 = new THREE.Mesh(
      new THREE.CylinderGeometry(38.1, 38.1, 1.15, 48, 1, true),
      this.materials.ribbonLed
    );
    ledRibbon1.scale.x = -1; // Face inward
    ledRibbon1.position.y = 8.8;
    this.rootGroup.add(ledRibbon1);

    const upperBowl = new THREE.Mesh(
      new THREE.CylinderGeometry(46, 38.2, 9.0, 48, 1, true),
      this.materials.crowdBowl
    );
    upperBowl.position.y = 13.8;
    this.rootGroup.add(upperBowl);

    // 3. Taipei Dome Iconic White Curved Steel Space-Frame Roof Trusses
    const domeCeiling = new THREE.Mesh(
      new THREE.SphereGeometry(48, 36, 16, 0, Math.PI * 2, 0, Math.PI * 0.36),
      new THREE.MeshStandardMaterial({
        color: 0x64748b,
        roughness: 0.75,
        metalness: 0.25,
        side: THREE.BackSide
      })
    );
    domeCeiling.scale.set(1, 0.45, 1);
    domeCeiling.position.y = 14.5;
    this.rootGroup.add(domeCeiling);

    // Radial Curved White Space-Frame Arches
    const numArches = 12;
    for (let i = 0; i < numArches; i++) {
      const angle = (i / numArches) * Math.PI;
      const archGroup = new THREE.Group();
      archGroup.rotation.y = angle;

      const archTorus = new THREE.Mesh(
        new THREE.TorusGeometry(44, 0.22, 8, 48, Math.PI),
        this.materials.whiteTruss
      );
      archTorus.scale.set(1, 0.36, 1);
      archTorus.position.y = 16.5;
      archGroup.add(archTorus);
      this.rootGroup.add(archGroup);
    }

    // Concentric Ring Trusses & Overhead Catwalk Ring
    const ringRadii = [14, 24, 34, 42];
    const ringHeights = [29.8, 28.2, 24.8, 19.5];
    for (let r = 0; r < ringRadii.length; r++) {
      const ringMesh = new THREE.Mesh(
        new THREE.TorusGeometry(ringRadii[r], 0.24, 8, 64),
        this.materials.whiteTruss
      );
      ringMesh.rotation.x = Math.PI / 2;
      ringMesh.position.y = ringHeights[r];
      this.rootGroup.add(ringMesh);
    }

    // 4. Overhead Stadium Floodlight Banks & Subtle Volumetric Light Beams
    const floodRadius = 24;
    const floodY = 27.6;
    const numFloods = 12;
    const beamMat = new THREE.MeshBasicMaterial({
      color: 0xe0f2fe,
      transparent: true,
      opacity: 0.035,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide
    });

    for (let i = 0; i < numFloods; i++) {
      const a = (i / numFloods) * Math.PI * 2;
      const fx = Math.cos(a) * floodRadius;
      const fz = Math.sin(a) * floodRadius;

      // Emissive Floodlight Bank
      const lampMesh = new THREE.Mesh(
        new THREE.BoxGeometry(2.6, 0.35, 0.9),
        new THREE.MeshBasicMaterial({ color: 0xffffff })
      );
      lampMesh.position.set(fx, floodY, fz);
      lampMesh.lookAt(0, 2, 0);
      this.rootGroup.add(lampMesh);

      // Volumetric light beam cone aimed toward center court
      const beamCone = new THREE.Mesh(new THREE.ConeGeometry(7.5, 28, 16, 1, true), beamMat);
      beamCone.position.set(fx * 0.65, 14.0, fz * 0.65);
      beamCone.lookAt(fx, floodY, fz);
      beamCone.rotateX(Math.PI / 2);
      this.rootGroup.add(beamCone);
      this.volumetricBeams.push(beamCone);
    }
  }

  /**
   * Build the central enclosed netted Drone Soccer court:
   * Dimensions: Width 14m (-7 to +7), Height 6.4m (0 to 6.4), Length 24m (-12 to +12)
   */
  buildNettedSoccerCourt() {
    const halfW = 7.0;
    const halfL = 12.0;
    const courtH = 6.4;

    // 1. Aluminum Box-Truss Frame Pillars & Crossbars
    const postRadius = 0.14;
    const postGeo = new THREE.CylinderGeometry(postRadius, postRadius, courtH, 12);
    const pillarCoords = [
      [-halfW, -halfL], [0, -halfL], [halfW, -halfL],
      [-halfW,  0],                  [halfW,  0],
      [-halfW,  halfL], [0,  halfL], [halfW,  halfL]
    ];

    for (const [px, pz] of pillarCoords) {
      const post = new THREE.Mesh(postGeo, this.materials.aluTruss);
      post.position.set(px, courtH * 0.5, pz);
      post.castShadow = true;
      this.rootGroup.add(post);

      // Heavy black ballast base block
      const base = new THREE.Mesh(
        new THREE.BoxGeometry(0.65, 0.32, 0.65),
        this.materials.carbonCage
      );
      base.position.set(px, 0.16, pz);
      this.rootGroup.add(base);
    }

    // Top longitudinal & transverse truss bars
    const longBarGeo = new THREE.CylinderGeometry(0.12, 0.12, halfL * 2, 10);
    longBarGeo.rotateX(Math.PI / 2);
    for (const px of [-halfW, 0, halfW]) {
      const bar = new THREE.Mesh(longBarGeo, this.materials.aluTruss);
      bar.position.set(px, courtH, 0);
      this.rootGroup.add(bar);
    }

    const crossBarGeo = new THREE.CylinderGeometry(0.12, 0.12, halfW * 2, 10);
    crossBarGeo.rotateZ(Math.PI / 2);
    for (const pz of [-halfL, 0, halfL]) {
      const bar = new THREE.Mesh(crossBarGeo, this.materials.aluTruss);
      bar.position.set(0, courtH, pz);
      this.rootGroup.add(bar);
    }

    // 2. Fine Mesh Safety Netting Walls & Ceiling
    const sideNetGeo = new THREE.PlaneGeometry(halfL * 2, courtH);
    const leftNet = new THREE.Mesh(sideNetGeo, this.materials.netting);
    leftNet.rotation.y = Math.PI / 2;
    leftNet.position.set(-halfW, courtH * 0.5, 0);
    this.rootGroup.add(leftNet);

    const rightNet = new THREE.Mesh(sideNetGeo, this.materials.netting);
    rightNet.rotation.y = -Math.PI / 2;
    rightNet.position.set(halfW, courtH * 0.5, 0);
    this.rootGroup.add(rightNet);

    const endNetGeo = new THREE.PlaneGeometry(halfW * 2, courtH);
    const northNet = new THREE.Mesh(endNetGeo, this.materials.netting);
    northNet.position.set(0, courtH * 0.5, -halfL);
    this.rootGroup.add(northNet);

    const southNet = new THREE.Mesh(endNetGeo, this.materials.netting);
    southNet.rotation.y = Math.PI;
    southNet.position.set(0, courtH * 0.5, halfL);
    this.rootGroup.add(southNet);

    const topNet = new THREE.Mesh(new THREE.PlaneGeometry(halfW * 2, halfL * 2), this.materials.netting);
    topNet.rotation.x = Math.PI / 2;
    topNet.position.set(0, courtH, 0);
    this.rootGroup.add(topNet);

    // Register Netted Court Boundary Colliders so drones stay inside the netted cage
    const wallThick = 0.4;
    this.addBoxCollider(-halfW - wallThick, 0, -halfL, -halfW, courtH + 0.5, halfL, 'net', 0.45);
    this.addBoxCollider( halfW, 0, -halfL,  halfW + wallThick, courtH + 0.5, halfL, 'net', 0.45);
    this.addBoxCollider(-halfW, 0, -halfL - wallThick, halfW, courtH + 0.5, -halfL, 'net', 0.45);
    this.addBoxCollider(-halfW, 0,  halfL, halfW, courtH + 0.5,  halfL + wallThick, 'net', 0.45);
    this.addBoxCollider(-halfW, courtH, -halfL, halfW, courtH + wallThick, halfL, 'net', 0.45);
  }

  /**
   * Build the Two Glowing Circular Ring Goals Suspended Mid-Air at Opposite Ends:
   * - Blue Goal Ring at Z = -9.2m, Y = 3.0m (Target for Red Player & Red AI)
   * - Red Goal Ring at Z = +9.2m, Y = 3.0m (Defended by Red Team)
   */
  buildSuspendedRingGoals() {
    this.goals = {
      blue: { z: -9.2, y: 3.0, radius: 1.35, color: 0x00b4ff },
      red:  { z:  9.2, y: 3.0, radius: 1.35, color: 0xff1e42 }
    };

    const createGoalAssembly = (cfg, isBlue) => {
      const group = new THREE.Group();
      group.position.set(0, cfg.y, cfg.z);

      // Outer Carbon/Aluminum Housing Ring
      const outerTorus = new THREE.Mesh(
        new THREE.TorusGeometry(cfg.radius + 0.12, 0.09, 16, 48),
        this.materials.carbonCage
      );
      group.add(outerTorus);

      // Inner Glowing Neon LED Ring
      const ledMat = new THREE.MeshBasicMaterial({ color: cfg.color });
      const innerTorus = new THREE.Mesh(
        new THREE.TorusGeometry(cfg.radius, 0.075, 16, 48),
        ledMat
      );
      group.add(innerTorus);

      // Suspension Steel Cables to Top Truss (Y = 6.4m)
      const cableMat = new THREE.MeshStandardMaterial({ color: 0x94a3b8, metalness: 0.8, roughness: 0.3 });
      for (const sx of [-1, 1]) {
        const cable = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 3.4, 6), cableMat);
        cable.position.set(sx * (cfg.radius * 0.85), 1.8, 0);
        cable.rotation.z = sx * 0.18;
        group.add(cable);
      }

      // Goal PointLight for Arena Floor Reflection
      const light = new THREE.PointLight(cfg.color, 3.2, 12, 1.6);
      group.add(light);

      if (isBlue) {
        this.blueGoalLedMat = ledMat;
        this.blueGoalLight = light;
      } else {
        this.redGoalLedMat = ledMat;
        this.redGoalLight = light;
      }

      this.rootGroup.add(group);

      // Add Physical Torus Rim Colliders (Top, Bottom, Left, Right arcs of the goal ring)
      const r = cfg.radius;
      const t = 0.22;
      this.addBoxCollider(-r * 0.75, cfg.y + r - t, cfg.z - t, r * 0.75, cfg.y + r + t, cfg.z + t, 'goal_rim', 0.55);
      this.addBoxCollider(-r * 0.75, cfg.y - r - t, cfg.z - t, r * 0.75, cfg.y - r + t, cfg.z + t, 'goal_rim', 0.55);
      this.addBoxCollider(-r - t, cfg.y - r * 0.75, cfg.z - t, -r + t, cfg.y + r * 0.75, cfg.z + t, 'goal_rim', 0.55);
      this.addBoxCollider( r - t, cfg.y - r * 0.75, cfg.z - t,  r + t, cfg.y + r * 0.75, cfg.z + t, 'goal_rim', 0.55);
    };

    createGoalAssembly(this.goals.blue, true);
    createGoalAssembly(this.goals.red, false);
  }

  /**
   * Build the Center-Hung Taipei Dome Digital Jumbotron Scoreboard
   * matching the reference photo ("DRONE SOCCER GRAND FINALS - TAIPEI DOME | RED: 3 | BLUE: 2 | 12:45")
   */
  buildJumbotronScoreboard() {
    this.jumboCanvas = document.createElement('canvas');
    this.jumboCanvas.width = 512;
    this.jumboCanvas.height = 192;
    this.jumboCtx = this.jumboCanvas.getContext('2d');
    this.jumboTexture = new THREE.CanvasTexture(this.jumboCanvas);
    this.jumboTexture.colorSpace = THREE.SRGBColorSpace;

    this.renderJumbotronTexture();

    const jumboGroup = new THREE.Group();
    jumboGroup.position.set(0, 15.2, 0);

    // Central Octagonal/Box Housing
    const housing = new THREE.Mesh(
      new THREE.BoxGeometry(8.2, 3.2, 5.4),
      new THREE.MeshStandardMaterial({ color: 0x090d16, roughness: 0.4, metalness: 0.7 })
    );
    jumboGroup.add(housing);

    const screenMat = new THREE.MeshBasicMaterial({ map: this.jumboTexture });
    // Front & Back Main Scoreboard Screens
    const frontScreen = new THREE.Mesh(new THREE.PlaneGeometry(8.0, 2.8), screenMat);
    frontScreen.position.set(0, 0, 2.72);
    jumboGroup.add(frontScreen);

    const backScreen = new THREE.Mesh(new THREE.PlaneGeometry(8.0, 2.8), screenMat);
    backScreen.rotation.y = Math.PI;
    backScreen.position.set(0, 0, -2.72);
    jumboGroup.add(backScreen);

    // Left & Right Screens
    const leftScreen = new THREE.Mesh(new THREE.PlaneGeometry(5.2, 2.8), screenMat);
    leftScreen.rotation.y = -Math.PI / 2;
    leftScreen.position.set(-4.12, 0, 0);
    jumboGroup.add(leftScreen);

    const rightScreen = new THREE.Mesh(new THREE.PlaneGeometry(5.2, 2.8), screenMat);
    rightScreen.rotation.y = Math.PI / 2;
    rightScreen.position.set(4.12, 0, 0);
    jumboGroup.add(rightScreen);

    this.rootGroup.add(jumboGroup);
  }

  renderJumbotronTexture() {
    const ctx = this.jumboCtx;
    const w = 512;
    const h = 192;

    ctx.fillStyle = '#070b14';
    ctx.fillRect(0, 0, w, h);

    // Top Header Banner
    const topGrad = ctx.createLinearGradient(0, 0, w, 0);
    topGrad.addColorStop(0, '#1e3a8a');
    topGrad.addColorStop(0.5, '#0284c7');
    topGrad.addColorStop(1, '#1e3a8a');
    ctx.fillStyle = topGrad;
    ctx.fillRect(0, 0, w, 46);

    ctx.font = 'bold 19px "JetBrains Mono", sans-serif';
    ctx.fillStyle = '#f8fafc';
    ctx.textAlign = 'center';
    ctx.fillText('DRONE SOCCER GRAND FINALS - TAIPEI DOME', w * 0.5, 30);

    // Red Team Box
    ctx.fillStyle = 'rgba(225, 29, 72, 0.28)';
    ctx.fillRect(16, 58, 152, 82);
    ctx.strokeStyle = '#ff1e42';
    ctx.lineWidth = 3;
    ctx.strokeRect(16, 58, 152, 82);

    ctx.font = 'bold 40px "JetBrains Mono", monospace';
    ctx.fillStyle = '#ff4d6d';
    ctx.fillText(`RED: ${this.scoreRed}`, 92, 114);

    // Blue Team Box
    ctx.fillStyle = 'rgba(2, 132, 199, 0.28)';
    ctx.fillRect(180, 58, 152, 82);
    ctx.strokeStyle = '#00b4ff';
    ctx.strokeRect(180, 58, 152, 82);

    ctx.font = 'bold 40px "JetBrains Mono", monospace';
    ctx.fillStyle = '#38bdf8';
    ctx.fillText(`BLUE: ${this.scoreBlue}`, 256, 114);

    // Match Clock Box
    ctx.fillStyle = 'rgba(15, 23, 42, 0.9)';
    ctx.fillRect(344, 58, 152, 82);
    ctx.strokeStyle = '#475569';
    ctx.strokeRect(344, 58, 152, 82);

    const mins = Math.floor(this.matchTimeSec / 60);
    const secs = Math.floor(this.matchTimeSec % 60);
    const timeStr = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    ctx.font = 'bold 38px "JetBrains Mono", monospace';
    ctx.fillStyle = '#f8fafc';
    ctx.fillText(timeStr, 420, 108);
    ctx.font = 'bold 13px "JetBrains Mono", sans-serif';
    ctx.fillStyle = '#94a3b8';
    ctx.fillText('2nd PERIOD • 5v5', 420, 130);

    // Bottom Status Ticker
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 152, w, 40);
    ctx.font = 'bold 16px "JetBrains Mono", sans-serif';
    ctx.fillStyle = this.goalFlashTimer > 0 ? '#fbbf24' : '#38bdf8';
    ctx.fillText(this.lastScorerText, w * 0.5, 178);

    this.jumboTexture.needsUpdate = true;
  }

  /**
   * Create a Detailed Spherical Drone Encased in a Matte-Black Carbon-Fiber Protective Exoskeleton Cage
   * with Bright Red or Electric Blue Internal LEDs & High-Speed Motion-Blur Rotors
   */
  createSphericalExoskeletonDroneMesh(team = 'red', radius = 0.34) {
    const droneGroup = new THREE.Group();
    const isRed = team === 'red';
    const ledHex = isRed ? 0xff1e38 : 0x00b4ff;

    // 1. Matte-Black Carbon-Fiber Protective Exoskeleton Cage (Meridian & Latitudinal Geodesic Rings)
    const cageGroup = new THREE.Group();
    const ringTube = 0.013;

    // 3 Orthogonal Primary Carbon Rings
    for (let i = 0; i < 3; i++) {
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(radius, ringTube, 8, 36),
        this.materials.carbonCage
      );
      if (i === 1) ring.rotation.x = Math.PI / 2;
      if (i === 2) ring.rotation.y = Math.PI / 2;
      cageGroup.add(ring);
    }

    // 4 Diagonal Meridian Carbon Ribs (characteristic FIDA Drone Soccer spherical cage weave)
    for (let i = 0; i < 4; i++) {
      const rib = new THREE.Mesh(
        new THREE.TorusGeometry(radius * 0.995, ringTube * 0.82, 6, 32),
        this.materials.carbonCage
      );
      rib.rotation.y = (i * Math.PI) / 4;
      rib.rotation.x = Math.PI / 4;
      cageGroup.add(rib);
    }

    // Upper & Lower Latitudinal Guard Rings
    for (const latY of [-0.52, 0.52]) {
      const latR = radius * Math.sqrt(1 - latY * latY);
      const latRing = new THREE.Mesh(
        new THREE.TorusGeometry(latR, ringTube * 0.78, 6, 28),
        this.materials.carbonCage
      );
      latRing.rotation.x = Math.PI / 2;
      latRing.position.y = latY * radius;
      cageGroup.add(latRing);
    }
    droneGroup.add(cageGroup);

    // 2. Bright Internal LED Ring & Glowing Core Strips (Red vs Electric Blue)
    const ledMat = new THREE.MeshBasicMaterial({ color: ledHex });
    const equatorialLed = new THREE.Mesh(
      new THREE.TorusGeometry(radius * 0.86, 0.016, 8, 32),
      ledMat
    );
    equatorialLed.rotation.x = Math.PI / 2;
    droneGroup.add(equatorialLed);

    const crossLed = new THREE.Mesh(
      new THREE.TorusGeometry(radius * 0.84, 0.012, 8, 32),
      ledMat
    );
    droneGroup.add(crossLed);

    // 3. Internal Quadcopter Frame & 4 High-Speed Motion-Blur Propeller Discs
    const coreBox = new THREE.Mesh(
      new THREE.BoxGeometry(0.14, 0.05, 0.18),
      this.materials.carbonCage
    );
    droneGroup.add(coreBox);

    const blurMat = new THREE.MeshBasicMaterial({
      color: isRed ? 0xff6b81 : 0x7dd3fc,
      transparent: true,
      opacity: 0.42,
      side: THREE.DoubleSide,
      depthWrite: false
    });

    const armOffset = 0.12;
    const rotorDiscs = [];
    for (const [rx, rz] of [[armOffset, -armOffset], [armOffset, armOffset], [-armOffset, armOffset], [-armOffset, -armOffset]]) {
      const disc = new THREE.Mesh(new THREE.CircleGeometry(0.085, 16), blurMat);
      disc.rotation.x = -Math.PI / 2;
      disc.position.set(rx, 0.025, rz);
      droneGroup.add(disc);
      rotorDiscs.push(disc);
    }

    return { droneGroup, rotorDiscs, ledMat };
  }

  /**
   * Spawn 9 Autonomous AI Drone Soccer Players:
   * - 4 Red Teammates (+ 1 Red Player = 5 Red Drones)
   * - 5 Electric Blue Opponents (= 5 Blue Drones)
   * Total = 10 Spherical Carbon-Fiber Exoskeleton Drones in the Court!
   */
  spawnAIDroneSquads() {
    const configs = [
      // 4 Red Teammates (Player is Red #1 Striker)
      { team: 'red',  role: 'winger',   home: new THREE.Vector3(-2.4, 2.8,  2.2), phase: 0.0 },
      { team: 'red',  role: 'winger',   home: new THREE.Vector3( 2.4, 3.1,  1.8), phase: 1.4 },
      { team: 'red',  role: 'defender', home: new THREE.Vector3(-1.4, 2.9,  6.2), phase: 2.7 },
      { team: 'red',  role: 'keeper',   home: new THREE.Vector3( 0.5, 3.0,  8.0), phase: 4.1 },

      // 5 Electric Blue Opponents
      { team: 'blue', role: 'striker',  home: new THREE.Vector3( 0.0, 3.0, -2.5), phase: 0.6 },
      { team: 'blue', role: 'winger',   home: new THREE.Vector3(-2.5, 2.7, -3.2), phase: 1.9 },
      { team: 'blue', role: 'winger',   home: new THREE.Vector3( 2.5, 3.3, -2.8), phase: 3.2 },
      { team: 'blue', role: 'defender', home: new THREE.Vector3(-1.3, 2.9, -6.5), phase: 4.5 },
      { team: 'blue', role: 'keeper',   home: new THREE.Vector3( 0.0, 3.0, -8.1), phase: 5.4 }
    ];

    for (const cfg of configs) {
      const { droneGroup, rotorDiscs } = this.createSphericalExoskeletonDroneMesh(cfg.team, 0.34);
      droneGroup.position.copy(cfg.home);
      this.rootGroup.add(droneGroup);

      this.aiDrones.push({
        team: cfg.team,
        role: cfg.role,
        mesh: droneGroup,
        rotorDiscs,
        position: cfg.home.clone(),
        velocity: new THREE.Vector3(0, 0, 0),
        home: cfg.home.clone(),
        phase: cfg.phase,
        radius: 0.35
      });
    }
  }

  /**
   * Update AI Drone Combat, Banking, Sphere-to-Sphere Collisions, Goal Ring Scoring & Jumbotron Clock
   */
  update(dt, playerPhysics) {
    if (!this.rootGroup.visible) return;

    // 1. Update Match Clock & Jumbotron
    const prevSec = Math.floor(this.matchTimeSec);
    this.matchTimeSec = Math.max(0, this.matchTimeSec - dt);
    if (this.matchTimeSec <= 0.1) {
      this.matchTimeSec = 15 * 60; // Restart period
    }
    if (this.goalCooldown > 0) this.goalCooldown -= dt;
    if (this.goalFlashTimer > 0) this.goalFlashTimer -= dt;

    if (Math.floor(this.matchTimeSec) !== prevSec) {
      this.renderJumbotronTexture();
    }

    const now = performance.now() * 0.001;
    const playerPos = playerPhysics.position;
    const playerVel = playerPhysics.velocity;

    // 2. Update Each AI Drone's Target Trajectory & Banking Attitude
    for (let i = 0; i < this.aiDrones.length; i++) {
      const ai = this.aiDrones[i];
      const t = now + ai.phase;

      const targetPos = ai.home.clone();
      if (ai.role === 'striker') {
        // Blue striker dives toward Red Goal (Z = +9.2) and loops back
        const cycle = (t * 0.55) % (Math.PI * 2);
        targetPos.x = Math.sin(t * 1.6) * 2.2;
        targetPos.y = 3.0 + Math.cos(t * 2.1) * 0.65;
        targetPos.z = -1.0 + Math.sin(cycle) * 7.8;
      } else if (ai.role === 'winger') {
        // Wingers weave and dogfight in mid-court
        targetPos.x = ai.home.x + Math.sin(t * 1.8) * 1.9;
        targetPos.y = ai.home.y + Math.cos(t * 2.3) * 0.85;
        targetPos.z = ai.home.z + Math.cos(t * 1.4) * 3.2;
      } else if (ai.role === 'defender') {
        // Defenders shadow and block approaching strikers
        const threatX = ai.team === 'blue' ? THREE.MathUtils.clamp(playerPos.x, -2.5, 2.5) : Math.sin(t * 1.5) * 1.8;
        targetPos.x = THREE.MathUtils.lerp(ai.home.x, threatX, 0.55);
        targetPos.y = 2.9 + Math.sin(t * 2.0) * 0.55;
        targetPos.z = ai.home.z + Math.sin(t * 1.2) * 0.9;
      } else if (ai.role === 'keeper') {
        // Goal Keeper guards the circular ring opening (Y = 3.0, X = 0)
        const guardX = ai.team === 'blue'
          ? THREE.MathUtils.clamp(playerPos.x * 0.55, -1.1, 1.1)
          : Math.sin(t * 2.2) * 0.95;
        targetPos.x = guardX;
        targetPos.y = 3.0 + Math.cos(t * 2.4) * 0.45;
        targetPos.z = ai.home.z;
      }

      // Smooth PD velocity pursuit
      const toTarget = targetPos.sub(ai.position);
      const accel = toTarget.multiplyScalar(4.8).sub(ai.velocity.clone().multiplyScalar(2.4));
      ai.velocity.addScaledVector(accel, dt);

      // Clamp AI speed
      const maxSpeed = 6.5;
      if (ai.velocity.length() > maxSpeed) {
        ai.velocity.setLength(maxSpeed);
      }

      ai.position.addScaledVector(ai.velocity, dt);

      // Keep inside netted court
      ai.position.x = THREE.MathUtils.clamp(ai.position.x, -6.4, 6.4);
      ai.position.y = THREE.MathUtils.clamp(ai.position.y, 0.45, 5.9);
      ai.position.z = THREE.MathUtils.clamp(ai.position.z, -11.3, 11.3);

      // Dynamic Mid-Air Banking (tilt pitch & roll into velocity/acceleration)
      ai.mesh.position.copy(ai.position);
      const bankPitch = THREE.MathUtils.clamp(ai.velocity.z * 0.11, -0.55, 0.55);
      const bankRoll  = THREE.MathUtils.clamp(-ai.velocity.x * 0.11, -0.55, 0.55);
      ai.mesh.rotation.set(bankPitch, Math.sin(t * 0.7) * 0.25, bankRoll);
    }

    // 3. AI-to-AI Sphere Separation
    for (let i = 0; i < this.aiDrones.length; i++) {
      for (let j = i + 1; j < this.aiDrones.length; j++) {
        const a = this.aiDrones[i];
        const b = this.aiDrones[j];
        const diff = a.position.clone().sub(b.position);
        const dist = diff.length();
        const minDist = a.radius + b.radius;
        if (dist > 0.001 && dist < minDist) {
          const n = diff.divideScalar(dist);
          const overlap = (minDist - dist) * 0.5;
          a.position.addScaledVector(n, overlap);
          b.position.addScaledVector(n, -overlap);
          a.velocity.addScaledVector(n, 1.8);
          b.velocity.addScaledVector(n, -1.8);
        }
      }
    }

    // 4. Player-to-AI Spherical Cage Elastic Collision (Mid-Air Blocking & Dogfighting)
    let hitDrone = false;
    const playerRadius = 0.35;
    for (let i = 0; i < this.aiDrones.length; i++) {
      const ai = this.aiDrones[i];
      const diff = playerPos.clone().sub(ai.position);
      const dist = diff.length();
      const minDist = playerRadius + ai.radius;
      if (dist > 0.001 && dist < minDist) {
        const n = diff.divideScalar(dist);
        const penetration = minDist - dist;
        playerPos.addScaledVector(n, penetration * 0.65);
        ai.position.addScaledVector(n, -penetration * 0.35);

        const relVel = playerVel.clone().sub(ai.velocity);
        const sepSpeed = relVel.dot(n);
        if (sepSpeed < 0) {
          const impulse = -(1.0 + 0.58) * sepSpeed * 0.5;
          playerVel.addScaledVector(n, impulse);
          ai.velocity.addScaledVector(n, -impulse * 1.35);
          playerPhysics.telemetry.collisionIntensity = Math.min(1.0, Math.abs(sepSpeed) / 5.0);
          hitDrone = true;
        }
      }
    }

    // 5. Check Goal Scoring Through Suspended Blue Circular Goal Ring (Z = -9.2, Y = 3.0)
    let scoredGoal = false;
    if (this.goalCooldown <= 0) {
      const bg = this.goals.blue;
      const dz = Math.abs(playerPos.z - bg.z);
      const radialDist = Math.hypot(playerPos.x, playerPos.y - bg.y);

      if (dz < 0.42 && radialDist < bg.radius - 0.18 && Math.abs(playerVel.z) > 0.6) {
        this.scoreRed += 1;
        this.goalCooldown = 2.5;
        this.goalFlashTimer = 2.5;
        this.lastScorerText = `GOAL! RED STRIKER SCORES! (RED ${this.scoreRed} - ${this.scoreBlue} BLUE)`;
        this.renderJumbotronTexture();
        scoredGoal = true;
      }
    }

    return { scoredGoal, hitDrone };
  }
}
