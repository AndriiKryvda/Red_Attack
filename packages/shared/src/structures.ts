// ─────────────────────────────────────────────────────────────────────────────
// The built-up edge of the map: the fort stands in an open field, but the north
// and the east sides are lined with a strip of village — houses, a barn, a block
// of flats, a water tower — with cars parked along the front of it.
//
// Everything the two halves of the game need about a structure lives here: the
// server reads the footprint (it is what a drone collides with) and the hp, the
// client reads the same footprint to build the matching model, so the collision
// box and the mesh can never drift apart.
//
// Model convention (client): local +Z is the facade — the side that faces the
// fort — local X runs along the front, and the ground plane is y = 0.
// ─────────────────────────────────────────────────────────────────────────────

export enum StructureKind {
  BUILDING = 'building',
  CAR = 'car',
}

/** Which side of the square map a structure stands on (north = -Z, east = +X). */
export enum SpawnEdge {
  NORTH = 'north',
  EAST = 'east',
  SOUTH = 'south',
  WEST = 'west',
}

export enum BuildingVariant {
  HOUSE = 'house',
  BLOCK = 'block',
  BARN = 'barn',
  TOWER = 'tower',
}

export enum CarVariant {
  SEDAN = 'sedan',
  PICKUP = 'pickup',
  VAN = 'van',
  BUS = 'bus',
}

export type StructureVariant = BuildingVariant | CarVariant;

export interface StructureSpec {
  kind: StructureKind;
  /** Announcer label. */
  label: string;
  /** Meters along the facade (local X). For a car this is its length. */
  width: number;
  /** Meters from facade to back (local Z). For a car this is its body width. */
  depth: number;
  /** Meters tall, ground to the highest point. */
  height: number;
  /** Drone hits needed before it is rubble. */
  hp: number;
  /** Score paid to the pilot who levels it. */
  score: number;
}

/**
 * One drone hit deals 1 damage. A car goes up in a single pass; the buildings
 * soak two or three and catch fire on the first one, so a strike on the block of
 * flats is a real commitment of drones.
 */
export const STRUCTURE_SPECS: Record<StructureVariant, StructureSpec> = {
  [BuildingVariant.HOUSE]: { kind: StructureKind.BUILDING, label: 'HOUSE', width: 8, depth: 7, height: 6, hp: 2, score: 40 },
  [BuildingVariant.BLOCK]: { kind: StructureKind.BUILDING, label: 'APARTMENT BLOCK', width: 14, depth: 9, height: 12, hp: 3, score: 90 },
  [BuildingVariant.BARN]: { kind: StructureKind.BUILDING, label: 'BARN', width: 11, depth: 8, height: 7, hp: 2, score: 50 },
  [BuildingVariant.TOWER]: { kind: StructureKind.BUILDING, label: 'WATER TOWER', width: 6, depth: 6, height: 15, hp: 2, score: 60 },
  [CarVariant.SEDAN]: { kind: StructureKind.CAR, label: 'CAR', width: 4.4, depth: 1.9, height: 1.5, hp: 1, score: 15 },
  [CarVariant.PICKUP]: { kind: StructureKind.CAR, label: 'PICKUP', width: 5.2, depth: 2.0, height: 1.9, hp: 1, score: 18 },
  [CarVariant.VAN]: { kind: StructureKind.CAR, label: 'VAN', width: 5.6, depth: 2.2, height: 2.5, hp: 1, score: 20 },
  [CarVariant.BUS]: { kind: StructureKind.CAR, label: 'BUS', width: 8.5, depth: 2.6, height: 3.2, hp: 2, score: 30 },
};

/** Building variants the village builder draws from, heaviest last. */
export const BUILDING_VARIANTS: BuildingVariant[] = [
  BuildingVariant.HOUSE, BuildingVariant.BARN, BuildingVariant.HOUSE,
  BuildingVariant.BLOCK, BuildingVariant.HOUSE, BuildingVariant.TOWER,
  BuildingVariant.BARN,
];

