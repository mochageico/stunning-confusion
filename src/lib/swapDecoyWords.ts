// Fallback decoy vocabulary for English spot-the-swap.
//
// The drill pulls decoys from the passage itself first (see buildSwapVerses
// in drills.ts). A short passage often has no word of the right kind and
// length -- a lone verse may hold one past-tense verb -- so these common
// Bible words fill in. Each is tagged by hand, once, with the same word
// classes the tagger produces, so a verb in the past tense is only ever
// replaced by another past-tense verb.
//
// Keep entries 4+ letters (shorter words are never swapped) and in the plain
// register of modern translations -- no "-eth" forms, which would stand out.

/**
 * A word's class and form, as the swap drill compares them. Two words can
 * stand in for each other only when their classes match exactly.
 *
 * noun / nouns     singular / plural noun
 * verb             base form: "keep", "believe"
 * verb-s           "keeps", "believes"
 * verb-ed          simple past: "kept", "spoke"
 * verb-en          past participle: "taken", "had kept", "was spoken"
 * verb-ing         "keeping"
 * adj / adj-er / adj-est   plain / comparative / superlative adjective
 * adv              adverb
 */
export type SwapWordClass =
  | 'noun'
  | 'nouns'
  | 'verb'
  | 'verb-s'
  | 'verb-ed'
  | 'verb-en'
  | 'verb-ing'
  | 'adj'
  | 'adj-er'
  | 'adj-est'
  | 'adv';

const words = (cls: SwapWordClass, list: string): { word: string; cls: SwapWordClass }[] =>
  list
    .trim()
    .split(/\s+/)
    .map((word) => ({ word, cls }));

export const BIBLE_DECOY_WORDS: { word: string; cls: SwapWordClass }[] = [
  ...words(
    'noun',
    `heart soul mind spirit glory grace mercy faith hope peace truth light
     word world earth heaven kingdom temple house city land mountain river
     water bread wine blood flesh hand face voice name servant king prophet
     shepherd father mother brother child nation life death salvation
     covenant promise wisdom strength power praise sword stone field gate
     morning evening night wilderness throne altar offering sacrifice law
     righteousness judgment kindness love joy fear sorrow refuge rock path`
  ),
  ...words(
    'nouns',
    `hearts souls hands eyes words ways paths waters nations kings
     servants children brothers fathers prophets heavens mountains rivers
     stones fields gates enemies sins works gifts promises commands
     statutes laws days years generations cities houses tribes angels saints`
  ),
  ...words(
    'verb',
    `keep give take bring call hear know love trust seek follow bless praise
     serve speak walk stand fall rise remain abide forgive save build teach
     learn remember forget receive believe dwell rejoice sing pray return
     guard lead guide restore deliver comfort judge choose open gather`
  ),
  ...words(
    'verb-s',
    `keeps gives takes brings calls hears knows loves trusts seeks follows
     blesses serves speaks walks stands falls rises remains abides forgives
     saves builds teaches receives believes dwells rejoices prays returns
     guards leads guides restores delivers comforts judges chooses gathers`
  ),
  ...words(
    'verb-ed',
    `kept gave took brought called heard knew loved trusted sought followed
     blessed served spoke walked stood fell rose remained forgave saved built
     taught received believed dwelt rejoiced prayed returned guarded led
     guided restored delivered comforted judged chose gathered created
     sent made found`
  ),
  ...words(
    'verb-en',
    `given taken spoken written chosen known shown sent made found kept
     brought heard loved trusted sought followed blessed served called saved
     built taught received believed restored delivered gathered created
     forgiven risen fallen broken hidden`
  ),
  ...words(
    'verb-ing',
    `keeping giving taking bringing calling hearing knowing loving trusting
     seeking following blessing serving speaking walking standing falling
     rising remaining abiding forgiving saving building teaching receiving
     believing dwelling rejoicing praying returning guarding leading guiding`
  ),
  ...words(
    'adj',
    `holy righteous faithful mighty gracious merciful eternal everlasting
     great good evil wicked humble gentle pure true wise foolish strong weak
     glorious perfect whole living dead poor rich small high deep bright
     dark quiet still green broad narrow beloved blessed worthy upright`
  ),
  ...words('adj-er', `greater higher stronger wiser better deeper sweeter richer brighter`),
  ...words('adj-est', `greatest highest strongest wisest least mightiest`),
  ...words(
    'adv',
    `surely truly greatly freely quickly gladly faithfully wholly fully
     always never forever continually daily openly richly boldly humbly`
  ),
];
