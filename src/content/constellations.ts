import type { Constellation } from '../types';

// Curated constellations, shipped with the app. Positions are hand-placed
// (x right, y down, roughly 0-100). Line direction is "builds on".
// This is a placeholder so the map has something to draw; the real ones are
// written by the user (CONSTELLATION_PLAN.md, stage 7).

export const CONSTELLATIONS: Constellation[] = [
  {
    id: 'rest-and-trust',
    title: 'Rest and trust',
    description: 'Where tired hearts can set their weight down.',
    guide: '',
    stars: [
      { id: 'ps23', ref: { book: 'Psalms', chapter: 23, start: 1, end: 4 }, x: 20, y: 30 },
      { id: 'matt11', ref: { book: 'Matthew', chapter: 11, start: 28, end: 30 }, x: 45, y: 15 },
      { id: '1pet5', ref: { book: '1 Peter', chapter: 5, start: 7, end: 7 }, x: 50, y: 45 },
      { id: 'heb4', ref: { book: 'Hebrews', chapter: 4, start: 15, end: 16 }, x: 75, y: 30 },
      { id: 'phil4', ref: { book: 'Philippians', chapter: 4, start: 6, end: 7 }, x: 70, y: 65 },
      { id: 'rom8', ref: { book: 'Romans', chapter: 8, start: 38, end: 39 }, x: 35, y: 75 },
    ],
    lines: [
      { from: 'ps23', to: 'matt11' },
      { from: 'matt11', to: '1pet5' },
      { from: '1pet5', to: 'heb4' },
      { from: 'heb4', to: 'phil4' },
      { from: 'phil4', to: 'rom8' },
    ],
  },
];
