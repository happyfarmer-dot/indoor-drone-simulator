/**
 * Procedural 3D Indoor Warehouse Environment & PBR Texture Generator (warehouse.js)
 *
 * Features:
 * - Procedural high-resolution HTML5 Canvas Normal Maps, Roughness Maps & Albedo Maps
 * - Polished Epoxy Concrete Floor with subtle environmental reflections & yellow/black hazard lines
 * - Multi-row heavy-duty storage racks, wooden pallets, multi-sized cardboard boxes
 * - Structural steel I-beam columns, roof trusses, high-bay industrial lights & skylight volumetric shafts
 * - Illuminated LED FPV Racing Gates with checkpoint pass-through detection & AABB colliders
 */

import * as THREE from 'three';

export class WarehouseScene {
  constructor(scene, renderer) {
    this.parentScene = scene;
    this.rootGroup = new THREE.Group();
    this.parentScene.add(this.rootGroup);
    this.scene = scene;
    this.renderer = renderer;
    this.colliders = []; // Array of { box: THREE.Box3, tag: string, restitution?: number }
    this.gates = [];     // Array of LED racing gate objects for checkpoint tracking
    this.activeGateIndex = 0;
    this.lapCount = 0;
    this.lapStartTime = performance.now();
    this.lastLapTime = null;
    this.bestLapTime = null;

    this.configureAtmosphereAndEnvMap();
    this.generatePBRTextures();
    this.scene = this.rootGroup; // Attach all warehouse meshes and lights into rootGroup
    this.buildLighting();
    this.buildArchitecture();
    this.buildFloorMarkingsAndHelipad();
    this.buildStorageRacksAndCargo();
    this.buildIBeamColumnsAndTrusses();
    this.buildLedRacingGates();
    this.buildFloatingDustParticles();
  }

  setVisible(visible) {
    this.rootGroup.visible = visible;
  }

  addBoxCollider(minX, minY, minZ, maxX, maxY, maxZ, tag = 'obstacle', restitution = 0.4) {
    const box = new THREE.Box3(
      new THREE.Vector3(minX, minY, minZ),
      new THREE.Vector3(maxX, maxY, maxZ)
    );
    this.colliders.push({ box, tag, restitution });
  }

  /**
   * Configure exponential indoor fog and a procedural PMREM environment map
   * so the epoxy floor and metallic steel columns exhibit realistic subtle reflections.
   */
  configureAtmosphereAndEnvMap() {
    this.scene.background = new THREE.Color(0x0c111a);
    this.scene.fog = new THREE.FogExp2(0x0e1420, 0.0135);

    // Generate equirectangular indoor warehouse reflection environment on canvas
    const envCanvas = document.createElement('canvas');
    envCanvas.width = 512;
    envCanvas.height = 256;
    const ctx = envCanvas.getContext('2d');

    // Ceiling -> Walls -> Epoxy Floor gradient
    const grad = ctx.createLinearGradient(0, 0, 0, 256);
    grad.addColorStop(0.0, '#1e293b');
    grad.addColorStop(0.25, '#334155');
    grad.addColorStop(0.48, '#1e2633');
    grad.addColorStop(0.52, '#0f141c');
    grad.addColorStop(1.0, '#090d14');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 512, 256);

    // Bright skylight & high-bay reflection strips in upper hemisphere
    for (let x = 32; x < 512; x += 64) {
      ctx.fillStyle = 'rgba(224, 242, 254, 0.85)';
      ctx.fillRect(x, 18, 22, 10);
      ctx.fillStyle = 'rgba(254, 243, 199, 0.65)';
      ctx.fillRect(x + 28, 36, 18, 14);
    }
    // Subtle cyan/orange industrial accents on horizon for rich floor speculars
    ctx.fillStyle = 'rgba(234, 88, 12, 0.28)';
    ctx.fillRect(0, 112, 512, 12);
    ctx.fillStyle = 'rgba(56, 189, 248, 0.22)';
    ctx.fillRect(0, 126, 512, 8);

