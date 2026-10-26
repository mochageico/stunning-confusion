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
  {
    id: 'desiring-and-delighting-in-god',
    title: 'Desiring & Delighting in God',
    description: 'Wanting God, and finding him to be enough.',
    guide: '',
    stars: [
      { id: 'ps37', ref: { book: 'Psalms', chapter: 37, start: 3, end: 4 }, x: 20, y: 10 },
      { id: 'phil3', ref: { book: 'Philippians', chapter: 3, start: 7, end: 8 }, x: 80, y: 10 },
      { id: 'ps16', ref: { book: 'Psalms', chapter: 16, start: 5, end: 11 }, x: 20, y: 30 },
      { id: 'ps73', ref: { book: 'Psalms', chapter: 73, start: 25, end: 26 }, x: 80, y: 30 },
      { id: 'isa55', ref: { book: 'Isaiah', chapter: 55, start: 1, end: 3 }, x: 50, y: 52 },
      { id: 'jer29', ref: { book: 'Jeremiah', chapter: 29, start: 11, end: 13 }, x: 50, y: 66 },
      { id: 'ps42', ref: { book: 'Psalms', chapter: 42, start: 1, end: 2 }, x: 50, y: 80 },
      { id: 'ps63', ref: { book: 'Psalms', chapter: 63, start: 1, end: 4 }, x: 50, y: 94 },
    ],
    lines: [
      { from: 'ps37', to: 'phil3' },
      { from: 'ps37', to: 'ps16' },
      { from: 'phil3', to: 'ps73' },
      { from: 'ps16', to: 'ps73' },
      { from: 'ps16', to: 'isa55' },
      { from: 'ps73', to: 'isa55' },
      { from: 'isa55', to: 'jer29' },
      { from: 'jer29', to: 'ps42' },
      { from: 'ps42', to: 'ps63' },
    ],
  },
];