/** Car variants the village builder draws from, cycled so an edge looks mixed. */
export const CAR_VARIANTS: CarVariant[] = [
  CarVariant.SEDAN, CarVariant.PICKUP, CarVariant.SEDAN,
  CarVariant.VAN, CarVariant.SEDAN, CarVariant.BUS,
];

// ─── Village layout ──────────────────────────────────────────────────────────
// The strip sits far enough out that a kamikaze run reaches it with flight time
// to spare: the worst corner is hypot(VILLAGE_SPREAD, VILLAGE_EDGE_OFFSET) ≈ 159 m
// against a DRONE_MAX_DISTANCE of 175 m.

/** Meters from the fort to the line the buildings stand on. */
export const VILLAGE_EDGE_OFFSET = 126;
/** Half the length of the built-up strip measured along the edge. */
export const VILLAGE_SPREAD = 96;
/** How far in front of the building line the parked cars reach, meters. */
export const VILLAGE_CAR_DEPTH = 20;

/** Tree-free rectangle: the forest must not grow trunks through the village. */
export interface VillageCorridor {
  minX: number; maxX: number; minZ: number; maxZ: number;
}

export function villageCorridors(): VillageCorridor[] {
  const far = VILLAGE_EDGE_OFFSET + 24;                        // past the map edge
  const near = VILLAGE_EDGE_OFFSET - VILLAGE_CAR_DEPTH - 6;    // in front of the cars
  const along = VILLAGE_SPREAD + 16;
  return [
    { minX: -along, maxX: along, minZ: -far, maxZ: -near },   // north strip
    { minX: near, maxX: far, minZ: -along, maxZ: along },      // east strip
  ];
}

// ─── Where the horde comes from ──────────────────────────────────────────────
// The assault concentrates on the built-up sides: four in ten enemies come out of
// the east, four in ten out of the north, and only one in ten each from the open
// west and south fields.

export const HORDE_SPAWN_EDGE_WEIGHTS: Record<SpawnEdge, number> = {
  [SpawnEdge.NORTH]: 40,
  [SpawnEdge.EAST]: 40,
  [SpawnEdge.WEST]: 10,
  [SpawnEdge.SOUTH]: 10,
};

/**
 * Bearing at the middle of each side, for the `x = cos(a) * d, z = sin(a) * d`
 * sampling the spawner already uses: east is 0, south is +PI/2, north is -PI/2.
 */
export const SPAWN_EDGE_ANGLE: Record<SpawnEdge, number> = {
  [SpawnEdge.NORTH]: -Math.PI / 2,
  [SpawnEdge.EAST]: 0,
  [SpawnEdge.SOUTH]: Math.PI / 2,
  [SpawnEdge.WEST]: Math.PI,
};

/** Half the arc sampled around a side's bearing; PI/4 would hit the corners. */
export const SPAWN_EDGE_ARC = 0.62;

/** Share of spawns on a built-up edge that come out of a doorway, not the field. */
export const HORDE_BUILDING_SPAWN_CHANCE = 0.75;
/** Meters a door spawn is scattered sideways along the facade. */
export const HORDE_DOOR_SPREAD = 3.5;
/** Meters between a building's facade and the point its enemies step out to. */
export const HORDE_DOOR_GAP = 3;

/** Weighted roll over the four sides of the map. */
export function pickSpawnEdge(rand: () => number = Math.random): SpawnEdge {
  const edges = [SpawnEdge.NORTH, SpawnEdge.EAST, SpawnEdge.WEST, SpawnEdge.SOUTH];
  let total = 0;
  for (const e of edges) total += HORDE_SPAWN_EDGE_WEIGHTS[e];
  let roll = rand() * total;
  for (const e of edges) {
    roll -= HORDE_SPAWN_EDGE_WEIGHTS[e];
    if (roll <= 0) return e;
  }
  return SpawnEdge.NORTH;
}