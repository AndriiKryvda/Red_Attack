# RED ATTACK — Requirements & Technical Design Document

> **Версія:** 1.0  
> **Дата:** 2026-10-11  
> **Жанр:** Browser 3D Co-op Wave Defense / FPV Drone Simulator  
> **Платформа:** Web Browser (Desktop)  
> **Гравці:** 1–10 (co-op)

---

## 1. GAME OVERVIEW

### 1.1 Концепція
Гравці захищають невеликий форпост на пагорбі від хвиль ворогів, керуючи FPV-дронами з вибухівкою. Грає роль "сучасного tower defense навпаки" — гравці є зброєю форпосту.

### 1.2 Core Loop
1. Гравці з'єднуються у лоббі
2. Хвиля ворогів спавниться на підніжжі пагорба
3. Гравці запускають FPV-дрони та керують ними в режимі реального часу
4. Дрон влучає у ворога → вибух → ворог знищено
5. Проміжне влучення → сповільнення/нерухомість ворога
6. Після знищення всіх ворогів хвилі → пауза 30 сек → наступна хвиля
7. Після 12 хвиль → перемога. Якщо форпост зруйновано → поразка.

### 1.3 Тон та стиль
- **Візуальний стиль:** Low-poly (як Poly Bridge, Townscaper)
- **Настрій:** Гумористичний сарказм (чебурашки та ведмеді з прапорами — абсурдний антиворог)
- **Тривалість сесії:** ~20-30 хвилин (залежно від кількості гравців)

---

## 2. GAME MECHANICS

### 2.1 Гравець (FPV-пілот)

| Параметр | Значення |
|----------|----------|
| Кількість гравців | 1–10 |
| Дронів одночасно | **Необмежена** (кожен гравець може запускати дрони без ліміту) |
| Керованих дронів | **1 на гравця** (після запуску гравець керує цим дроном до вибуху/таймауту) |
| Перезарядка після вибуху | 5 секунд (потім можна запускати наступний) |
| Швидкість дрона | 15 м/с (базова) |
| Макс. дистанція польоту | 150 м від форпосту |
| Час польоту | 20 секунд (потім автоповернення + self-destruct) |
| Радіус вибуху (kill) | 3 м |
| Радіус сповільнення | 6 м |
| Тривалість сповільнення | 4 сек (50% швидкості) |
| Тривалість нерухомості | 2 сек |

**Механіка дрона:**
- Гравець натискає "Launch" → дрон з'являється біля форпосту → гравець переходить у FPV-режим
- Дрон летить, поки: влучить у ворога (вибух) / таймаут 20 сек / гравець натисне R (self-destruct)
- Після знищення дрона → 5 сек cooldown → можна запускати новий
- Дрони інших гравців **видимі** на полі бою, але не керовані

### 2.2 Вороги

| Тип | Швидкість | HP | Розмір | Поведінка |
|-----|-----------|-----|--------|-----------|
| 🟤 Чебурашка | **2.5 м/с** | 1 | 0.8 м | Біжить прямо, найшвидша, слабка |
| 🐻 Ведмідь (червоний прапор) | **1.0 м/с** | 5 | 2.0 м | Дуже повільний танк, ходить на двох лапах |
| 🪖 Солдат (білий унітаз) | **1.8 м/с** | 3 | 1.2 м | Середній темп, несе унітаз у руках |

**Примітка:** Червоний прапор ведмедя та білий унітаз солдата — це візуальні елементи, вони не несуть ігрової механіки.

**Розрахунок часу доходу до форпосту** (дистанція ~120 м від спавну):
- Чебурашка: ~48 сек
- Солдат: ~67 сек
- Ведмідь: ~120 сек

Це дає гравцям достатньо часу для наведення дрона (політ 15 м/с × 8 сек = 120 м).

### 2.3 Хвилі (Waves)

**Принцип:** Базова кількість ворогів розрахована для **1 гравця**. Реальна кількість = база × кількість гравців.

**Формула:** `actual_count = base_count × player_count`

