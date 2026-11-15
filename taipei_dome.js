/**
 * Procedural 3D Taipei Dome Stadium & 5v5 Drone Soccer Battle Engine (taipei_dome.js)
 *
 * Implements:
 * - Taipei Dome iconic White Curved Steel Space-Frame Roof Trusses & uniform stadium floodlights
 * - Stepped dark architectural spectator seating tiers (no noisy pixel dots) + glowing LED ribbon boards
 * - Enclosed Drone Soccer pitch with green turf mowing stripes, crisp court markings & fine mesh safety netting
 *   (perimeter-only truss frame so no middle bars ever block the 3rd-person camera!)
 * - Two suspended glowing circular ring goals (Red Goal Z=+11.2m, Blue Goal Z=-11.2m, Y=3.2m)
 * - Full Battle System:
 *   - Modes: '5v5' (10 drones), '1v1' (2 drones), 'free' (Free Flight)
 *   - FIDA Roles: 'striker' (with glowing Striker Halo, sole goal scorer) vs 'defender' (interceptor)
 *   - AI FSM State Machine ('rookie', 'pro', 'world' difficulties): Attack, Evade, Patrol, Intercept
 *   - 3D Collision Spark Particle System & FIDA Striker Goal Ring Plane-Crossing Detection
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

    // Court Dimensions ( spacious & camera-safe )
    this.courtHalfW = 9.0;  // Width 18m (-9 to +9)
    this.courtHalfL = 14.0; // Length 28m (-14 to +14)
    this.courtH = 7.6;      // Height 7.6m

    // Match Configuration & Telemetry
    this.gameMode = '5v5';       // '5v5' | '1v1' | 'free'
    this.playerRole = 'striker'; // 'striker' | 'defender'
    this.difficulty = 'pro';     // 'rookie' | 'pro' | 'world'

    this.scoreRed = 0;
    this.scoreBlue = 0;
    this.matchTimeSec = 180; // 03:00
    this.playerGoals = 0;
    this.playerBlocks = 0;
    this.blockCooldown = 0;
    this.lastScorerText = 'TAIPEI DOME 5v5 DRONE SOCCER LEAGUE';

    this.materials = {};
    this.buildProceduralTextures();
    this.buildStadiumLighting();
    this.buildStadiumArchitecture();
    this.buildNettedSoccerCourt();
    this.buildSuspendedRingGoals();
    this.buildJumbotronScoreboard();
    this.buildSparkParticleSystem();
    this.buildAIDronePool();
  }

  addBoxCollider(minX, minY, minZ, maxX, maxY, maxZ, tag = 'soccer', restitution = 0.5) {
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
    const hemiLight = new THREE.HemisphereLight(0xe2e8f0, 0x0f172a, 1.2);
    hemiLight.position.set(0, 30, 0);
    this.rootGroup.add(hemiLight);

    const stadiumSun = new THREE.DirectionalLight(0xf8fafc, 2.2);
    stadiumSun.position.set(12, 28, 14);
    stadiumSun.castShadow = true;
    stadiumSun.shadow.mapSize.width = 2048;
    stadiumSun.shadow.mapSize.height = 2048;
    stadiumSun.shadow.camera.near = 2;
    stadiumSun.shadow.camera.far = 65;
    const d = 22;
    stadiumSun.shadow.camera.left = -d;
    stadiumSun.shadow.camera.right = d;
    stadiumSun.shadow.camera.top = d;
    stadiumSun.shadow.camera.bottom = -d;
    stadiumSun.shadow.bias = -0.0005;
    this.rootGroup.add(stadiumSun);
  }

  /**
   * Generate procedural textures:
   * 1. Green Artificial Turf Pitch with crisp white/red/blue court lines
   * 2. Fine translucent safety mesh netting
   * 3. Stadium outer floor & LED Ribbon Boards
   */
  buildProceduralTextures() {
    const maxAniso = this.renderer.capabilities.getMaxAnisotropy
      ? this.renderer.capabilities.getMaxAnisotropy()
      : 4;

    // 1. Fine Mesh Safety Netting Texture (subtle, high-visibility transparency)
    const netCanvas = document.createElement('canvas');
    netCanvas.width = 128;
    netCanvas.height = 128;
    const nCtx = netCanvas.getContext('2d');
    nCtx.clearRect(0, 0, 128, 128);
    nCtx.strokeStyle = 'rgba(203, 213, 225, 0.24)';
    nCtx.lineWidth = 1.5;
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
    netTex.repeat.set(42, 14);
    this.materials.netting = new THREE.MeshStandardMaterial({
      map: netTex,
      transparent: true,
      alphaTest: 0.04,
      roughness: 0.5,
      metalness: 0.15,
      side: THREE.DoubleSide,
      depthWrite: false
    });

    // 2. Green Turf Soccer Pitch Texture with Mowing Stripes & Crisp Lines
    const turfCanvas = document.createElement('canvas');
    turfCanvas.width = 1024;
    turfCanvas.height = 1024;
    const tCtx = turfCanvas.getContext('2d');

    // Alternating turf mowing bands along Z
    const numStripes = 14;
    const stripeH = 1024 / numStripes;
    for (let i = 0; i < numStripes; i++) {
      tCtx.fillStyle = (i % 2 === 0) ? '#14532d' : '#166534';
      tCtx.fillRect(0, i * stripeH, 1024, stripeH + 1);
    }

    // Subtle grass blade grain
    for (let i = 0; i < 12000; i++) {
      const x = Math.random() * 1024;
      const y = Math.random() * 1024;
      tCtx.fillStyle = Math.random() > 0.5 ? 'rgba(34, 197, 94, 0.08)' : 'rgba(5, 46, 22, 0.12)';
      tCtx.fillRect(x, y, 2, 3);
    }

    // Outer white boundary rectangle
    tCtx.strokeStyle = 'rgba(248, 250, 252, 0.92)';
    tCtx.lineWidth = 10;
    tCtx.strokeRect(28, 28, 968, 968);

    // Center halfway line
    tCtx.beginPath();
    tCtx.moveTo(28, 512);
    tCtx.lineTo(996, 512);
    tCtx.stroke();

    // Center circle & kickoff spot
    tCtx.beginPath();
    tCtx.arc(512, 512, 120, 0, Math.PI * 2);
    tCtx.stroke();
    tCtx.fillStyle = '#f8fafc';
    tCtx.beginPath();
    tCtx.arc(512, 512, 12, 0, Math.PI * 2);
    tCtx.fill();

    // North (Blue) & South (Red) Goal Area Boxes & Attack Lines
    tCtx.strokeStyle = 'rgba(56, 189, 248, 0.85)';
    tCtx.lineWidth = 8;
    tCtx.strokeRect(262, 28, 500, 190);
    tCtx.beginPath();
    tCtx.moveTo(28, 310); tCtx.lineTo(996, 310);
    tCtx.stroke();

    tCtx.strokeStyle = 'rgba(251, 113, 133, 0.85)';
    tCtx.strokeRect(262, 806, 500, 190);
    tCtx.beginPath();
    tCtx.moveTo(28, 714); tCtx.lineTo(996, 714);
    tCtx.stroke();

    const turfTex = new THREE.CanvasTexture(turfCanvas);
    turfTex.anisotropy = maxAniso;
    turfTex.colorSpace = THREE.SRGBColorSpace;
    this.materials.turfPitch = new THREE.MeshStandardMaterial({
      map: turfTex,
      roughness: 0.62,
      metalness: 0.05
    });

    // 3. Outer Stadium Polished Concrete Concourse Floor
    this.materials.outerFloor = new THREE.MeshStandardMaterial({
      color: 0x1e2533,
      roughness: 0.32,
      metalness: 0.18
    });

    // 4. LED Ribbon Fascia Board Texture
    const ribCanvas = document.createElement('canvas');
    ribCanvas.width = 1024;
    ribCanvas.height = 64;
    const rCtx = ribCanvas.getContext('2d');
    rCtx.fillStyle = '#060a14';
    rCtx.fillRect(0, 0, 1024, 64);
    const ribGrad = rCtx.createLinearGradient(0, 0, 1024, 0);
    ribGrad.addColorStop(0.0, '#e11d48');
    ribGrad.addColorStop(0.25, '#0284c7');
    ribGrad.addColorStop(0.5, '#38bdf8');
    ribGrad.addColorStop(0.75, '#0284c7');
    ribGrad.addColorStop(1.0, '#e11d48');
    rCtx.fillStyle = ribGrad;
    rCtx.fillRect(0, 0, 1024, 5);
    rCtx.fillRect(0, 59, 1024, 5);
    rCtx.font = 'bold 24px "JetBrains Mono", sans-serif';
    rCtx.fillStyle = '#e2e8f0';
    rCtx.textAlign = 'center';
    rCtx.fillText('TAIPEI DOME DRONE SOCCER 5v5 LEAGUE   •   FIDA OFFICIAL ARENA   •   RED vs BLUE', 512, 40);

    const ribTex = new THREE.CanvasTexture(ribCanvas);
    ribTex.wrapS = THREE.RepeatWrapping;
    ribTex.wrapT = THREE.ClampToEdgeWrapping;
    ribTex.repeat.set(5, 1);
    ribTex.colorSpace = THREE.SRGBColorSpace;
    this.materials.ribbonLed = new THREE.MeshBasicMaterial({ map: ribTex });

    // 5. Structural Materials
    this.materials.carbonCage = new THREE.MeshStandardMaterial({
      color: 0x151821,
      roughness: 0.28,
      metalness: 0.65
    });
    this.materials.whiteTruss = new THREE.MeshStandardMaterial({
      color: 0xe2e8f0,
      roughness: 0.32,
      metalness: 0.58
    });
    this.materials.aluTruss = new THREE.MeshStandardMaterial({
      color: 0x64748b,
      roughness: 0.30,
      metalness: 0.80
    });
    this.materials.seatDark = new THREE.MeshStandardMaterial({
      color: 0x111726,
      roughness: 0.72,
      metalness: 0.15
    });
    this.materials.seatRiser = new THREE.MeshStandardMaterial({
      color: 0x1b2436,
      roughness: 0.65,
      metalness: 0.20
    });
  }

  /**
   * Build the Taipei Dome Stadium Architecture:
   * - Outer floor + Central Green Turf Pitch
   * - Clean 3D Stepped Dark Architectural Spectator Tiers (no noisy pixel dots!)
   * - Iconic White Curved Steel Space-Frame Roof Trusses & uniform overhead spotlights
   */
  buildStadiumArchitecture() {
    // 1. Outer Concourse Floor & Central Green Turf Soccer Pitch
    const outerFloor = new THREE.Mesh(new THREE.PlaneGeometry(110, 110), this.materials.outerFloor);
    outerFloor.rotation.x = -Math.PI / 2;
    outerFloor.receiveShadow = true;
    this.rootGroup.add(outerFloor);

    const turfMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(this.courtHalfW * 2, this.courtHalfL * 2),
      this.materials.turfPitch
    );
    turfMesh.rotation.x = -Math.PI / 2;
    turfMesh.position.y = 0.012;
    turfMesh.receiveShadow = true;
    this.rootGroup.add(turfMesh);

    // 2. Clean 3D Stepped Dark Architectural Spectator Seating Bowl (Lower & Upper Tiers)
    // Replaces the noisy pixel texture with authentic stepped architectural geometry
    for (let tier = 0; tier < 10; tier++) {
      const rInner = 25.0 + tier * 2.1;
      const rOuter = rInner + 2.15;
      const yBase = 0.6 + tier * 1.45;
      const tierH = 1.48;

      const stepRing = new THREE.Mesh(
        new THREE.CylinderGeometry(rOuter, rInner, tierH, 64, 1, true),
        tier % 2 === 0 ? this.materials.seatDark : this.materials.seatRiser
      );
      stepRing.scale.x = -1; // Face inward toward arena
      stepRing.position.y = yBase + tierH * 0.5;
      this.rootGroup.add(stepRing);

      // Horizontal seating bench ledge
      const ledge = new THREE.Mesh(
        new THREE.RingGeometry(rInner, rOuter, 64),
        this.materials.seatDark
      );
      ledge.rotation.x = -Math.PI / 2;
      ledge.position.y = yBase + tierH;
      this.rootGroup.add(ledge);
    }

    // Glowing Circular LED Ribbon Score Fascia between Lower & Upper Seating Tiers
    const ledRibbonLower = new THREE.Mesh(
      new THREE.CylinderGeometry(33.2, 33.2, 1.05, 64, 1, true),
      this.materials.ribbonLed
    );
    ledRibbonLower.scale.x = -1;
    ledRibbonLower.position.y = 7.8;
    this.rootGroup.add(ledRibbonLower);

    const ledRibbonUpper = new THREE.Mesh(
      new THREE.CylinderGeometry(45.5, 45.5, 1.25, 64, 1, true),
      this.materials.ribbonLed
    );
    ledRibbonUpper.scale.x = -1;
    ledRibbonUpper.position.y = 15.6;
    this.rootGroup.add(ledRibbonUpper);

    // 3. Taipei Dome Iconic White Curved Steel Space-Frame Roof Trusses
    const domeShell = new THREE.Mesh(
      new THREE.SphereGeometry(52, 48, 20, 0, Math.PI * 2, 0, Math.PI * 0.38),
      new THREE.MeshStandardMaterial({
        color: 0x334155,
        roughness: 0.78,
        metalness: 0.22,
        side: THREE.BackSide
      })
    );
    domeShell.scale.set(1, 0.46, 1);
    domeShell.position.y = 15.0;
    this.rootGroup.add(domeShell);

    // Primary Curved White Steel Space-Frame Arches + Diagonal Bracing
    const numArches = 16;
    for (let i = 0; i < numArches; i++) {
      const angle = (i / numArches) * Math.PI;
      const archGroup = new THREE.Group();
      archGroup.rotation.y = angle;

      // Upper & Lower chords of space-frame arch
      const upperChord = new THREE.Mesh(
        new THREE.TorusGeometry(47.5, 0.20, 8, 56, Math.PI),
        this.materials.whiteTruss
      );
      upperChord.scale.set(1, 0.36, 1);
      upperChord.position.y = 16.8;
      archGroup.add(upperChord);

      const lowerChord = new THREE.Mesh(
        new THREE.TorusGeometry(46.2, 0.16, 8, 56, Math.PI),
        this.materials.whiteTruss
      );
      lowerChord.scale.set(1, 0.35, 1);
      lowerChord.position.y = 16.0;
      archGroup.add(lowerChord);

      this.rootGroup.add(archGroup);
    }

    // Concentric Space-Frame Purlin Rings
    const purlinRadii = [12, 20, 28, 36, 44];
    const purlinHeights = [32.4, 31.0, 28.5, 24.8, 19.8];
    for (let r = 0; r < purlinRadii.length; r++) {
      const ringMesh = new THREE.Mesh(
        new THREE.TorusGeometry(purlinRadii[r], 0.20, 8, 64),
        this.materials.whiteTruss
      );
      ringMesh.rotation.x = Math.PI / 2;
      ringMesh.position.y = purlinHeights[r];
      this.rootGroup.add(ringMesh);
    }

    // 4. Uniform Overhead Stadium Floodlight Ring & Soft Volumetric Cones
    const floodRadius = 24;
    const floodY = 29.8;
    const numFloods = 16;
    const beamMat = new THREE.MeshBasicMaterial({
      color: 0xe0f2fe,
      transparent: true,
      opacity: 0.026,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide
    });

    for (let i = 0; i < numFloods; i++) {
      const a = (i / numFloods) * Math.PI * 2;
      const fx = Math.cos(a) * floodRadius;
      const fz = Math.sin(a) * floodRadius;

      const lampMesh = new THREE.Mesh(
        new THREE.BoxGeometry(2.2, 0.3, 0.8),
        new THREE.MeshBasicMaterial({ color: 0xffffff })
      );
      lampMesh.position.set(fx, floodY, fz);
      lampMesh.lookAt(0, 2, 0);
      this.rootGroup.add(lampMesh);

      const beamCone = new THREE.Mesh(new THREE.ConeGeometry(7.0, 28, 14, 1, true), beamMat);
      beamCone.position.set(fx * 0.65, 15.0, fz * 0.65);
      beamCone.lookAt(fx, floodY, fz);
      beamCone.rotateX(Math.PI / 2);
      this.rootGroup.add(beamCone);
    }
  }

  /**
   * Build the Central Enclosed Netted Drone Soccer Court:
   * - Perimeter-only aluminum truss frame (no center bars obstructing camera!)
   * - Translucent fine mesh safety netting
   */
  buildNettedSoccerCourt() {
    const halfW = this.courtHalfW; // 9.0m
    const halfL = this.courtHalfL; // 14.0m
    const courtH = this.courtH;    // 7.6m

    // Perimeter Corner & Side Pillars ONLY (no middle pillars at X=0)
    const postGeo = new THREE.CylinderGeometry(0.11, 0.11, courtH, 10);
    const pillarCoords = [
      [-halfW, -halfL], [halfW, -halfL],
      [-halfW, -halfL * 0.33], [halfW, -halfL * 0.33],
      [-halfW,  halfL * 0.33], [halfW,  halfL * 0.33],
      [-halfW,  halfL], [halfW,  halfL]
    ];

    for (const [px, pz] of pillarCoords) {
      const post = new THREE.Mesh(postGeo, this.materials.aluTruss);
      post.position.set(px, courtH * 0.5, pz);
      this.rootGroup.add(post);
    }

    // Top Perimeter Frame Bars ONLY (Left, Right, North, South outer edges)
    const longBarGeo = new THREE.CylinderGeometry(0.10, 0.10, halfL * 2, 10);
    longBarGeo.rotateX(Math.PI / 2);
    for (const px of [-halfW, halfW]) {
      const bar = new THREE.Mesh(longBarGeo, this.materials.aluTruss);
      bar.position.set(px, courtH, 0);
      this.rootGroup.add(bar);
    }

    const crossBarGeo = new THREE.CylinderGeometry(0.10, 0.10, halfW * 2, 10);
    crossBarGeo.rotateZ(Math.PI / 2);
    for (const pz of [-halfL, halfL]) {
      const bar = new THREE.Mesh(crossBarGeo, this.materials.aluTruss);
      bar.position.set(0, courtH, pz);
      this.rootGroup.add(bar);
    }

    // Fine Mesh Safety Netting Walls & Ceiling
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

    // Physical Netted Cage Boundary Colliders
    const wallThick = 0.5;
    this.addBoxCollider(-halfW - wallThick, 0, -halfL, -halfW, courtH + 0.5, halfL, 'net', 0.52);
    this.addBoxCollider( halfW, 0, -halfL,  halfW + wallThick, courtH + 0.5, halfL, 'net', 0.52);
    this.addBoxCollider(-halfW, 0, -halfL - wallThick, halfW, courtH + 0.5, -halfL, 'net', 0.52);
    this.addBoxCollider(-halfW, 0,  halfL, halfW, courtH + 0.5,  halfL + wallThick, 'net', 0.52);
    this.addBoxCollider(-halfW, courtH, -halfL, halfW, courtH + wallThick, halfL, 'net', 0.52);
  }

  /**
   * Build the Two Suspended Glowing Circular Ring Goals:
   * - Blue Goal Ring at Z = -11.2m, Y = 3.2m (Target for Red Striker)
   * - Red Goal Ring at Z = +11.2m, Y = 3.2m (Target for Blue Striker)
   */
  buildSuspendedRingGoals() {
    this.goals = {
      blue: { z: -11.2, y: 3.2, radius: 1.45, color: 0x00b4ff },
      red:  { z:  11.2, y: 3.2, radius: 1.45, color: 0xff1e42 }
    };

    const createGoalAssembly = (cfg) => {
      const group = new THREE.Group();
      group.position.set(0, cfg.y, cfg.z);

      const outerTorus = new THREE.Mesh(
        new THREE.TorusGeometry(cfg.radius + 0.13, 0.095, 16, 48),
        this.materials.carbonCage
      );
      group.add(outerTorus);

      const ledMat = new THREE.MeshBasicMaterial({ color: cfg.color });
      const innerTorus = new THREE.Mesh(
        new THREE.TorusGeometry(cfg.radius, 0.08, 16, 48),
        ledMat
      );
      group.add(innerTorus);

      // Thin suspension cables up to ceiling net
      const cableMat = new THREE.MeshStandardMaterial({ color: 0x94a3b8, metalness: 0.8, roughness: 0.3 });
      for (const sx of [-1, 1]) {
        const cable = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 4.2, 6), cableMat);
        cable.position.set(sx * (cfg.radius * 0.85), 2.1, 0);
        cable.rotation.z = sx * 0.14;
        group.add(cable);
      }

      const light = new THREE.PointLight(cfg.color, 3.5, 14, 1.5);
      group.add(light);

      this.rootGroup.add(group);

      // Physical Torus Rim Colliders
      const r = cfg.radius;
      const t = 0.22;
      this.addBoxCollider(-r * 0.72, cfg.y + r - t, cfg.z - t, r * 0.72, cfg.y + r + t, cfg.z + t, 'goal_rim', 0.6);
      this.addBoxCollider(-r * 0.72, cfg.y - r - t, cfg.z - t, r * 0.72, cfg.y - r + t, cfg.z + t, 'goal_rim', 0.6);
      this.addBoxCollider(-r - t, cfg.y - r * 0.72, cfg.z - t, -r + t, cfg.y + r * 0.72, cfg.z + t, 'goal_rim', 0.6);
      this.addBoxCollider( r - t, cfg.y - r * 0.72, cfg.z - t,  r + t, cfg.y + r * 0.72, cfg.z + t, 'goal_rim', 0.6);
    };

    createGoalAssembly(this.goals.blue);
    createGoalAssembly(this.goals.red);
  }

  /**
   * Build the Overhead Center-Hung Digital Jumbotron Scoreboard (High above court at Y=18m)
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
    jumboGroup.position.set(0, 18.0, 0);

    const housing = new THREE.Mesh(
      new THREE.BoxGeometry(8.6, 3.4, 5.6),
      new THREE.MeshStandardMaterial({ color: 0x090d16, roughness: 0.4, metalness: 0.7 })
    );
    jumboGroup.add(housing);

    const screenMat = new THREE.MeshBasicMaterial({ map: this.jumboTexture });
    const frontScreen = new THREE.Mesh(new THREE.PlaneGeometry(8.4, 3.0), screenMat);
    frontScreen.position.set(0, 0, 2.82);
    jumboGroup.add(frontScreen);

    const backScreen = new THREE.Mesh(new THREE.PlaneGeometry(8.4, 3.0), screenMat);
    backScreen.rotation.y = Math.PI;
    backScreen.position.set(0, 0, -2.82);
    jumboGroup.add(backScreen);

    this.rootGroup.add(jumboGroup);
  }

  renderJumbotronTexture() {
    if (!this.jumboCtx) return;
    const ctx = this.jumboCtx;
    const w = 512;
    const h = 192;

    ctx.fillStyle = '#070b14';
    ctx.fillRect(0, 0, w, h);

    const topGrad = ctx.createLinearGradient(0, 0, w, 0);
    topGrad.addColorStop(0, '#1e3a8a');
    topGrad.addColorStop(0.5, '#0284c7');
    topGrad.addColorStop(1, '#1e3a8a');
    ctx.fillStyle = topGrad;
    ctx.fillRect(0, 0, w, 44);

    ctx.font = 'bold 18px "JetBrains Mono", sans-serif';
    ctx.fillStyle = '#f8fafc';
    ctx.textAlign = 'center';
    ctx.fillText('TAIPEI DOME • DRONE SOCCER 5v5 LEAGUE', w * 0.5, 29);

    ctx.fillStyle = 'rgba(225, 29, 72, 0.28)';
    ctx.fillRect(16, 56, 152, 84);
    ctx.strokeStyle = '#ff1e42';
    ctx.lineWidth = 3;
    ctx.strokeRect(16, 56, 152, 84);
    ctx.font = 'bold 40px "JetBrains Mono", monospace';
    ctx.fillStyle = '#ff4d6d';
    ctx.fillText(`RED: ${this.scoreRed}`, 92, 114);

    ctx.fillStyle = 'rgba(2, 132, 199, 0.28)';
    ctx.fillRect(180, 56, 152, 84);
    ctx.strokeStyle = '#00b4ff';
    ctx.strokeRect(180, 56, 152, 84);
    ctx.font = 'bold 40px "JetBrains Mono", monospace';
    ctx.fillStyle = '#38bdf8';
    ctx.fillText(`BLUE: ${this.scoreBlue}`, 256, 114);

    ctx.fillStyle = 'rgba(15, 23, 42, 0.9)';
    ctx.fillRect(344, 56, 152, 84);
    ctx.strokeStyle = '#475569';
    ctx.strokeRect(344, 56, 152, 84);

    const mins = Math.floor(this.matchTimeSec / 60);
    const secs = Math.floor(this.matchTimeSec % 60);
    const timeStr = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    ctx.font = 'bold 38px "JetBrains Mono", monospace';
    ctx.fillStyle = '#f8fafc';
    ctx.fillText(timeStr, 420, 110);

    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 150, w, 42);
    ctx.font = 'bold 16px "JetBrains Mono", sans-serif';
    ctx.fillStyle = '#fbbf24';
    ctx.fillText(this.lastScorerText, w * 0.5, 177);

    this.jumboTexture.needsUpdate = true;
  }

  /**
   * 3D Collision Spark Particle System
   */
  buildSparkParticleSystem() {
    this.maxSparks = 160;
    this.sparkPositions = new Float32Array(this.maxSparks * 3);
    this.sparkColors = new Float32Array(this.maxSparks * 3);
    this.sparkVelocities = [];
    this.sparkLifetimes = new Float32Array(this.maxSparks);

    for (let i = 0; i < this.maxSparks; i++) {
      this.sparkVelocities.push(new THREE.Vector3());
      this.sparkLifetimes[i] = 0;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.sparkPositions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.sparkColors, 3));

    const mat = new THREE.PointsMaterial({
      size: 0.16,
      vertexColors: true,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });

    this.sparkPoints = new THREE.Points(geo, mat);
    this.sparkCursor = 0;
    this.rootGroup.add(this.sparkPoints);
  }

  spawnCollisionSparks(origin, count = 18, colorHex = 0xfbbf24) {
    const c = new THREE.Color(colorHex);
    for (let i = 0; i < count; i++) {
      const idx = this.sparkCursor;
      this.sparkCursor = (this.sparkCursor + 1) % this.maxSparks;

      this.sparkPositions[idx * 3 + 0] = origin.x;
      this.sparkPositions[idx * 3 + 1] = origin.y;
      this.sparkPositions[idx * 3 + 2] = origin.z;

      this.sparkColors[idx * 3 + 0] = c.r;
      this.sparkColors[idx * 3 + 1] = c.g;
      this.sparkColors[idx * 3 + 2] = c.b;

      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const speed = 2.5 + Math.random() * 6.5;
      this.sparkVelocities[idx].set(
        Math.sin(phi) * Math.cos(theta) * speed,
        Math.cos(phi) * speed + 1.2,
        Math.sin(phi) * Math.sin(theta) * speed
      );
      this.sparkLifetimes[idx] = 0.25 + Math.random() * 0.25;
    }
    this.sparkPoints.geometry.attributes.position.needsUpdate = true;
    this.sparkPoints.geometry.attributes.color.needsUpdate = true;
  }

  updateSparks(dt) {
    let anyActive = false;
    for (let i = 0; i < this.maxSparks; i++) {
      if (this.sparkLifetimes[i] > 0) {
        anyActive = true;
        this.sparkLifetimes[i] -= dt;
        const v = this.sparkVelocities[i];
        v.y -= 9.8 * dt;
        this.sparkPositions[i * 3 + 0] += v.x * dt;
        this.sparkPositions[i * 3 + 1] += v.y * dt;
        this.sparkPositions[i * 3 + 2] += v.z * dt;

        if (this.sparkLifetimes[i] <= 0) {
          this.sparkPositions[i * 3 + 1] = -999;
        }
      }
    }
    if (anyActive) {
      this.sparkPoints.geometry.attributes.position.needsUpdate = true;
    }
  }

  /**
   * Create a Spherical Carbon-Fiber Exoskeleton Drone Mesh with optional FIDA Striker Halo
   */
  createSphericalExoskeletonDroneMesh(team = 'red', radius = 0.35) {
    const droneGroup = new THREE.Group();
    const isRed = team === 'red';
    const ledHex = isRed ? 0xff1e38 : 0x00b4ff;

    const cageGroup = new THREE.Group();
    const ringTube = 0.013;

    for (let i = 0; i < 3; i++) {
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(radius, ringTube, 8, 36),
        this.materials.carbonCage
      );
      if (i === 1) ring.rotation.x = Math.PI / 2;
      if (i === 2) ring.rotation.y = Math.PI / 2;
      cageGroup.add(ring);
    }

    for (let i = 0; i < 4; i++) {
      const rib = new THREE.Mesh(
        new THREE.TorusGeometry(radius * 0.995, ringTube * 0.82, 6, 32),
        this.materials.carbonCage
      );
      rib.rotation.y = (i * Math.PI) / 4;
      rib.rotation.x = Math.PI / 4;
      cageGroup.add(rib);
    }

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

    // Internal Team LED Illumination
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

    // FIDA Striker Designated Halo Ring (visible only on the team's Striker)
    const strikerHalo = new THREE.Group();
    const haloColor = isRed ? 0xfbbf24 : 0x38bdf8;
    const haloMat = new THREE.MeshBasicMaterial({ color: haloColor });
    const crownRing = new THREE.Mesh(new THREE.TorusGeometry(radius * 0.75, 0.018, 8, 32), haloMat);
    crownRing.rotation.x = Math.PI / 2;
    crownRing.position.y = radius + 0.07;
    strikerHalo.add(crownRing);

    const outerBeacon = new THREE.Mesh(new THREE.TorusGeometry(radius * 1.07, 0.012, 8, 32), haloMat);
    outerBeacon.rotation.x = Math.PI / 2;
    strikerHalo.add(outerBeacon);
    droneGroup.add(strikerHalo);

    // Core & 4 Motion-Blur Rotors
    const coreBox = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.05, 0.18), this.materials.carbonCage);
    droneGroup.add(coreBox);

    const blurMat = new THREE.MeshBasicMaterial({
      color: isRed ? 0xff6b81 : 0x7dd3fc,
      transparent: true,
      opacity: 0.44,
      side: THREE.DoubleSide,
      depthWrite: false
    });
    const armOffset = 0.12;
    for (const [rx, rz] of [[armOffset, -armOffset], [armOffset, armOffset], [-armOffset, armOffset], [-armOffset, -armOffset]]) {
      const disc = new THREE.Mesh(new THREE.CircleGeometry(0.085, 16), blurMat);
      disc.rotation.x = -Math.PI / 2;
      disc.position.set(rx, 0.025, rz);
      droneGroup.add(disc);
    }

    return { droneGroup, strikerHalo };
  }

  /**
   * Build Pool of 9 AI Drones (4 Red + 5 Blue)
   */
  buildAIDronePool() {
    this.aiPool = [];
    const slotDefs = [
      // 4 Red AI Slots (Red #0 becomes Striker if player chooses Defender)
      { team: 'red',  defaultRole: 'winger',   home: new THREE.Vector3(-2.6, 3.2,  4.2), phase: 0.0 },
      { team: 'red',  defaultRole: 'winger',   home: new THREE.Vector3( 2.6, 3.2,  4.2), phase: 1.4 },
      { team: 'red',  defaultRole: 'defender', home: new THREE.Vector3(-1.6, 3.2,  7.6), phase: 2.7 },
      { team: 'red',  defaultRole: 'keeper',   home: new THREE.Vector3( 0.0, 3.2,  9.4), phase: 4.1 },

      // 5 Blue AI Slots (Blue #0 is always Blue's designated Striker)
      { team: 'blue', defaultRole: 'striker',  home: new THREE.Vector3( 0.0, 3.2, -3.8), phase: 0.5 },
      { team: 'blue', defaultRole: 'winger',   home: new THREE.Vector3(-2.6, 3.2, -4.4), phase: 1.9 },
      { team: 'blue', defaultRole: 'winger',   home: new THREE.Vector3( 2.6, 3.2, -4.4), phase: 3.2 },
      { team: 'blue', defaultRole: 'defender', home: new THREE.Vector3(-1.6, 3.2, -7.6), phase: 4.5 },
      { team: 'blue', defaultRole: 'keeper',   home: new THREE.Vector3( 0.0, 3.2, -9.4), phase: 5.4 }
    ];

    for (const def of slotDefs) {
      const { droneGroup, strikerHalo } = this.createSphericalExoskeletonDroneMesh(def.team, 0.35);
      droneGroup.position.copy(def.home);
      this.rootGroup.add(droneGroup);

      this.aiPool.push({
        team: def.team,
        defaultRole: def.defaultRole,
        role: def.defaultRole,
        isStriker: def.defaultRole === 'striker',
        active: true,
        mesh: droneGroup,
        strikerHalo,
        position: def.home.clone(),
        prevZ: def.home.z,
        velocity: new THREE.Vector3(),
        home: def.home.clone(),
        phase: def.phase,
        radius: 0.36
      });
    }
  }

  /**
   * Configure Match Mode ('5v5', '1v1', 'free'), Player Role ('striker', 'defender'), and Difficulty
   */
  setupMatch(mode, playerRole, difficulty) {
    this.gameMode = mode;
    this.playerRole = playerRole;
    this.difficulty = difficulty;

    this.scoreRed = 0;
    this.scoreBlue = 0;
    this.matchTimeSec = 180; // 03:00
    this.playerGoals = 0;
    this.playerBlocks = 0;
    this.blockCooldown = 0;
    this.lastScorerText = `MODE: ${mode.toUpperCase()} • ROLE: ${playerRole.toUpperCase()}`;

    for (let i = 0; i < this.aiPool.length; i++) {
      const ai = this.aiPool[i];
      if (mode === 'free') {
        ai.active = false;
      } else if (mode === '1v1') {
        // In 1v1: only Blue #0 (index 4) is active
        ai.active = (i === 4);
      } else {
        // 5v5: all 9 AI drones active
        ai.active = true;
      }

      // Assign FIDA Striker Role
      if (ai.team === 'red') {
        if (i === 0 && playerRole === 'defender') {
          ai.role = 'striker';
          ai.isStriker = true;
        } else {
          ai.role = ai.defaultRole;
          ai.isStriker = false;
        }
      } else {
        ai.role = ai.defaultRole;
        ai.isStriker = (i === 4); // Blue #0 is Blue Striker
      }

      ai.mesh.visible = ai.active;
      ai.strikerHalo.visible = ai.isStriker;
    }

    this.renderJumbotronTexture();
  }

  /**
   * Reset all active drones (Player + AI) to their pre-kickoff half-court formations
   */
  resetToFormation(playerPhysics) {
    // Position Player on Red Half
    if (this.playerRole === 'striker') {
      playerPhysics.spawnPoint.set(0, 3.2, 3.8);
    } else {
      playerPhysics.spawnPoint.set(0, 3.2, 8.2);
    }
    playerPhysics.reset();

    for (let i = 0; i < this.aiPool.length; i++) {
      const ai = this.aiPool[i];
      ai.position.copy(ai.home);
      if (ai.team === 'red' && i === 0 && this.playerRole === 'defender') {
        ai.position.set(0, 3.2, 3.8);
      }
      ai.prevZ = ai.position.z;
      ai.velocity.set(0, 0, 0);
      ai.mesh.position.copy(ai.position);
      ai.mesh.rotation.set(0, 0, 0);
    }
  }

  getDifficultyProfile() {
    if (this.difficulty === 'rookie') {
      return { maxSpeed: 4.5, accelGain: 3.4, evadeStrength: 1.5, interceptGain: 0.45 };
    } else if (this.difficulty === 'world') {
      return { maxSpeed: 8.6, accelGain: 6.2, evadeStrength: 3.6, interceptGain: 0.92 };
    }
    // 'pro' default
    return { maxSpeed: 6.6, accelGain: 4.8, evadeStrength: 2.5, interceptGain: 0.72 };
  }

  /**
   * Step AI State Machine, Sphere-to-Sphere Collisions, Spark Particles & FIDA Goal Ring Detection
   * @param {number} dt
   * @param {DronePhysics} playerPhysics
   * @param {boolean} matchActive - If false (e.g. during 3-2-1 countdown), AI hovers in formation
   */
  update(dt, playerPhysics, matchActive = true) {
    this.updateSparks(dt);
    if (this.blockCooldown > 0) this.blockCooldown -= dt;

    if (!matchActive) {
      // Hover smoothly in formation during countdown or menu orbit
      const now = performance.now() * 0.001;
      for (const ai of this.aiPool) {
        if (!ai.active) continue;
        ai.mesh.position.x = ai.position.x;
        ai.mesh.position.y = ai.position.y + Math.sin(now * 3.0 + ai.phase) * 0.08;
        ai.mesh.position.z = ai.position.z;
      }
      return null;
    }

    // 1. Update Match Timer
    const prevSec = Math.floor(this.matchTimeSec);
    if (this.gameMode !== 'free') {
      this.matchTimeSec = Math.max(0, this.matchTimeSec - dt);
    }
    if (Math.floor(this.matchTimeSec) !== prevSec) {
      this.renderJumbotronTexture();
    }

    const prof = this.getDifficultyProfile();
    const now = performance.now() * 0.001;
    const playerPos = playerPhysics.position;
    const playerVel = playerPhysics.velocity;

    // Identify Red Striker Position & Blue Striker Position for AI Defenders to intercept
    let redStrikerPos = playerPos;
    if (this.playerRole === 'defender' && this.aiPool[0].active) {
      redStrikerPos = this.aiPool[0].position;
    }
    const blueStriker = this.aiPool[4];

    // 2. AI Behavior State Machine (Attack, Evade, Patrol, Intercept)
    for (let i = 0; i < this.aiPool.length; i++) {
      const ai = this.aiPool[i];
      if (!ai.active) continue;

      ai.prevZ = ai.position.z;
      const t = now + ai.phase;
      const targetPos = ai.home.clone();

      if (ai.isStriker) {
        // STRIKER FSM: Dive toward opposing circular goal ring (Y=3.2, X=0) and loop back after crossing
        const targetGoalZ = ai.team === 'red' ? this.goals.blue.z : this.goals.red.z;
        const dirSign = ai.team === 'red' ? -1 : 1; // Red attacks -Z, Blue attacks +Z

        // Aim past the goal plane so the striker flies cleanly through the ring
        const passedGoal = (ai.team === 'red' && ai.position.z < targetGoalZ - 0.6) ||
                           (ai.team === 'blue' && ai.position.z > targetGoalZ + 0.6);

        if (passedGoal) {
          // Loop wide back to midfield for next attack run
          targetPos.set(Math.sin(t * 1.8) * 4.2, 3.4, dirSign * 2.0);
        } else {
          // Approach goal ring center (X=0, Y=3.2) with evasive weaving when far
          const distToGoalZ = Math.abs(targetGoalZ - ai.position.z);
          const weaveX = distToGoalZ > 3.2 ? Math.sin(t * 2.1) * 1.6 : 0.0;
          targetPos.set(weaveX, this.goals.blue.y, targetGoalZ + dirSign * 1.4);

          // Evade nearby opposing defenders
          if (ai.team === 'blue') {
            const dPlayer = ai.position.distanceTo(playerPos);
            if (dPlayer < 2.6) {
              const evadeX = ai.position.x >= playerPos.x ? 1 : -1;
              targetPos.x += evadeX * prof.evadeStrength;
            }
          }
        }
      } else if (ai.role === 'keeper') {
        // GOALKEEPER FSM: Guard the goal ring aperture (X in [-1.2, 1.2], Y in [2.4, 4.0])
        const enemyStrikerPos = ai.team === 'blue' ? redStrikerPos : (blueStriker ? blueStriker.position : playerPos);
        targetPos.x = THREE.MathUtils.clamp(enemyStrikerPos.x * prof.interceptGain, -1.25, 1.25);
        targetPos.y = THREE.MathUtils.clamp(enemyStrikerPos.y, 2.3, 4.1);
        targetPos.z = ai.home.z;
      } else if (ai.role === 'defender') {
        // DEFENDER FSM: Patrol penalty zone & ram approaching enemy striker
        const enemyStrikerPos = ai.team === 'blue' ? redStrikerPos : (blueStriker ? blueStriker.position : playerPos);
        const inThreatZone = (ai.team === 'blue' && enemyStrikerPos.z < -1.5) ||
                             (ai.team === 'red'  && enemyStrikerPos.z >  1.5);
        if (inThreatZone) {
          targetPos.copy(enemyStrikerPos);
          targetPos.z = THREE.MathUtils.clamp(targetPos.z, ai.team === 'blue' ? -10.2 : 2.0, ai.team === 'blue' ? -2.0 : 10.2);
        } else {
          targetPos.x = ai.home.x + Math.sin(t * 1.7) * 2.2;
          targetPos.y = 3.2 + Math.cos(t * 2.0) * 0.6;
          targetPos.z = ai.home.z;
        }
      } else {
        // WINGER FSM: Midfield support & blocking
        targetPos.x = ai.home.x + Math.sin(t * 1.6) * 2.4;
        targetPos.y = 3.2 + Math.cos(t * 2.1) * 0.75;
        targetPos.z = ai.home.z + Math.sin(t * 1.2) * 3.5;
      }

      const toTarget = targetPos.sub(ai.position);
      const accel = toTarget.multiplyScalar(prof.accelGain).sub(ai.velocity.clone().multiplyScalar(2.2));
      ai.velocity.addScaledVector(accel, dt);

      if (ai.velocity.length() > prof.maxSpeed) {
        ai.velocity.setLength(prof.maxSpeed);
      }

      ai.position.addScaledVector(ai.velocity, dt);

      // Keep inside netted court bounds
      ai.position.x = THREE.MathUtils.clamp(ai.position.x, -this.courtHalfW + 0.5, this.courtHalfW - 0.5);
      ai.position.y = THREE.MathUtils.clamp(ai.position.y, 0.5, this.courtH - 0.5);
      ai.position.z = THREE.MathUtils.clamp(ai.position.z, -this.courtHalfL + 0.5, this.courtHalfL - 0.5);

      ai.mesh.position.copy(ai.position);
      const bankPitch = THREE.MathUtils.clamp(ai.velocity.z * 0.09, -0.5, 0.5);
      const bankRoll  = THREE.MathUtils.clamp(-ai.velocity.x * 0.09, -0.5, 0.5);
      ai.mesh.rotation.set(bankPitch, Math.sin(t * 0.6) * 0.2, bankRoll);
    }

    // 3. AI-to-AI Spherical Cage Collisions
    for (let i = 0; i < this.aiPool.length; i++) {
      const a = this.aiPool[i];
      if (!a.active) continue;
      for (let j = i + 1; j < this.aiPool.length; j++) {
        const b = this.aiPool[j];
        if (!b.active) continue;
        const diff = a.position.clone().sub(b.position);
        const dist = diff.length();
        const minDist = a.radius + b.radius;
        if (dist > 0.001 && dist < minDist) {
          const n = diff.divideScalar(dist);
          const overlap = (minDist - dist) * 0.5;
          a.position.addScaledVector(n, overlap);
          b.position.addScaledVector(n, -overlap);
          a.velocity.addScaledVector(n, 2.2);
          b.velocity.addScaledVector(n, -2.2);
          if (Math.random() < 0.35) {
            const mid = a.position.clone().add(b.position).multiplyScalar(0.5);
            this.spawnCollisionSparks(mid, 10, 0x38bdf8);
          }
        }
      }
    }

    // 4. Player-to-AI Spherical Cage Collisions + Spark Particles + Interception Tracking
    let playerHitEnemy = false;
    const playerRadius = 0.36;
    for (let i = 0; i < this.aiPool.length; i++) {
      const ai = this.aiPool[i];
      if (!ai.active) continue;

      const diff = playerPos.clone().sub(ai.position);
      const dist = diff.length();
      const minDist = playerRadius + ai.radius;
      if (dist > 0.001 && dist < minDist) {
        const n = diff.divideScalar(dist);
        const penetration = minDist - dist;
        playerPos.addScaledVector(n, penetration * 0.55);
        ai.position.addScaledVector(n, -penetration * 0.45);

        const relVel = playerVel.clone().sub(ai.velocity);
        const sepSpeed = relVel.dot(n);
        if (sepSpeed < 0) {
          const restitution = 0.68;
          const impulse = -(1.0 + restitution) * sepSpeed * 0.55;
          playerVel.addScaledVector(n, impulse);
          ai.velocity.addScaledVector(n, -impulse * 1.45);

          playerPhysics.telemetry.collisionIntensity = Math.max(
            playerPhysics.telemetry.collisionIntensity,
            Math.abs(sepSpeed) * 0.85
          );

          const contactPt = playerPos.clone().addScaledVector(n, -playerRadius);
          this.spawnCollisionSparks(contactPt, 24, ai.team === 'blue' ? 0xfbbf24 : 0xff4d6d);

          if (ai.team === 'blue' && this.blockCooldown <= 0 && Math.abs(sepSpeed) > 1.4) {
            this.playerBlocks += 1;
            this.blockCooldown = 1.0;
            playerHitEnemy = true;
          }
        }
      }
    }

    // 5. FIDA Striker Goal Ring Scoring Detection
    // Check if Red Striker scored on Blue Goal (Z = -11.2, Y = 3.2)
    const blueGoal = this.goals.blue;
    if (this.playerRole === 'striker') {
      const dz = Math.abs(playerPos.z - blueGoal.z);
      const radial = Math.hypot(playerPos.x, playerPos.y - blueGoal.y);
      if (dz < 0.48 && radial < blueGoal.radius - 0.15 && playerVel.z < -0.5) {
        this.scoreRed += 1;
        this.playerGoals += 1;
        this.lastScorerText = `GOAL! 玩家攻擊手得分！ RED ${this.scoreRed} - ${this.scoreBlue} BLUE`;
        this.renderJumbotronTexture();
        this.spawnCollisionSparks(new THREE.Vector3(0, blueGoal.y, blueGoal.z), 48, 0xfbbf24);
        return { scoredTeam: 'RED', scorerName: 'PLAYER (RED STRIKER)', playerHitEnemy };
      }
    } else if (this.aiPool[0].active && this.aiPool[0].isStriker) {
      const redAiStriker = this.aiPool[0];
      const dz = Math.abs(redAiStriker.position.z - blueGoal.z);
      const radial = Math.hypot(redAiStriker.position.x, redAiStriker.position.y - blueGoal.y);
      if (dz < 0.48 && radial < blueGoal.radius - 0.15 && redAiStriker.velocity.z < -0.5) {
        this.scoreRed += 1;
        this.lastScorerText = `GOAL! 紅隊 AI 攻擊手得分！ RED ${this.scoreRed} - ${this.scoreBlue} BLUE`;
        this.renderJumbotronTexture();
        this.spawnCollisionSparks(new THREE.Vector3(0, blueGoal.y, blueGoal.z), 48, 0xfbbf24);
        return { scoredTeam: 'RED', scorerName: 'RED AI STRIKER', playerHitEnemy };
      }
    }

    // Check if Blue AI Striker scored on Red Goal (Z = +11.2, Y = 3.2)
    if (blueStriker && blueStriker.active) {
      const redGoal = this.goals.red;
      const dz = Math.abs(blueStriker.position.z - redGoal.z);
      const radial = Math.hypot(blueStriker.position.x, blueStriker.position.y - redGoal.y);
      if (dz < 0.48 && radial < redGoal.radius - 0.15 && blueStriker.velocity.z > 0.5) {
        this.scoreBlue += 1;
        this.lastScorerText = `GOAL! 藍隊攻擊手得分！ RED ${this.scoreRed} - ${this.scoreBlue} BLUE`;
        this.renderJumbotronTexture();
        this.spawnCollisionSparks(new THREE.Vector3(0, redGoal.y, redGoal.z), 48, 0x00b4ff);
        return { scoredTeam: 'BLUE', scorerName: 'BLUE AI STRIKER', playerHitEnemy };
      }
    }

    return { scoredTeam: null, playerHitEnemy };
  }
}