    const envTex = new THREE.CanvasTexture(envCanvas);
    envTex.mapping = THREE.EquirectangularReflectionMapping;
    envTex.colorSpace = THREE.SRGBColorSpace;
    this.scene.environment = envTex;
    this.scene.environmentIntensity = 0.85;
  }

  /**
   * Procedurally draw high-resolution Albedo, Normal & Roughness maps using HTML5 Canvas
   */
  generatePBRTextures() {
    const maxAniso = this.renderer ? this.renderer.capabilities.getMaxAnisotropy() : 4;

    // 1. Polished Epoxy Concrete Floor (Albedo + Normal Map + Roughness Map)
    const size = 512;
    const alCanvas = document.createElement('canvas');
    const nmCanvas = document.createElement('canvas');
    const rmCanvas = document.createElement('canvas');
    alCanvas.width = nmCanvas.width = rmCanvas.width = size;
    alCanvas.height = nmCanvas.height = rmCanvas.height = size;

    const alCtx = alCanvas.getContext('2d');
    const nmCtx = nmCanvas.getContext('2d');
    const rmCtx = rmCanvas.getContext('2d');

    // Base epoxy concrete slate tone
    alCtx.fillStyle = '#2b333f';
    alCtx.fillRect(0, 0, size, size);

    // Base normal (flat = 128, 128, 255)
    nmCtx.fillStyle = 'rgb(128, 128, 255)';
    nmCtx.fillRect(0, 0, size, size);

    // Base low roughness for glossy polished epoxy coating (value ~45..85 / 255)
    rmCtx.fillStyle = 'rgb(52, 52, 52)';
    rmCtx.fillRect(0, 0, size, size);

    // Add organic concrete aggregate & polished epoxy sheen patches
    for (let i = 0; i < 2400; i++) {
      const x = Math.random() * size;
      const y = Math.random() * size;
      const r = 2 + Math.random() * 18;
      const shade = 36 + Math.floor(Math.random() * 24);
      alCtx.fillStyle = `rgba(${shade}, ${shade + 6}, ${shade + 14}, 0.14)`;
      alCtx.beginPath();
      alCtx.arc(x, y, r, 0, Math.PI * 2);
      alCtx.fill();

      // Roughness variation (glossy wet-look epoxy swirls vs slightly scuffed concrete)
      const roughVal = Math.random() > 0.45 ? 32 : 88;
      rmCtx.fillStyle = `rgba(${roughVal}, ${roughVal}, ${roughVal}, 0.18)`;
      rmCtx.beginPath();
      rmCtx.arc(x, y, r * 1.6, 0, Math.PI * 2);
      rmCtx.fill();

      // Micro-bump normal perturbation
      const nx = 122 + Math.floor(Math.random() * 13);
      const ny = 122 + Math.floor(Math.random() * 13);
      nmCtx.fillStyle = `rgba(${nx}, ${ny}, 255, 0.35)`;
      nmCtx.fillRect(x, y, 3, 3);
    }

    // Expansion joint tile grid lines (grooved normal + higher roughness in seams)
    const tileStep = 128;
    for (let p = 0; p < size; p += tileStep) {
      // Dark seam in albedo
      alCtx.fillStyle = '#181d24';
      alCtx.fillRect(p, 0, 3, size);
      alCtx.fillRect(0, p, size, 3);

      // Matte seam in roughness
      rmCtx.fillStyle = 'rgb(210, 210, 210)';
      rmCtx.fillRect(p, 0, 4, size);
      rmCtx.fillRect(0, p, size, 4);

      // Beveled normal groove
      nmCtx.fillStyle = 'rgb(90, 128, 255)';
      nmCtx.fillRect(p, 0, 2, size);
      nmCtx.fillStyle = 'rgb(166, 128, 255)';
      nmCtx.fillRect(p + 2, 0, 2, size);

      nmCtx.fillStyle = 'rgb(128, 90, 255)';
      nmCtx.fillRect(0, p, size, 2);
      nmCtx.fillStyle = 'rgb(128, 166, 255)';
      nmCtx.fillRect(0, p + 2, size, 2);
    }

    this.floorAlbedo = new THREE.CanvasTexture(alCanvas);
    this.floorNormal = new THREE.CanvasTexture(nmCanvas);
    this.floorRoughness = new THREE.CanvasTexture(rmCanvas);

    for (const tex of [this.floorAlbedo, this.floorNormal, this.floorRoughness]) {
      tex.wrapS = THREE.RepeatWrapping;
      tex.wrapT = THREE.RepeatWrapping;
      tex.repeat.set(14, 18);
      tex.anisotropy = maxAniso;
    }
    this.floorAlbedo.colorSpace = THREE.SRGBColorSpace;

    // 2. Corrugated Industrial Wall Normal & Albedo Texture
    const wallCanvas = document.createElement('canvas');
    const wallNormCanvas = document.createElement('canvas');
    wallCanvas.width = wallNormCanvas.width = 256;
    wallCanvas.height = wallNormCanvas.height = 256;
    const wCtx = wallCanvas.getContext('2d');
    const wnCtx = wallNormCanvas.getContext('2d');

    for (let x = 0; x < 256; x += 16) {
      wCtx.fillStyle = '#333d4b';
      wCtx.fillRect(x, 0, 8, 256);
      wCtx.fillStyle = '#252d38';
      wCtx.fillRect(x + 8, 0, 8, 256);

      wnCtx.fillStyle = 'rgb(165, 128, 255)';
      wnCtx.fillRect(x, 0, 8, 256);
      wnCtx.fillStyle = 'rgb(92, 128, 255)';
      wnCtx.fillRect(x + 8, 0, 8, 256);
    }

    this.wallAlbedo = new THREE.CanvasTexture(wallCanvas);
    this.wallNormal = new THREE.CanvasTexture(wallNormCanvas);
    for (const t of [this.wallAlbedo, this.wallNormal]) {
      t.wrapS = THREE.RepeatWrapping;
      t.wrapT = THREE.RepeatWrapping;
      t.repeat.set(24, 4);
      t.anisotropy = maxAniso;
    }

    // 3. Yellow & Black Hazard Warning Stripe Texture
    const hazCanvas = document.createElement('canvas');
    hazCanvas.width = 256;
    hazCanvas.height = 64;
    const hCtx = hazCanvas.getContext('2d');
    hCtx.fillStyle = '#eab308';
    hCtx.fillRect(0, 0, 256, 64);
    hCtx.fillStyle = '#111827';
    for (let x = -64; x < 320; x += 32) {
      hCtx.beginPath();
      hCtx.moveTo(x, 0);
      hCtx.lineTo(x + 16, 0);
      hCtx.lineTo(x + 48, 64);
      hCtx.lineTo(x + 32, 64);
      hCtx.closePath();
      hCtx.fill();
    }
    this.hazardTexture = new THREE.CanvasTexture(hazCanvas);
    this.hazardTexture.wrapS = THREE.RepeatWrapping;
    this.hazardTexture.wrapT = THREE.RepeatWrapping;
    this.hazardTexture.colorSpace = THREE.SRGBColorSpace;
    this.hazardTexture.anisotropy = maxAniso;

    // 4. Cardboard Box Texture (Kraft cardboard + packing tape + shipping label)
    const boxCanvas = document.createElement('canvas');
    const boxNormCanvas = document.createElement('canvas');
    boxCanvas.width = boxNormCanvas.width = 256;
    boxCanvas.height = boxNormCanvas.height = 256;
    const bCtx = boxCanvas.getContext('2d');
    const bnCtx = boxNormCanvas.getContext('2d');

    bCtx.fillStyle = '#b4834e';
    bCtx.fillRect(0, 0, 256, 256);
    bnCtx.fillStyle = 'rgb(128, 128, 255)';
    bnCtx.fillRect(0, 0, 256, 256);

    // Corrugated fiber grain
    for (let y = 0; y < 256; y += 4) {
      bCtx.fillStyle = y % 8 === 0 ? 'rgba(0,0,0,0.04)' : 'rgba(255,255,255,0.03)';
      bCtx.fillRect(0, y, 256, 2);
      bnCtx.fillStyle = y % 8 === 0 ? 'rgb(128, 118, 255)' : 'rgb(128, 138, 255)';
      bnCtx.fillRect(0, y, 256, 2);
    }
    // Packing tape strip down center
    bCtx.fillStyle = '#d6b37c';
    bCtx.fillRect(114, 0, 28, 256);
    // White barcode shipping label
    bCtx.fillStyle = '#f8fafc';
    bCtx.fillRect(28, 34, 66, 46);
    bCtx.fillStyle = '#0f172a';
    for (let lx = 34; lx < 88; lx += 5) {
      bCtx.fillRect(lx, 54, (lx % 3) + 1, 18);
    }
    // Fragile stencil icon
    bCtx.strokeStyle = '#78350f';
    bCtx.lineWidth = 2;
    bCtx.strokeRect(8, 8, 240, 240);

    this.cardboardAlbedo = new THREE.CanvasTexture(boxCanvas);
    this.cardboardAlbedo.colorSpace = THREE.SRGBColorSpace;
    this.cardboardNormal = new THREE.CanvasTexture(boxNormCanvas);
  }

  /**
   * Build High-Bay Industrial Fixtures, Natural Skylight Shadow Sun & Volumetric Beams
   */
  buildLighting() {
    // Ambient hemisphere light (cool skylight top, warm concrete bounce bottom)
    const hemiLight = new THREE.HemisphereLight(0xdbeafe, 0x1e293b, 0.85);
    hemiLight.position.set(0, 12, 0);
    this.scene.add(hemiLight);

    // Main angled skylight sun beam casting crisp PCFSoftShadowMap shadows across warehouse
    const sunLight = new THREE.DirectionalLight(0xfffbeb, 2.2);
    sunLight.position.set(14, 22, 12);
    sunLight.castShadow = true;
    sunLight.shadow.mapSize.width = 2048;
    sunLight.shadow.mapSize.height = 2048;
    sunLight.shadow.camera.near = 2;
    sunLight.shadow.camera.far = 65;
    const d = 28;
    sunLight.shadow.camera.left = -d;
    sunLight.shadow.camera.right = d;
    sunLight.shadow.camera.top = d;
    sunLight.shadow.camera.bottom = -d;
    sunLight.shadow.bias = -0.0005;
    this.scene.add(sunLight);

    // High-Bay Ceiling Industrial Lights + Skylight Volumetric Light Cones
    const fixtureHousingMat = new THREE.MeshStandardMaterial({
      color: 0x1e293b,
      roughness: 0.4,
      metalness: 0.8
    });
    const bulbEmissiveMat = new THREE.MeshBasicMaterial({ color: 0xfef9c3 });

    // Volumetric beam material (additive translucent cone)
    const beamGeo = new THREE.ConeGeometry(3.6, 11.6, 24, 1, true);
    beamGeo.translate(0, -5.8, 0);
    const beamMat = new THREE.MeshBasicMaterial({
      color: 0xe0f2fe,
      transparent: true,
      opacity: 0.045,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });

    const skylightPanelGeo = new THREE.PlaneGeometry(3.4, 5.2);
    const skylightPanelMat = new THREE.MeshBasicMaterial({ color: 0xe0f2fe, side: THREE.DoubleSide });

    const lightRowsX = [-11, 0, 11];
    const lightColsZ = [-18, -6, 6, 18];

    for (const lx of lightRowsX) {
      for (const lz of lightColsZ) {
        // High-bay industrial luminaire
        const group = new THREE.Group();
        group.position.set(lx, 11.55, lz);

        const housing = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.65, 0.35, 16), fixtureHousingMat);
        group.add(housing);

        const emitter = new THREE.Mesh(new THREE.CircleGeometry(0.58, 16), bulbEmissiveMat);
        emitter.rotation.x = Math.PI / 2;
        emitter.position.y = -0.18;
        group.add(emitter);

        this.scene.add(group);

        // Volumetric light shaft cone under center aisle & skylights
        if (lx === 0 || (Math.abs(lx) === 11 && Math.abs(lz) === 6)) {
          const pointLight = new THREE.PointLight(0xf8fafc, 22, 22, 1.5);
          pointLight.position.set(lx, 11.0, lz);
          this.scene.add(pointLight);

          // Overhead skylight panel & angled god-ray shaft
          const skylight = new THREE.Mesh(skylightPanelGeo, skylightPanelMat);
          skylight.rotation.x = Math.PI / 2;
          skylight.position.set(lx + 2.8, 11.92, lz);
          this.scene.add(skylight);

          const beam = new THREE.Mesh(beamGeo, beamMat);
          beam.position.set(lx + 2.8, 11.9, lz);
          beam.rotation.z = -0.18;
          beam.rotation.x = 0.08;
          this.scene.add(beam);
        }
      }
    }
  }

  /**
   * Build Polished Epoxy Concrete Floor, Corrugated Steel Walls & Ceiling Deck
   */
  buildArchitecture() {
    // 1. Epoxy Concrete Floor (44m x 56m)
    const floorMat = new THREE.MeshStandardMaterial({
      map: this.floorAlbedo,
      normalMap: this.floorNormal,
      normalScale: new THREE.Vector2(0.35, 0.35),
      roughnessMap: this.floorRoughness,
      roughness: 0.26,
      metalness: 0.15,
      envMapIntensity: 1.15
    });

    const floorMesh = new THREE.Mesh(new THREE.PlaneGeometry(44, 56), floorMat);
    floorMesh.rotation.x = -Math.PI / 2;
    floorMesh.receiveShadow = true;
    this.scene.add(floorMesh);

    // 2. Corrugated Industrial Walls
    const wallMat = new THREE.MeshStandardMaterial({
      map: this.wallAlbedo,
      normalMap: this.wallNormal,
      normalScale: new THREE.Vector2(0.5, 0.5),
      roughness: 0.55,
      metalness: 0.65
    });

    // North & South Walls
    const nsWallGeo = new THREE.PlaneGeometry(44, 12);
    const northWall = new THREE.Mesh(nsWallGeo, wallMat);
    northWall.position.set(0, 6, -28);
    northWall.receiveShadow = true;
    this.scene.add(northWall);

    const southWall = new THREE.Mesh(nsWallGeo, wallMat);
    southWall.position.set(0, 6, 28);
    southWall.rotation.y = Math.PI;
    southWall.receiveShadow = true;
    this.scene.add(southWall);

    // East & West Walls
    const ewWallGeo = new THREE.PlaneGeometry(56, 12);
    const westWall = new THREE.Mesh(ewWallGeo, wallMat);
    westWall.position.set(-22, 6, 0);
    westWall.rotation.y = Math.PI / 2;
    westWall.receiveShadow = true;
    this.scene.add(westWall);

    const eastWall = new THREE.Mesh(ewWallGeo, wallMat);
    eastWall.position.set(22, 6, 0);
    eastWall.rotation.y = -Math.PI / 2;
    eastWall.receiveShadow = true;
    this.scene.add(eastWall);

    // Ceiling Deck
    const ceilingMat = new THREE.MeshStandardMaterial({
      color: 0x161d29,
      roughness: 0.7,
      metalness: 0.5
    });
    const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(44, 56), ceilingMat);
    ceiling.rotation.x = Math.PI / 2;
    ceiling.position.y = 12;
    this.scene.add(ceiling);

    // Industrial Roll-Up Loading Bay Doors on North Wall
    const doorMat = new THREE.MeshStandardMaterial({
      color: 0x3b82f6,
      roughness: 0.45,
      metalness: 0.7
    });
    for (const dx of [-8, 8]) {
      const door = new THREE.Mesh(new THREE.BoxGeometry(4.4, 4.8, 0.25), doorMat);
      door.position.set(dx, 2.4, -27.85);
      this.scene.add(door);
    }
  }

  /**
   * Build Floor Yellow/Black Hazard Warning Stripes & Glowing Helipad Spawn Pad
   */
  buildFloorMarkingsAndHelipad() {
    // Yellow-black hazard lines flanking the central flight corridor
    const stripeMat = new THREE.MeshStandardMaterial({
      map: this.hazardTexture,
      roughness: 0.35,
      metalness: 0.1
    });

    const leftHazardTex = this.hazardTexture.clone();
    leftHazardTex.needsUpdate = true;
    leftHazardTex.repeat.set(28, 1);
    stripeMat.map = leftHazardTex;

    const stripeGeo = new THREE.PlaneGeometry(0.32, 48);
    for (const sx of [-4.2, 4.2, -13.5, 13.5]) {
      const stripe = new THREE.Mesh(stripeGeo, stripeMat);
      stripe.rotation.x = -Math.PI / 2;
      stripe.position.set(sx, 0.006, -1);
      stripe.receiveShadow = true;
      this.scene.add(stripe);
    }

    // Illuminated Helipad Takeoff / Landing Pad at (0, 0, 18)
    const padCanvas = document.createElement('canvas');
    padCanvas.width = 256;
    padCanvas.height = 256;
    const pCtx = padCanvas.getContext('2d');
    pCtx.fillStyle = '#1e293b';
    pCtx.fillRect(0, 0, 256, 256);

    pCtx.strokeStyle = '#eab308';
    pCtx.lineWidth = 10;
    pCtx.strokeRect(12, 12, 232, 232);

    pCtx.strokeStyle = '#38bdf8';
    pCtx.lineWidth = 6;
    pCtx.beginPath();
    pCtx.arc(128, 128, 84, 0, Math.PI * 2);
    pCtx.stroke();

    pCtx.fillStyle = '#f8fafc';
    pCtx.font = 'bold 110px sans-serif';
    pCtx.textAlign = 'center';
    pCtx.textBaseline = 'middle';
    pCtx.fillText('H', 128, 132);

    const padTex = new THREE.CanvasTexture(padCanvas);
    padTex.colorSpace = THREE.SRGBColorSpace;
    const padMesh = new THREE.Mesh(
      new THREE.BoxGeometry(2.2, 0.04, 2.2),
      new THREE.MeshStandardMaterial({ map: padTex, roughness: 0.3, metalness: 0.2 })
    );
    padMesh.position.set(0, 0.02, 18);
    padMesh.receiveShadow = true;
    this.scene.add(padMesh);
  }

  /**
   * Build Multi-Row Heavy Storage Pallet Racks, Wooden Pallets & Stacked Cardboard Boxes
   */
  buildStorageRacksAndCargo() {
    this.rackBlueMat = new THREE.MeshStandardMaterial({
      color: 0x1d4ed8,
      roughness: 0.38,
      metalness: 0.72
    });
    this.beamOrangeMat = new THREE.MeshStandardMaterial({
      color: 0xea580c,
      roughness: 0.35,
      metalness: 0.65
    });
    this.woodPalletMat = new THREE.MeshStandardMaterial({
      color: 0x92623a,
      roughness: 0.82,
      metalness: 0.05
    });
    this.boxMatA = new THREE.MeshStandardMaterial({
      map: this.cardboardAlbedo,
      normalMap: this.cardboardNormal,
      roughness: 0.75,
      metalness: 0.05
    });
    this.boxMatB = new THREE.MeshStandardMaterial({
      color: 0xca9a63,
      map: this.cardboardAlbedo,
      normalMap: this.cardboardNormal,
      roughness: 0.78,
      metalness: 0.05
    });

    // Place 4 long rows of multi-bay industrial pallet racks
    const rackRowsX = [-16.5, -7.8, 7.8, 16.5];
    const bayCentersZ = [-18, -9, 0, 9];

    for (const rx of rackRowsX) {
      for (const rz of bayCentersZ) {
        this.createPalletRackBay(rx, rz);
      }
    }

    // Floor Pallet Stacks (for low-altitude proximity flying & obstacle slalom)
    const floorStacks = [
      { x: -3.2, z: 11.0, count: 2 },
      { x:  3.2, z:  4.5, count: 3 },
      { x: -3.1, z: -4.5, count: 2 },
      { x:  3.3, z: -13.5, count: 3 }
    ];
    for (const fs of floorStacks) {
      this.createFloorPalletStack(fs.x, fs.z, fs.count);
    }
  }

  createPalletRackBay(centerX, centerZ) {
    const rackW = 2.2;  // X width
    const rackD = 6.2;  // Z length
    const rackH = 6.6;  // Y height
    const halfW = rackW / 2;
    const halfD = rackD / 2;

    const group = new THREE.Group();
    group.position.set(centerX, 0, centerZ);

    // 4 Upright Steel Posts
    const postGeo = new THREE.BoxGeometry(0.12, rackH, 0.12);
    const postOffsets = [
      [-halfW, -halfD], [halfW, -halfD],
      [-halfW,  halfD], [halfW,  halfD]
    ];
    for (const [px, pz] of postOffsets) {
      const post = new THREE.Mesh(postGeo, this.rackBlueMat);
      post.position.set(px, rackH / 2, pz);
      post.castShadow = true;
      post.receiveShadow = true;
      group.add(post);
    }

    // Shelf levels at Y = 1.8m, 3.8m, 5.8m
    const shelfLevels = [1.8, 3.8, 5.8];
    const beamGeoZ = new THREE.BoxGeometry(0.09, 0.16, rackD);
    const beamGeoX = new THREE.BoxGeometry(rackW, 0.12, 0.09);

    for (const sy of shelfLevels) {
      // Longitudinal orange load beams
      const beamL = new THREE.Mesh(beamGeoZ, this.beamOrangeMat);
      beamL.position.set(-halfW, sy, 0);
      beamL.castShadow = true;
      group.add(beamL);

      const beamR = new THREE.Mesh(beamGeoZ, this.beamOrangeMat);
      beamR.position.set(halfW, sy, 0);
      beamR.castShadow = true;
      group.add(beamR);

      // Cross support bars
      for (const sz of [-halfD + 0.1, 0, halfD - 0.1]) {
        const cross = new THREE.Mesh(beamGeoX, this.beamOrangeMat);
        cross.position.set(0, sy - 0.02, sz);
        group.add(cross);
      }

      // Populate shelf with wooden pallets & multi-sized cardboard boxes
      for (const slotZ of [-1.6, 1.6]) {
        this.addPalletWithBoxes(group, 0, sy + 0.08, slotZ);
      }
    }

    // Also place pallets on ground level under bottom shelf
    this.addPalletWithBoxes(group, 0, 0, -1.6);
    this.addPalletWithBoxes(group, 0, 0, 1.6);

    this.scene.add(group);

    // Register solid AABB collider for the rack bay
    this.addBoxCollider(
      centerX - halfW - 0.05, 0, centerZ - halfD - 0.05,
      centerX + halfW + 0.05, rackH, centerZ + halfD + 0.05,
      'rack',
      0.38
    );
  }

  addPalletWithBoxes(parentGroup, localX, localY, localZ) {
    // Wooden Pallet base
    const pallet = new THREE.Mesh(new THREE.BoxGeometry(1.75, 0.14, 2.2), this.woodPalletMat);
    pallet.position.set(localX, localY + 0.07, localZ);
    pallet.castShadow = true;
    pallet.receiveShadow = true;
    parentGroup.add(pallet);

    // Deterministic pseudo-random box sizes based on coordinates
    const seed = Math.abs(Math.sin(localX * 12.9898 + localY * 78.233 + localZ * 37.719));
    const boxH1 = 0.65 + (seed * 0.55);
    const boxW1 = 0.78 + ((seed * 10) % 1) * 0.4;
    const boxD1 = 0.85 + ((seed * 100) % 1) * 0.35;

    const box1 = new THREE.Mesh(
      new THREE.BoxGeometry(boxW1, boxH1, boxD1),
      seed > 0.5 ? this.boxMatA : this.boxMatB
    );
    box1.position.set(localX - 0.25, localY + 0.14 + boxH1 / 2, localZ - 0.42);
    box1.castShadow = true;
    box1.receiveShadow = true;
    parentGroup.add(box1);

    const boxH2 = 0.55 + ((seed * 7) % 1) * 0.6;
    const box2 = new THREE.Mesh(
      new THREE.BoxGeometry(0.82, boxH2, 0.88),
      seed > 0.5 ? this.boxMatB : this.boxMatA
    );
    box2.position.set(localX + 0.28, localY + 0.14 + boxH2 / 2, localZ + 0.42);
    box2.castShadow = true;
    box2.receiveShadow = true;
    parentGroup.add(box2);
  }

  createFloorPalletStack(x, z, numBoxes = 2) {
    const group = new THREE.Group();
    group.position.set(x, 0, z);

    const pallet = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.14, 1.5), this.woodPalletMat);
    pallet.position.y = 0.07;
    pallet.castShadow = true;
    pallet.receiveShadow = true;
    group.add(pallet);

    let currY = 0.14;
    for (let i = 0; i < numBoxes; i++) {
      const s = 1.25 - i * 0.22;
      const h = 0.72;
      const box = new THREE.Mesh(
        new THREE.BoxGeometry(s, h, s),
        i % 2 === 0 ? this.boxMatA : this.boxMatB
      );
      box.position.y = currY + h / 2;
      box.rotation.y = (i * 0.18) - 0.08;
      box.castShadow = true;
      box.receiveShadow = true;
      group.add(box);
      currY += h;
    }

    this.scene.add(group);
    this.addBoxCollider(x - 0.75, 0, z - 0.75, x + 0.75, currY, z + 0.75, 'cargo', 0.35);
  }

  /**
   * Build Structural Steel I-Beam Columns & Overhead Roof Trusses
   */
  buildIBeamColumnsAndTrusses() {
    const steelMat = new THREE.MeshStandardMaterial({
      color: 0x334155,
      roughness: 0.32,
      metalness: 0.85
    });

    const guardMat = new THREE.MeshStandardMaterial({
      map: this.hazardTexture,
      roughness: 0.4,
      metalness: 0.3
    });

    // I-Beam Columns along the warehouse structure
    const colX = [-12.2, 12.2];
    const colZ = [-22, -12, -2, 8, 18];

    for (const cx of colX) {
      for (const cz of colZ) {
        const colGroup = new THREE.Group();
        colGroup.position.set(cx, 0, cz);

        // I-Beam web + 2 flanges
        const web = new THREE.Mesh(new THREE.BoxGeometry(0.08, 12, 0.36), steelMat);
        web.position.y = 6;
        web.castShadow = true;
        colGroup.add(web);

        const flange1 = new THREE.Mesh(new THREE.BoxGeometry(0.36, 12, 0.06), steelMat);
        flange1.position.set(0, 6, -0.18);
        flange1.castShadow = true;
        colGroup.add(flange1);

        const flange2 = new THREE.Mesh(new THREE.BoxGeometry(0.36, 12, 0.06), steelMat);
        flange2.position.set(0, 6, 0.18);
        flange2.castShadow = true;
        colGroup.add(flange2);

        // Yellow-Black Hazard Impact Guard at base
        const guard = new THREE.Mesh(new THREE.BoxGeometry(0.56, 1.2, 0.56), guardMat);
        guard.position.y = 0.6;
        guard.castShadow = true;
        colGroup.add(guard);

        this.scene.add(colGroup);
        this.addBoxCollider(cx - 0.28, 0, cz - 0.28, cx + 0.28, 12, cz + 0.28, 'column', 0.45);
      }
    }

    // Overhead Roof Trusses spanning across X at each Z column row
    const trussGeo = new THREE.BoxGeometry(44, 0.45, 0.28);
    for (const cz of colZ) {
      const truss = new THREE.Mesh(trussGeo, steelMat);
      truss.position.set(0, 11.65, cz);
      truss.castShadow = true;
      this.scene.add(truss);
      this.addBoxCollider(-22, 11.4, cz - 0.18, 22, 12.0, cz + 0.18, 'truss', 0.4);
    }
  }

  /**
   * Build Illuminated LED FPV Racing Gates (發光穿越門) for Practice & Spatial Reference
   */
  buildLedRacingGates() {
    const gateSpecs = [
      { x: 0.0,   y: 1.8, z:  10.0, rotY: 0,            color: 0x00f5d4 }, // Gate 1: Main aisle entry
      { x: 0.0,   y: 2.8, z:  -1.0, rotY: 0,            color: 0x00bbf9 }, // Gate 2: Elevated center
      { x: 0.0,   y: 1.8, z: -13.0, rotY: 0,            color: 0x00f5d4 }, // Gate 3: North approach
      { x: 6.0,   y: 2.4, z: -22.5, rotY: -Math.PI / 2, color: 0xf15bb5 }, // Gate 4: North turn
      { x: 12.2,  y: 2.2, z:  -4.5, rotY: Math.PI,      color: 0xfee440 }, // Gate 5: East alley return
      { x: 5.5,   y: 1.9, z:  14.5, rotY: Math.PI / 4,  color: 0x00f5d4 }  // Gate 6: Finish chicane
    ];

    const gateWidth = 3.2;
    const gateHeight = 2.6;
    const postRadius = 0.09;

    const frameMat = new THREE.MeshStandardMaterial({
      color: 0x0f172a,
      roughness: 0.3,
      metalness: 0.8
    });

    gateSpecs.forEach((spec, idx) => {
      const group = new THREE.Group();
      group.position.set(spec.x, 0, spec.z);
      group.rotation.y = spec.rotY;

      const ledMat = new THREE.MeshBasicMaterial({
        color: idx === 0 ? 0x10b981 : spec.color
      });

      const halfW = gateWidth / 2;
      const topY = spec.y + gateHeight / 2;
      const botY = Math.max(0.1, spec.y - gateHeight / 2);
      const pillarH = topY;

      // Left & Right structural posts
      const leftPost = new THREE.Mesh(new THREE.CylinderGeometry(postRadius, postRadius, pillarH, 16), frameMat);
      leftPost.position.set(-halfW, pillarH / 2, 0);
      leftPost.castShadow = true;
      group.add(leftPost);

      const rightPost = new THREE.Mesh(new THREE.CylinderGeometry(postRadius, postRadius, pillarH, 16), frameMat);
      rightPost.position.set(halfW, pillarH / 2, 0);
      rightPost.castShadow = true;
      group.add(rightPost);

      // Top & Bottom crossbar
      const topBar = new THREE.Mesh(new THREE.CylinderGeometry(postRadius, postRadius, gateWidth + 0.18, 16), frameMat);
      topBar.rotation.z = Math.PI / 2;
      topBar.position.set(0, topY, 0);
      topBar.castShadow = true;
      group.add(topBar);

      // Glowing Neon LED Inner Strips
      const ledLeft = new THREE.Mesh(new THREE.BoxGeometry(0.06, gateHeight, 0.08), ledMat);
      ledLeft.position.set(-halfW + 0.09, spec.y, 0);
      group.add(ledLeft);

      const ledRight = new THREE.Mesh(new THREE.BoxGeometry(0.06, gateHeight, 0.08), ledMat);
      ledRight.position.set(halfW - 0.09, spec.y, 0);
      group.add(ledRight);

      const ledTop = new THREE.Mesh(new THREE.BoxGeometry(gateWidth - 0.12, 0.06, 0.08), ledMat);
      ledTop.position.set(0, topY - 0.09, 0);
      group.add(ledTop);

      const ledBot = new THREE.Mesh(new THREE.BoxGeometry(gateWidth - 0.12, 0.05, 0.08), ledMat);
      ledBot.position.set(0, botY, 0);
      group.add(ledBot);

      // Subtle PointLight for floor neon reflection
      const gateLight = new THREE.PointLight(spec.color, 6.0, 7.5, 2.0);
      gateLight.position.set(0, spec.y, 0);
      group.add(gateLight);

      this.scene.add(group);

      // Compute world positions of the left & right posts for AABB collision
      const cosR = Math.cos(spec.rotY);
      const sinR = Math.sin(spec.rotY);
      for (const side of [-halfW, halfW]) {
        const wx = spec.x + side * cosR;
        const wz = spec.z - side * sinR;
        this.addBoxCollider(wx - 0.15, 0, wz - 0.15, wx + 0.15, topY, wz + 0.15, 'gate_post', 0.5);
      }

      this.gates.push({
        index: idx,
        center: new THREE.Vector3(spec.x, spec.y, spec.z),
        ledMat,
        light: gateLight,
        baseColor: spec.color,
        radius: 1.75
      });
    });

    this.highlightActiveGate();
  }

  highlightActiveGate() {
    for (let i = 0; i < this.gates.length; i++) {
      const g = this.gates[i];
      if (i === this.activeGateIndex) {
        g.ledMat.color.setHex(0x22c55e); // Bright Emerald Target Gate
        g.light.color.setHex(0x22c55e);
        g.light.intensity = 10.0;
      } else {
        g.ledMat.color.setHex(0x0284c7);
        g.light.color.setHex(0x0284c7);
        g.light.intensity = 4.0;
      }
    }
  }

  /**
   * Build floating dust motes illuminated by the warehouse skylights
   */
  buildFloatingDustParticles() {
    const count = 450;
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      positions[i * 3 + 0] = (Math.random() - 0.5) * 40;
      positions[i * 3 + 1] = 0.4 + Math.random() * 10.5;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 52;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({
      color: 0xe2e8f0,
      size: 0.055,
      transparent: true,
      opacity: 0.45,
      depthWrite: false
    });
    this.dustPoints = new THREE.Points(geo, mat);
    this.scene.add(this.dustPoints);
  }

  /**
   * Check if drone flew through the active LED Racing Gate
   * @returns {boolean} True if checkpoint gate was just cleared
   */
  checkGatePass(dronePos) {
    const activeGate = this.gates[this.activeGateIndex];
    if (!activeGate) return false;

    const dist = dronePos.distanceTo(activeGate.center);
    if (dist < activeGate.radius) {
      this.activeGateIndex++;
      if (this.activeGateIndex >= this.gates.length) {
        this.activeGateIndex = 0;
        this.lapCount++;
        const now = performance.now();
        this.lastLapTime = (now - this.lapStartTime) / 1000;
        if (this.bestLapTime === null || this.lastLapTime < this.bestLapTime) {
          this.bestLapTime = this.lastLapTime;
        }
        this.lapStartTime = now;
      }
      this.highlightActiveGate();
      return true;
    }
    return false;
  }
}