| Хвиля | Чебурашки (база) | Ведмеді (база) | Солдати (база) | **Разом (база)** | **1P** | **2P** | **3P** | **4P** | Інтервал спавну |
|-------|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| 1 | 1 | 1 | 1 | **3** | 3 | 6 | 9 | 12 | 3.0 сек |
| 2 | 2 | 1 | 1 | **4** | 4 | 8 | 12 | 16 | 2.5 сек |
| 3 | 2 | 1 | 2 | **5** | 5 | 10 | 15 | 20 | 2.2 сек |
| 4 | 3 | 2 | 2 | **7** | 7 | 14 | 21 | 28 | 2.0 сек |
| 5 | 3 | 2 | 3 | **8** | 8 | 16 | 24 | 32 | 1.8 сек |
| 6 | 4 | 3 | 3 | **10** | 10 | 20 | 30 | 40 | 1.6 сек |
| 7 | 5 | 3 | 4 | **12** | 12 | 24 | 36 | 48 | 1.4 сек |
| 8 | 5 | 4 | 5 | **14** | 14 | 28 | 42 | 56 | 1.2 сек |
| 9 | 6 | 5 | 5 | **16** | 16 | 32 | 48 | 64 | 1.0 сек |
| 10 | 7 | 5 | 6 | **18** | 18 | 36 | 54 | 72 | 0.9 сек |
| 11 | 8 | 6 | 7 | **21** | 21 | 42 | 63 | 84 | 0.8 сек |
| 12 | 10 | 8 | 8 | **26** | 26 | 52 | 78 | 104 | 0.6 сек |

**Примітки:**
- При 4 гравцях на хвилі 12 буде 104 вороги — це "boss wave"
- Максимум активних ворогів одночасно: **80** (обмеження продуктивності; надлишок чекає в черзі)
- **Між хвилями: 30 секунд паузи** (зворотний відлік на екрані)

### 2.4 Форпост

| Параметр | Значення |
|----------|----------|
| HP форпосту | 100 × player_count |
| Кількість стін | 4 |
| HP кожної стіни | 25 × player_count |
| DMG від ворога при тарані | 10 |
| Умова поразки | HP форпосту = 0 |

**Логіка:** Більше гравців = більше ворогів = більше HP форпосту (баланс).

### 2.5 Мертві вороги
- Зникають через 30 секунд після смерті (з анімацією розпаду на частинки)
- Не блокують шлях інших ворогів

### 2.6 Система очок

| Дія | Очки |
|-----|------|
| Вбивство чебурашки | 10 |
| Вбивство ведмедя | 30 |
| Вбивство солдата | 20 |
| Headshot (влучення у верхню частину) | ×1.5 |
| Мультикіл (3+ за один вибух) | +50 бонус |
| Бонус за хвилю без пропущених | +100 |

### 2.7 Станції озброєння

Форпост тримає шість станцій; одну з них пілот обслуговує в будь-який момент:

| Станція | Клавіша | Роль | Боєзапас / перезарядка |
|---------|---------|------|------------------------|
| FPV-квадрокоптер | `1` | Точковий удар, далекий хід | 1 дрон, cooldown після прильоту |
| Міномет | `2` | Площинний удар по середині поля | 1 снаряд, 8 с |
| Кулеміт (північ / схід / південь / захід) | `3` `4` `5` `6` | Оборона власного муру, ближня зона | стрічка 120 набіїв, 10 с спокою → повна стрічка |

Кулеміти (HMG) — серверна зброя: сервер тримає лічильник набіїв, темп стрільби
(600 пострілів/хв), дальність (70 м), розкид, ураження й обмін стрічки. Клієнт
лише транслює наведення та стан гачка (`hmg_input`) так само, як транслює керування
дроном, і малює постріл за подією `hmg_shot`. Танки кулемітам не підлягають — вони
лишаються справою квадрокоптера.

---

## 3. CONTROLS

### 3.1 Клавіатура + Миша

| Клавіша | Дія |
|---------|-----|
| W/A/S/D | Рух дрона відносно напрямку камери |
| 1 / 2 | Станція: FPV-дрон / міномет |
| 3 / 4 / 5 / 6 | Станція: кулеміт північного / східного / південного / західного муру |
| Tab | Перейти до наступної станції (дрон → міномет → чотири кулеміти → дрон) |
| Миша | Поворот камери (yaw/pitch); на кулеміті — наведення ствола (підйом обмежений −35°…+8°) |
| Пробіл | Рух вгору (у FPV) / запуск дрона або постріл з міномета (у режимі очікування) / утримувати на кулеміті, поки йде стрічка |
| Shift (лівий) | Рух вниз |
| ЛКМ | Прискорення (boost, 2× швидкість, 3 сек cooldown) |
| R | Self-destruct дрона (миттєвий вибух на місці) |
| ESC | Пауза меню |

