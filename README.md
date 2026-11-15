# 3D Indoor FPV Drone Simulator (Betaflight Rates Edition)

基於 **Three.js (ES Modules)**、**6-DoF 剛體物理引擎**與 **Web Audio API** 打造的 3D 室內倉庫無人機穿越模擬器，內建真實 **Betaflight Classic Rates** 搖桿曲線調校面板與即時 2D 反應曲線圖。

## 線上遊玩網址 (GitHub Pages)
- **Live Demo**: [https://happyfarmer-dot.github.io/indoor-drone-simulator/](https://happyfarmer-dot.github.io/indoor-drone-simulator/)

## 核心特色
1. **擬真 6-DoF 剛體物理與雙飛控系統 (`physics.js`)**
   - 480Hz 高頻子步進物理積分、真實重力 ($9.81\text{ m/s}^2$)、四軸推力向量四元數空間轉換、空氣阻力、角速度阻尼、轉動慣量張量與地面效應（Ground Effect）。
   - **Angle Mode（自穩模式）**：搖桿回中自動修正 Pitch/Roll 回平（最大傾角限制 $45^\circ$）。
   - **Acro Mode（手動特技模式）**：搖桿直接控制三軸目標角速度（$\text{rad/s}$），支援 360° 翻滾。
   - **3D AABB 碰撞偵測**：針對貨架、棧板、紙箱、工字鋼立柱與穿越門柱子具備真實碰撞反彈與姿態擾動。

2. **Betaflight 經典速率數學模型與即時曲線圖 (`rates.js`)**
   - 支援 Roll、Pitch、Yaw 三軸獨立設定 `RC Rate`、`Super Rate`、`Expo`。
   - 內建 **Cinematic（電影平滑）**、**Freestyle（花式穿越）**、**Racing（競速高反應）** 三組一鍵預設檔，並自動儲存至 `localStorage`。
   - 高解析度 HTML5 Canvas 即時繪製三軸速率曲線、搖桿動態追蹤發光圓點與 `Max Vel` / `Center Sensitivity` 指標。

3. **程序化 PBR 室內倉庫場景與無刷馬達合成音效 (`warehouse.js`, `drone.js`, `audio.js`)**
   - 動態生成環氧樹脂混凝土地板法線貼圖（Normal Map）與粗糙度貼圖（Roughness Map）、高棚工業燈、天窗體積光束、重型貨架與 6 座發光穿越門（LED Racing Gates）。
   - Web Audio API 根據四顆馬達即時轉速合成高頻無刷馬達嗡鳴聲與碰撞音效。

## 操控說明（美國手 Mode 2）
- `W` / `S`：油門升降（Throttle）
- `A` / `D`：左右偏航（Yaw）
- `↑` / `↓`：前後俯仰（Pitch）
- `←` / `→`：左右橫滾（Roll）
- `M`：切換 **Angle（自穩）** / **Acro（特技）** 模式
- `C`：切換 **FPV 第一人稱廣角（100°）** / **第三人稱追尾視角**
- `R`：立即重置回起飛停機坪
- `Tab` / `P`：展開或收合 **Betaflight Rates 調校面板**