### 3.2 Стани гравця

1. **Очікування (at base):** Камера top-down огляд форпосту. Натискає Space → запуск дрона.
2. **Пілотування (FPV):** Камера від першої особи на дроні. WASD + миша.

### 3.3 Камера
- **Режим дрона:** FPV (камера на носі дрона) з легким shake при русі
- **Режим очікування:** Top-down огляд форпосту (між польотами)

---

## 4. MULTIPLAYER

### 4.1 Модель
- **Тип:** Server-authoritative (сервер — джерело істини)
- **Лобі:** Кожна гра = окремий "room" з унікальним ID
- **Приєднання:** За посиланням (URL з room ID)
- **Резолв:** 1 tick = 50ms (20 TPS) для фізики, рендер інтерполюється на клієнті

### 4.2 Синхронізація
- **Позиція дрона:** Клієнт відправляє input → сервер симулює → розсилає state
- **Вороги:** Повністю серверна симуляція
- **Вибухи:** Сервер валідує колізію → broadcast event
- **Інтерполяція:** Клієнт інтерполює позиції між тиками (100ms buffer)

### 4.3 Netcode
- **Протокол:** WebSocket (wss://)
- **Формат:** MessagePack (компактний бінарний)
- **Tick rate:** 20 TPS (фізика), 60 FPS (рендер на клієнті)
- **Rollback:** Не потрібен (PvE, latency-tolerant)
- **Макс. RTT:** 200ms (з компенсацією)

---

## 5. TECHNICAL ARCHITECTURE

### 5.1 Стек технологій

```
┌─────────────────────────────────────────────────────────┐
│                    CLIENT (Browser)                       │
├─────────────────────────────────────────────────────────┤
│  Three.js (WebGL rendering)                             │
│  + Custom ECS-lite for game entities                    │
│  + WebAudio API for sound                               │
│  + WebSocket client (MessagePack)                       │
│  + Vite (bundler, HMR)                                  │
│  + TypeScript                                           │
└─────────────────────────────────────────────────────────┘
                         │ WebSocket
                         ▼
┌─────────────────────────────────────────────────────────┐
│                    SERVER (Node.js)                       │
├─────────────────────────────────────────────────────────┤
│  Node.js 20+ (LTS)                                      │
│  + Colyseus (room management, state sync)               │
│  + Custom physics (AABB + sphere collision)             │
│  + WebSocket transport (built into Colyseus)            │
│  + TypeScript                                           │
└─────────────────────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────┐
│                    DEPLOYMENT                             │
├─────────────────────────────────────────────────────────┤
│  Linux VPS (own server)                                 │
│  + Nginx (reverse proxy, SSL termination)               │
│  + PM2 (process manager)                                │
│  + Let's Encrypt (SSL)                                  │
│  + Docker (optional, for easy deploy)                   │
└─────────────────────────────────────────────────────────┘
```

### 5.2 Чому такий стек?

| Рішення | Обґрунтування |
|---------|---------------|
| **Three.js** | Найпопулярніший 3D engine для браузера, велика спільнота, low-poly рендерить легко |
| **Colyseus** | Готовий room-based multiplayer framework для Node.js, вбудована state sync, TypeScript-native |
| **Vite** | Швидкий dev server, HMR, tree-shaking для продакшену |
| **TypeScript** | Загальний код між клієнтом і сервером (shared types), safety |
| **MessagePack** | 3-5× компактніший за JSON, швидший parse |
| **Власна фізика** | Гра проста — не потрібен повноцінний physics engine. AABB + sphere collision достатньо |

### 5.3 Альтернативи (розглянуті, відхилені)

| Альтернатива | Чому ні |
|--------------|---------|
| Babylon.js | Важчий, менше low-poly прикладів |
| PlayCanvas | Пропрієтарний cloud, менше контролю |
| Socket.io | Менш структурований для game rooms |
| Nakama | Надто enterprise, складніше для MVP |
| Unity WebGL | Занадто важкий для браузера, повільне завантаження |

---

## 6. PROJECT STRUCTURE

```
red-attack/
├── docs/
│   ├── REQUIREMENTS_AND_TECH_DESIGN.md
│   └── ASSET_GUIDE.md
├── packages/
│   ├── shared/              # Shared types & constants
│   │   ├── src/
│   │   │   ├── types.ts         # Game state types
│   │   │   ├── constants.ts     # Tuning params
│   │   │   └── protocol.ts      # Message schemas
│   │   └── package.json
│   ├── server/              # Game server
│   │   ├── src/
│   │   │   ├── index.ts         # Entry point
│   │   │   ├── rooms/
│   │   │   │   └── GameRoom.ts  # Colyseus room
│   │   │   ├── systems/
│   │   │   │   ├── Physics.ts   # Collision detection
│   │   │   │   ├── Spawner.ts   # Wave spawning
│   │   │   │   ├── EnemyAI.ts   # Pathfinding (simple)
│   │   │   │   └── Explosion.ts # AoE calculations
│   │   │   └── config.ts
│   │   └── package.json
│   └── client/              # Browser client
│       ├── src/
│       │   ├── main.ts          # Entry
│       │   ├── scene/
│       │   │   ├── Scene.ts         # Three.js scene setup
│       │   │   ├── Terrain.ts       # Flat ground + forest + outpost
│       │   │   ├── Drone.ts         # Drone model + controller
│       │   │   ├── Enemy.ts         # Enemy rendering
│       │   │   ├── Effects.ts       # Explosions, particles
│       │   │   └── Camera.ts        # FPV camera
│       │   ├── network/
│       │   │   ├── Client.ts        # WebSocket connection
│       │   │   └── Interpolator.ts  # State interpolation
│       │   ├── ui/
│       │   │   ├── HUD.ts           # In-game HUD
│       │   │   ├── Lobby.ts         # Pre-game UI
│       │   │   └── Overlays.ts      # Wave announcements
│       │   └── input/
│       │       └── InputManager.ts  # Keyboard + mouse
│       ├── public/
│       │   ├── models/              # GLTF models (low-poly)
│       │   ├── textures/            # Minimal textures
│       │   └── audio/               # SFX
│       ├── index.html
│       ├── vite.config.ts
│       └── package.json
├── scripts/
│   ├── deploy.sh            # Deploy to VPS
│   └── dev.sh               # Start dev environment
├── docker/
│   ├── Dockerfile
│   └── docker-compose.yml
├── package.json             # Monorepo root (npm workspaces)
└── tsconfig.json
```

---

## 7. RENDERING & VISUALS

### 7.1 Low-Poly Assets Plan

| Модель | Полігони (triangles) | Метод створення |
|--------|----------------------|-----------------|
| Терен (пагорб) | ~500 | Процедурний (heightmap) |
| Форпост | ~800 | Blender → GLTF |
| Дрон FPV | ~200 | Blender → GLTF |
| Чебурашка | ~300 | Blender → GLTF |
| Ведмідь | ~500 | Blender → GLTF |
| Солдат | ~350 | Blender → GLTF |
| Прапор | ~50 | Процедурний (plane + shader) |
| Ефекти вибуху | ~100 (particles) | Shader-based |

**Worst case (wave 12, 4P, 80 active):** 80 × 400 avg + 4 drones × 200 + terrain + effects ≈ **34k triangles** — легко для WebGL.

### 7.2 Освітлення
- Single directional light (sun) + ambient
- Baked shadows (shadow map 1024×1024)
- Flat/toon shading (MeshToonMaterial)

### 7.3 Ефекти
- **Вибух:** Particle system (50-100 particles, 1 сек)
- **Двигун дрона:** Trail (line geometry)
- **Сповіщення хвилі:** 3D text overlay
- **Смерть ворога:** Розпад на кубики (voxel explosion)

---

## 8. AUDIO

| Подія | Звук |
|-------|------|
| Запуск дрона | "Вжжж" (electric motor start) |
| Польот | Неперервний hum (loop) |
| Вибух | "БУМ" + debris |
| Влучення | "Туп" + "БУМ" |
| Хвиля починається | Сирена |
| Хвиля завершена | "All clear" |
| Перемога | Фанфари |
| Поразка | "Game over" |
| Фоновий вітер | Ambient loop |

**Формат:** OGG (WebM compatible), ~128kbps

---

## 9. UI/UX

### 9.1 Екрани

```
[Title Screen] → [Lobby (room code)] → [Game] → [Results]
```

### 9.2 HUD (під час гри)
- **Ліва:** HP форпосту (бар)
- **Право:** Статус дрона (cooldown timer / "READY")
- **Право (панель WEAPON):** шість рядків станцій — `1` дрон, `2` міномет, `3`–`6`
  кулеміти; активний рядок підсвічено, у рядку кулеміта залишок стрічки (або `SWAP Ns`,
  поки команда переставляє коробку), у рядку дрона — `IN FLIGHT` / `RELOAD Ns`
- **Центр (bottom):** Current wave / total waves
- **Центр (top):** Wave announcement (fade in/out)
- **Міні-мапа:** Top-down view з точками ворогів
- **Score:** Рахунок гравця + загальний

### 9.3 Lobby
- Створення гри → генерує код (напр. "RED-4F2A")
- Приєднання за кодом
- Готовність (player 1 = host, натискає "Start")
- Слотів: 4 (показує які зайняті)

---

## 10. PERFORMANCE TARGETS

| Метрика | Ціль |
|---------|------|
| FPS (клієнт) | 60 FPS при 80 активних ворогах |
| Load time | < 5 сек (перший раз), < 2 сек (cache) |
| Bundle size | < 2 MB (gzipped) |
| Server RAM | < 200 MB per 100 rooms |
| Server CPU | < 5% per room (single core) |
| Bandwidth per player | < 50 KB/s |
| Latency tolerance | < 200ms RTT |
| Max active enemies | 80 (hard cap) |

---

## 11. DEVELOPMENT PHASES

### Phase 1: Core Prototype (Week 1-2)
- [ ] Project setup (monorepo, Vite, Three.js, Colyseus)
- [ ] Basic terrain (flat plane + hill)
- [ ] Drone spawning + WASD+mouse controls
- [ ] Single enemy type (cube placeholder) moving toward outpost
- [ ] Collision detection → explosion
- [ ] Basic multiplayer (2 players, same room)

### Phase 2: Game Loop (Week 3-4)
- [ ] Wave system (spawning, timers, 30s interval)
- [ ] 3 enemy types with different stats
- [ ] Player-count scaling for enemies
- [ ] Outpost HP + damage
- [ ] Win/lose conditions
- [ ] Score system
- [ ] Unlimited drones + 1 controllable + reload mechanic

### Phase 3: Polish (Week 5-6)
- [ ] Low-poly models (Blender)
- [ ] Particle effects (explosions)
- [ ] Sound effects
- [ ] HUD + UI screens
- [ ] Lobby system
- [ ] Mini-map

### Phase 4: Deploy & Test (Week 7-8)
- [ ] Server deployment (Nginx + PM2 + SSL)
- [ ] Load testing
- [ ] Cross-browser testing
- [ ] Mobile viewport fallback (message: "Desktop only")
- [ ] Bug fixes

---

## 12. RISK MATRIX

| Ризик | Ймовірність | Вплив | Мітигація |
|-------|-------------|-------|-----------|
| Latency issues (drone feels laggy) | Medium | High | Client-side prediction + interpolation |
| Too many enemies → FPS drop | Low | Medium | Object pooling, LOD, max active enemies cap (80) |
| Browser compatibility | Low | Medium | WebGL2 requirement, fallback message |
| Server crash mid-game | Low | High | Auto-restart (PM2), state save |
| Asset creation bottleneck | Medium | Medium | Use placeholder cubes first, replace later |

---

## 13. FUTURE EXTENSIONS (Post-MVP)

- 🏔️ Кілька мап (пустеля, ліс, місто)
- 🔧 Апгрейди дрона (швидший, більший заряд, Kamikaze+shockwave)
- 👑 Boss-вороги (гігантський ведмідь)
- 📱 Mobile support (touch controls)
- 🏆 Leaderboard
- 🎨 Custom skins for drones
- 🤖 Bot players (fill empty slots)
