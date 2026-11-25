/**
 * ELSEWEDY POWER CABLES KNOWLEDGE BASE — AUTO-GENERATED FILE, DO NOT EDIT BY HAND.
 *
 * Source: "Power Cables.pdf" — Elsewedy Electric Cables catalogue (Power Cables
 * Division). Every numeric entry was extracted programmatically from the PDF
 * text layer by scripts/extract_cables_kb.py + scripts/gen_cables_kb_ts.py and
 * verified against the printed pages (coordinate-level spot checks included).
 *
 * Suspect cells (catalogue misprints kept verbatim + flagged):
 *  - sc_cu_pvc 10mm² airFlatTouched printed "9" (neighbours: 48 @ 6mm², 85 @ 16mm²).
 *  - Table 11 perforatedTrefoil t2/3cables printed "0.98" (breaks monotonic trend).
 * The sizing engine treats flagged cells conservatively (uses the lower sane
 * bound) and the citation layer surfaces the caveat whenever the cell matters.
 *
 * Citation format: [Elsewedy Electric — Power Cables Catalogue, Table/Section X, p.N]
 * Catalogue ampacity basis (General Information §7, p.15): IEC 60287 — air 30°C
 * shaded, ground 20°C, soil thermal resistivity 100 K.cm/W, depth 0.5 m, duct
 * diameter 1.5×cable OD, unity load factor, 50 Hz.
 */

export interface CableAmpacityRow {
  csa: number;
  csaLabel: string;
  dc20: number;
  ac: number;
  capUfKm?: number;
  indMhKm?: number;
  groundFlat?: number;
  groundTrefoil?: number;
  duct?: number;
  airFlatSeparated?: number;
  airFlatTouched?: number;
  airTrefoilTouched?: number;
  ground?: number;
  air?: number;
}

export interface CableAmpacityTable {
  id: string;
  label: string;
  voltage: string;
  cores: "single" | "multi3" | "multi4" | "multi4red" | "mv3" | "mv1";
  conductor: "cu" | "al";
  insulation: "pvc" | "xlpe";
  page: number;
  cols: string[];
  rows: CableAmpacityRow[];
  notes?: string[];
}

export const ELSEWEDY_META = {
  source: "Elsewedy Electric — Power Cables Catalogue (Power Cables Division)",
  citationFormat: "[Elsewedy Electric — Power Cables Catalogue, <Table/Section>, p.N]",
  ampacityBasis: "IEC 60287 — هواء 30°C مظلل، أرض 20°C، مقاومة حرارية للتربة 100 K.cm/W، عمق 0.5م، قطر مجرى 1.5×قطر الكابل، معامل حمل = 1، تردد 50Hz",
  tableCount: 20,
} as const;

/** Ampacity tables — the sizing engine searches these in ascending csa order. */
export const AMPACITY_TABLES: CableAmpacityTable[] = [
  {
    id: "sc_cu_pvc",
    label: "0.6/1 kV Single Core Cu/PVC/PVC — 1 Core",
    voltage: "0.6/1 kV",
    cores: "single",
    conductor: "cu",
    insulation: "pvc",
    page: 64,
    cols: ["groundFlat", "groundTrefoil", "duct", "airFlatSeparated", "airFlatTouched", "airTrefoilTouched"],
    rows: [
    { csa: 4, csaLabel: "4", dc20: 4.61, ac: 5.51, groundFlat: 53, groundTrefoil: 53, duct: 38, airFlatSeparated: 50, airFlatTouched: 37, airTrefoilTouched: 35 },
    { csa: 6, csaLabel: "6", dc20: 3.08, ac: 3.68, groundFlat: 65, groundTrefoil: 66, duct: 47, airFlatSeparated: 65, airFlatTouched: 48, airTrefoilTouched: 46 },
    { csa: 10, csaLabel: "10", dc20: 1.83, ac: 2.17, groundFlat: 88, groundTrefoil: 89, duct: 62, airFlatSeparated: 89, airFlatTouched: 9, airTrefoilTouched: 62 },
    { csa: 16, csaLabel: "16", dc20: 1.15, ac: 1.37, groundFlat: 113, groundTrefoil: 113, duct: 77, airFlatSeparated: 108, airFlatTouched: 85, airTrefoilTouched: 79 },
    { csa: 25, csaLabel: "25", dc20: 0.727, ac: 0.8701, groundFlat: 143, groundTrefoil: 144, duct: 101, airFlatSeparated: 143, airFlatTouched: 112, airTrefoilTouched: 109 },
    { csa: 35, csaLabel: "35", dc20: 0.524, ac: 0.6273, groundFlat: 171, groundTrefoil: 173, duct: 123, airFlatSeparated: 176, airFlatTouched: 138, airTrefoilTouched: 134 },
    { csa: 50, csaLabel: "50", dc20: 0.387, ac: 0.4635, groundFlat: 203, groundTrefoil: 205, duct: 148, airFlatSeparated: 214, airFlatTouched: 170, airTrefoilTouched: 165 },
    { csa: 70, csaLabel: "70", dc20: 0.268, ac: 0.3214, groundFlat: 248, groundTrefoil: 252, duct: 183, airFlatSeparated: 271, airFlatTouched: 215, airTrefoilTouched: 209 },
    { csa: 95, csaLabel: "95", dc20: 0.193, ac: 0.232, groundFlat: 296, groundTrefoil: 301, duct: 224, airFlatSeparated: 332, airFlatTouched: 267, airTrefoilTouched: 259 },
    { csa: 120, csaLabel: "120", dc20: 0.153, ac: 0.1845, groundFlat: 337, groundTrefoil: 342, duct: 255, airFlatSeparated: 386, airFlatTouched: 310, airTrefoilTouched: 301 },
    { csa: 150, csaLabel: "150", dc20: 0.124, ac: 0.1501, groundFlat: 378, groundTrefoil: 383, duct: 292, airFlatSeparated: 442, airFlatTouched: 357, airTrefoilTouched: 347 },
    { csa: 185, csaLabel: "185", dc20: 0.0991, ac: 0.1207, groundFlat: 426, groundTrefoil: 433, duct: 333, airFlatSeparated: 510, airFlatTouched: 415, airTrefoilTouched: 402 },
    { csa: 240, csaLabel: "240", dc20: 0.0754, ac: 0.0931, groundFlat: 494, groundTrefoil: 501, duct: 393, airFlatSeparated: 608, airFlatTouched: 496, airTrefoilTouched: 481 },
    { csa: 300, csaLabel: "300", dc20: 0.0601, ac: 0.0755, groundFlat: 556, groundTrefoil: 565, duct: 450, airFlatSeparated: 704, airFlatTouched: 575, airTrefoilTouched: 558 },
    { csa: 400, csaLabel: "400", dc20: 0.047, ac: 0.0608, groundFlat: 629, groundTrefoil: 639, duct: 516, airFlatSeparated: 819, airFlatTouched: 669, airTrefoilTouched: 648 },
    { csa: 500, csaLabel: "500", dc20: 0.0366, ac: 0.0495, groundFlat: 709, groundTrefoil: 721, duct: 594, airFlatSeparated: 957, airFlatTouched: 777, airTrefoilTouched: 753 },
    { csa: 630, csaLabel: "630", dc20: 0.0283, ac: 0.041, groundFlat: 792, groundTrefoil: 807, duct: 672, airFlatSeparated: 1113, airFlatTouched: 893, airTrefoilTouched: 864 },
    { csa: 800, csaLabel: "800", dc20: 0.0221, ac: 0.035, groundFlat: 874, groundTrefoil: 891, duct: 753, airFlatSeparated: 1284, airFlatTouched: 1014, airTrefoilTouched: 982 },
    { csa: 1000, csaLabel: "1000", dc20: 0.0176, ac: 0.0308, groundFlat: 956, groundTrefoil: 975, duct: 845, airFlatSeparated: 1478, airFlatTouched: 1154, airTrefoilTouched: 1116 },
    ],
  notes: ["قيمة airFlatTouched لمقطع 10مم² مطبوعة 9A بالكتالوج (خطأ طباعي واضح: 6مم²=48 و16مم²=85) — لا تُعتمد"],
  },
  {
    id: "sc_al_pvc",
    label: "0.6/1 kV Single Core AL/PVC/PVC — 1 Core",
    voltage: "0.6/1 kV",
    cores: "single",
    conductor: "al",
    insulation: "pvc",
    page: 65,
    cols: ["groundFlat", "groundTrefoil", "duct", "airFlatSeparated", "airFlatTouched", "airTrefoilTouched"],
    rows: [
    { csa: 16, csaLabel: "16", dc20: 1.91, ac: 2.2949, groundFlat: 86, groundTrefoil: 87, duct: 60, airFlatSeparated: 83, airFlatTouched: 65, airTrefoilTouched: 63 },
    { csa: 25, csaLabel: "25", dc20: 1.2, ac: 1.4419, groundFlat: 111, groundTrefoil: 112, duct: 79, airFlatSeparated: 111, airFlatTouched: 87, airTrefoilTouched: 85 },
    { csa: 35, csaLabel: "35", dc20: 0.868, ac: 1.0431, groundFlat: 133, groundTrefoil: 134, duct: 95, airFlatSeparated: 136, airFlatTouched: 107, airTrefoilTouched: 104 },
    { csa: 50, csaLabel: "50", dc20: 0.641, ac: 0.7704, groundFlat: 157, groundTrefoil: 159, duct: 115, airFlatSeparated: 166, airFlatTouched: 132, airTrefoilTouched: 128 },
    { csa: 70, csaLabel: "70", dc20: 0.443, ac: 0.5327, groundFlat: 193, groundTrefoil: 195, duct: 142, airFlatSeparated: 210, airFlatTouched: 167, airTrefoilTouched: 162 },
    { csa: 95, csaLabel: "95", dc20: 0.32, ac: 0.3851, groundFlat: 230, groundTrefoil: 233, duct: 174, airFlatSeparated: 258, airFlatTouched: 207, airTrefoilTouched: 201 },
    { csa: 120, csaLabel: "120", dc20: 0.253, ac: 0.3048, groundFlat: 262, groundTrefoil: 266, duct: 198, airFlatSeparated: 300, airFlatTouched: 241, airTrefoilTouched: 234 },
    { csa: 150, csaLabel: "150", dc20: 0.206, ac: 0.2485, groundFlat: 294, groundTrefoil: 298, duct: 227, airFlatSeparated: 343, airFlatTouched: 278, airTrefoilTouched: 269 },
    { csa: 185, csaLabel: "185", dc20: 0.164, ac: 0.1984, groundFlat: 333, groundTrefoil: 338, duct: 260, airFlatSeparated: 397, airFlatTouched: 324, airTrefoilTouched: 314 },
    { csa: 240, csaLabel: "240", dc20: 0.125, ac: 0.1519, groundFlat: 386, groundTrefoil: 392, duct: 307, airFlatSeparated: 473, airFlatTouched: 388, airTrefoilTouched: 376 },
    { csa: 300, csaLabel: "300", dc20: 0.1, ac: 0.1224, groundFlat: 437, groundTrefoil: 444, duct: 353, airFlatSeparated: 548, airFlatTouched: 451, airTrefoilTouched: 438 },
    { csa: 400, csaLabel: "400", dc20: 0.0778, ac: 0.0964, groundFlat: 499, groundTrefoil: 508, duct: 410, airFlatSeparated: 644, airFlatTouched: 531, airTrefoilTouched: 515 },
    { csa: 500, csaLabel: "500", dc20: 0.0605, ac: 0.0764, groundFlat: 570, groundTrefoil: 580, duct: 478, airFlatSeparated: 757, airFlatTouched: 625, airTrefoilTouched: 605 },
    { csa: 630, csaLabel: "630", dc20: 0.0469, ac: 0.0612, groundFlat: 648, groundTrefoil: 660, duct: 550, airFlatSeparated: 889, airFlatTouched: 730, airTrefoilTouched: 707 },
    { csa: 800, csaLabel: "800", dc20: 0.0367, ac: 0.0503, groundFlat: 730, groundTrefoil: 744, duct: 630, airFlatSeparated: 1045, airFlatTouched: 850, airTrefoilTouched: 822 },
    { csa: 1000, csaLabel: "1000", dc20: 0.0291, ac: 0.0425, groundFlat: 814, groundTrefoil: 830, duct: 719, airFlatSeparated: 1219, airFlatTouched: 982, airTrefoilTouched: 950 },
    ],
  },
  {
    id: "mc3_cu_pvc",
    label: "0.6/1 kV 3-Core Cu/PVC/PVC Unarmoured",
    voltage: "0.6/1 kV",
    cores: "multi3",
    conductor: "cu",
    insulation: "pvc",
    page: 71,
    cols: ["ground", "duct", "air"],
    rows: [
    { csa: 1.5, csaLabel: "1.5", dc20: 12.1, ac: 14.6, ground: 27, duct: 21, air: 20 },
    { csa: 2.5, csaLabel: "2.5", dc20: 7.41, ac: 8.87, ground: 35, duct: 27, air: 24 },
    { csa: 4, csaLabel: "4", dc20: 4.61, ac: 5.54, ground: 46, duct: 36, air: 34 },
    { csa: 6, csaLabel: "6", dc20: 3.08, ac: 3.69, ground: 59, duct: 43, air: 43 },
    { csa: 10, csaLabel: "10", dc20: 1.83, ac: 2.19, ground: 78, duct: 57, air: 59 },
    { csa: 16, csaLabel: "16", dc20: 1.15, ac: 1.39, ground: 98, duct: 71, air: 80 },
    { csa: 25, csaLabel: "25", dc20: 0.727, ac: 0.8702, ground: 130, duct: 94, air: 102 },
    { csa: 35, csaLabel: "35", dc20: 0.524, ac: 0.6274, ground: 156, duct: 114, air: 125 },
    { csa: 50, csaLabel: "50", dc20: 0.387, ac: 0.4635, ground: 189, duct: 136, air: 151 },
    { csa: 70, csaLabel: "70", dc20: 0.268, ac: 0.3214, ground: 232, duct: 169, air: 191 },
    { csa: 95, csaLabel: "95", dc20: 0.193, ac: 0.2319, ground: 278, duct: 205, air: 235 },
    { csa: 120, csaLabel: "120", dc20: 0.153, ac: 0.1844, ground: 315, duct: 234, air: 270 },
    { csa: 150, csaLabel: "150", dc20: 0.124, ac: 0.15, ground: 354, duct: 266, air: 310 },
    { csa: 185, csaLabel: "185", dc20: 0.0991, ac: 0.1206, ground: 399, duct: 303, air: 357 },
    { csa: 240, csaLabel: "240", dc20: 0.0754, ac: 0.0928, ground: 462, duct: 357, air: 423 },
    { csa: 300, csaLabel: "300", dc20: 0.0601, ac: 0.0752, ground: 521, duct: 406, air: 486 },
    { csa: 400, csaLabel: "400", dc20: 0.047, ac: 0.0603, ground: 593, duct: 468, air: 567 },
    { csa: 500, csaLabel: "500", dc20: 0.0366, ac: 0.0489, ground: 668, duct: 534, air: 650 },
    ],
  },
  {
    id: "mc4_cu_pvc",
    label: "0.6/1 kV 4-Core Cu/PVC/PVC Unarmoured",
    voltage: "0.6/1 kV",
    cores: "multi4",
    conductor: "cu",
    insulation: "pvc",
    page: 71,
    cols: ["ground", "duct", "air"],
    rows: [
    { csa: 1.5, csaLabel: "1.5", dc20: 12.1, ac: 14.6, ground: 28, duct: 22, air: 21 },
    { csa: 2.5, csaLabel: "2.5", dc20: 7.41, ac: 8.87, ground: 36, duct: 28, air: 25 },
    { csa: 4, csaLabel: "4", dc20: 4.61, ac: 5.54, ground: 46, duct: 36, air: 36 },
    { csa: 6, csaLabel: "6", dc20: 3.08, ac: 3.69, ground: 60, duct: 44, air: 45 },
    { csa: 10, csaLabel: "10", dc20: 1.83, ac: 2.19, ground: 79, duct: 58, air: 61 },
    { csa: 16, csaLabel: "16", dc20: 1.15, ac: 1.39, ground: 99, duct: 73, air: 83 },
    { csa: 25, csaLabel: "25", dc20: 0.727, ac: 0.8702, ground: 131, duct: 96, air: 105 },
    { csa: 35, csaLabel: "35", dc20: 0.524, ac: 0.6274, ground: 158, duct: 116, air: 129 },
    { csa: 50, csaLabel: "50", dc20: 0.387, ac: 0.4635, ground: 195, duct: 141, air: 161 },
    { csa: 70, csaLabel: "70", dc20: 0.268, ac: 0.3214, ground: 239, duct: 175, air: 203 },
    { csa: 95, csaLabel: "95", dc20: 0.193, ac: 0.2319, ground: 285, duct: 211, air: 247 },
    { csa: 120, csaLabel: "120", dc20: 0.153, ac: 0.1844, ground: 324, duct: 243, air: 287 },
    { csa: 150, csaLabel: "150", dc20: 0.124, ac: 0.15, ground: 364, duct: 277, air: 329 },
    { csa: 185, csaLabel: "185", dc20: 0.0991, ac: 0.1206, ground: 411, duct: 316, air: 379 },
    { csa: 240, csaLabel: "240", dc20: 0.0754, ac: 0.0928, ground: 476, duct: 372, air: 450 },
    { csa: 300, csaLabel: "300", dc20: 0.0601, ac: 0.0752, ground: 537, duct: 425, air: 516 },
    { csa: 400, csaLabel: "400", dc20: 0.047, ac: 0.0603, ground: 610, duct: 490, air: 601 },
    { csa: 500, csaLabel: "500", dc20: 0.0366, ac: 0.0489, ground: 689, duct: 561, air: 690 },
    ],
  },
  {
    id: "mc4red_cu_pvc",
    label: "0.6/1 kV 4-Core Reduced Neutral Cu/PVC/PVC",
    voltage: "0.6/1 kV",
    cores: "multi4red",
    conductor: "cu",
    insulation: "pvc",
    page: 71,
    cols: ["ground", "duct", "air"],
    rows: [
    { csa: 25, csaLabel: "25 / 16", dc20: 0.727, ac: 0.8702, ground: 130, duct: 95, air: 103 },
    { csa: 35, csaLabel: "35 / 16", dc20: 0.524, ac: 0.6274, ground: 157, duct: 115, air: 126 },
    { csa: 50, csaLabel: "50 / 25", dc20: 0.387, ac: 0.4635, ground: 195, duct: 141, air: 161 },
    { csa: 70, csaLabel: "70 / 35", dc20: 0.268, ac: 0.3214, ground: 239, duct: 175, air: 203 },
    { csa: 95, csaLabel: "95 / 50", dc20: 0.193, ac: 0.2319, ground: 282, duct: 209, air: 243 },
    { csa: 120, csaLabel: "120 / 70", dc20: 0.153, ac: 0.1844, ground: 322, duct: 241, air: 282 },
    { csa: 150, csaLabel: "150 / 70", dc20: 0.124, ac: 0.15, ground: 361, duct: 273, air: 323 },
    { csa: 185, csaLabel: "185 / 95", dc20: 0.0991, ac: 0.1206, ground: 407, duct: 311, air: 372 },
    { csa: 240, csaLabel: "240 / 120", dc20: 0.0754, ac: 0.0928, ground: 472, duct: 366, air: 441 },
    { csa: 300, csaLabel: "300 / 150", dc20: 0.0601, ac: 0.0752, ground: 532, duct: 419, air: 507 },
    { csa: 400, csaLabel: "400 / 185", dc20: 0.047, ac: 0.0603, ground: 605, duct: 482, air: 590 },
    { csa: 500, csaLabel: "500 / 240", dc20: 0.0366, ac: 0.0489, ground: 682, duct: 550, air: 676 },
    ],
  },
  {
    id: "mc4_al_pvc",
    label: "0.6/1 kV 4-Core AL/PVC/PVC Unarmoured",
    voltage: "0.6/1 kV",
    cores: "multi4",
    conductor: "al",
    insulation: "pvc",
    page: 73,
    cols: ["ground", "duct", "air"],
    rows: [
    { csa: 16, csaLabel: "16", dc20: 1.91, ac: 2.295, ground: 79, duct: 57, air: 61 },
    // biome-ignore lint/suspicious/noApproximativeNumericConstant: measured cable data — ac 1.442 Ω/km is a physical AC-resistance value for 25mm² copper (looks like log2(e), but it is IEC-table data, never a math constant)
    { csa: 25, csaLabel: "25", dc20: 1.2, ac: 1.442, ground: 102, duct: 75, air: 81 },
    { csa: 35, csaLabel: "35", dc20: 0.868, ac: 1.0432, ground: 123, duct: 90, air: 100 },
    { csa: 50, csaLabel: "50", dc20: 0.641, ac: 0.7704, ground: 151, duct: 110, air: 125 },
    { csa: 70, csaLabel: "70", dc20: 0.443, ac: 0.5327, ground: 185, duct: 136, air: 157 },
    { csa: 95, csaLabel: "95", dc20: 0.32, ac: 0.3851, ground: 221, duct: 164, air: 192 },
    { csa: 120, csaLabel: "120", dc20: 0.253, ac: 0.3048, ground: 252, duct: 189, air: 223 },
    { csa: 150, csaLabel: "150", dc20: 0.206, ac: 0.2485, ground: 283, duct: 216, air: 256 },
    { csa: 185, csaLabel: "185", dc20: 0.164, ac: 0.1983, ground: 321, duct: 247, air: 296 },
    { csa: 240, csaLabel: "240", dc20: 0.125, ac: 0.1518, ground: 372, duct: 291, air: 352 },
    { csa: 300, csaLabel: "300", dc20: 0.1, ac: 0.1222, ground: 421, duct: 333, air: 405 },
    { csa: 400, csaLabel: "400", dc20: 0.0778, ac: 0.0961, ground: 484, duct: 388, air: 477 },
    { csa: 500, csaLabel: "500", dc20: 0.0605, ac: 0.076, ground: 552, duct: 450, air: 554 },
    ],
  },
  {
    id: "mc4red_al_pvc",
    label: "0.6/1 kV 4-Core Reduced Neutral AL/PVC/PVC",
    voltage: "0.6/1 kV",
    cores: "multi4red",
    conductor: "al",
    insulation: "pvc",
    page: 73,
    cols: ["ground", "duct", "air"],
    rows: [
    // biome-ignore lint/suspicious/noApproximativeNumericConstant: measured cable data — ac 1.442 Ω/km is a physical AC-resistance value for the 25mm² aluminum row (IEC-table data, never a math constant)
    { csa: 25, csaLabel: "25 / 16", dc20: 1.2, ac: 1.442, ground: 101, duct: 74, air: 80 },
    { csa: 35, csaLabel: "35 / 16", dc20: 0.868, ac: 1.0432, ground: 122, duct: 89, air: 98 },
    { csa: 50, csaLabel: "50 / 25", dc20: 0.641, ac: 0.7704, ground: 151, duct: 110, air: 125 },
    { csa: 70, csaLabel: "70 / 35", dc20: 0.443, ac: 0.5327, ground: 186, duct: 136, air: 158 },
    { csa: 95, csaLabel: "95 / 50", dc20: 0.32, ac: 0.3851, ground: 219, duct: 162, air: 188 },
    { csa: 120, csaLabel: "120 / 70", dc20: 0.253, ac: 0.3048, ground: 250, duct: 187, air: 220 },
    { csa: 150, csaLabel: "150 / 70", dc20: 0.206, ac: 0.2485, ground: 280, duct: 212, air: 251 },
    { csa: 185, csaLabel: "185 / 95", dc20: 0.164, ac: 0.1983, ground: 318, duct: 243, air: 290 },
    { csa: 240, csaLabel: "240 / 120", dc20: 0.125, ac: 0.1518, ground: 369, duct: 287, air: 345 },
    { csa: 300, csaLabel: "300 / 150", dc20: 0.1, ac: 0.1222, ground: 417, duct: 328, air: 397 },
    { csa: 400, csaLabel: "400 / 185", dc20: 0.0778, ac: 0.0961, ground: 479, duct: 382, air: 467 },
    { csa: 500, csaLabel: "500 / 240", dc20: 0.0605, ac: 0.076, ground: 547, duct: 441, air: 543 },
    ],
  },
  {
    id: "sc_cu_xlpe",
    label: "0.6/1 kV Single Core Cu/XLPE/PVC — 1 Core",
    voltage: "0.6/1 kV",
    cores: "single",
    conductor: "cu",
    insulation: "xlpe",
    page: 83,
    cols: ["groundFlat", "groundTrefoil", "duct", "airFlatSeparated", "airFlatTouched", "airTrefoilTouched"],
    rows: [
    { csa: 4, csaLabel: "4", dc20: 4.61, ac: 5.54, groundFlat: 60, groundTrefoil: 60, duct: 42, airFlatSeparated: 65, airFlatTouched: 47, airTrefoilTouched: 44 },
    { csa: 6, csaLabel: "6", dc20: 3.08, ac: 3.69, groundFlat: 76, groundTrefoil: 77, duct: 56, airFlatSeparated: 80, airFlatTouched: 59, airTrefoilTouched: 59 },
    { csa: 10, csaLabel: "10", dc20: 1.83, ac: 2.19, groundFlat: 103, groundTrefoil: 105, duct: 72, airFlatSeparated: 103, airFlatTouched: 79, airTrefoilTouched: 75 },
    { csa: 16, csaLabel: "16", dc20: 1.15, ac: 1.39, groundFlat: 129, groundTrefoil: 131, duct: 92, airFlatSeparated: 142, airFlatTouched: 110, airTrefoilTouched: 105 },
    { csa: 25, csaLabel: "25", dc20: 0.727, ac: 0.9272, groundFlat: 166, groundTrefoil: 168, duct: 118, airFlatSeparated: 179, airFlatTouched: 138, airTrefoilTouched: 134 },
    { csa: 35, csaLabel: "35", dc20: 0.524, ac: 0.6685, groundFlat: 199, groundTrefoil: 201, duct: 143, airFlatSeparated: 220, airFlatTouched: 171, airTrefoilTouched: 166 },
    { csa: 50, csaLabel: "50", dc20: 0.387, ac: 0.4939, groundFlat: 236, groundTrefoil: 239, duct: 172, airFlatSeparated: 269, airFlatTouched: 210, airTrefoilTouched: 204 },
    { csa: 70, csaLabel: "70", dc20: 0.268, ac: 0.3425, groundFlat: 288, groundTrefoil: 292, duct: 214, airFlatSeparated: 340, airFlatTouched: 268, airTrefoilTouched: 260 },
    { csa: 95, csaLabel: "95", dc20: 0.193, ac: 0.2472, groundFlat: 344, groundTrefoil: 349, duct: 259, airFlatSeparated: 418, airFlatTouched: 331, airTrefoilTouched: 321 },
    { csa: 120, csaLabel: "120", dc20: 0.153, ac: 0.1965, groundFlat: 391, groundTrefoil: 397, duct: 298, airFlatSeparated: 486, airFlatTouched: 386, airTrefoilTouched: 375 },
    { csa: 150, csaLabel: "150", dc20: 0.124, ac: 0.1598, groundFlat: 439, groundTrefoil: 445, duct: 339, airFlatSeparated: 557, airFlatTouched: 446, airTrefoilTouched: 433 },
    { csa: 185, csaLabel: "185", dc20: 0.0991, ac: 0.1285, groundFlat: 496, groundTrefoil: 503, duct: 390, airFlatSeparated: 646, airFlatTouched: 519, airTrefoilTouched: 503 },
    { csa: 240, csaLabel: "240", dc20: 0.0754, ac: 0.099, groundFlat: 574, groundTrefoil: 583, duct: 457, airFlatSeparated: 771, airFlatTouched: 622, airTrefoilTouched: 602 },
    { csa: 300, csaLabel: "300", dc20: 0.0601, ac: 0.0803, groundFlat: 647, groundTrefoil: 658, duct: 524, airFlatSeparated: 895, airFlatTouched: 722, airTrefoilTouched: 699 },
    { csa: 400, csaLabel: "400", dc20: 0.047, ac: 0.0645, groundFlat: 732, groundTrefoil: 744, duct: 603, airFlatSeparated: 1044, airFlatTouched: 842, airTrefoilTouched: 815 },
    { csa: 500, csaLabel: "500", dc20: 0.0366, ac: 0.0525, groundFlat: 826, groundTrefoil: 840, duct: 695, airFlatSeparated: 1222, airFlatTouched: 981, airTrefoilTouched: 950 },
    { csa: 630, csaLabel: "630", dc20: 0.0283, ac: 0.0431, groundFlat: 925, groundTrefoil: 942, duct: 794, airFlatSeparated: 1420, airFlatTouched: 1132, airTrefoilTouched: 1096 },
    { csa: 800, csaLabel: "800", dc20: 0.0221, ac: 0.0366, groundFlat: 1022, groundTrefoil: 1042, duct: 894, airFlatSeparated: 1639, airFlatTouched: 1291, airTrefoilTouched: 1249 },
    { csa: 1000, csaLabel: "1000", dc20: 0.0176, ac: 0.0321, groundFlat: 1119, groundTrefoil: 1142, duct: 999, airFlatSeparated: 1894, airFlatTouched: 1473, airTrefoilTouched: 1423 },
    ],
  },
  {
    id: "sc_al_xlpe",
    label: "0.6/1 kV Single Core AL/XLPE/PVC — 1 Core",
    voltage: "0.6/1 kV",
    cores: "single",
    conductor: "al",
    insulation: "xlpe",
    page: 83,
    cols: ["groundFlat", "groundTrefoil", "duct", "airFlatSeparated", "airFlatTouched", "airTrefoilTouched"],
    rows: [
    { csa: 16, csaLabel: "16", dc20: 1.91, ac: 2.4489, groundFlat: 100, groundTrefoil: 101, duct: 70, airFlatSeparated: 104, airFlatTouched: 80, airTrefoilTouched: 77 },
    { csa: 25, csaLabel: "25", dc20: 1.2, ac: 1.5387, groundFlat: 129, groundTrefoil: 130, duct: 92, airFlatSeparated: 139, airFlatTouched: 107, airTrefoilTouched: 104 },
    { csa: 35, csaLabel: "35", dc20: 0.868, ac: 1.1131, groundFlat: 154, groundTrefoil: 156, duct: 111, airFlatSeparated: 171, airFlatTouched: 133, airTrefoilTouched: 129 },
    { csa: 50, csaLabel: "50", dc20: 0.641, ac: 0.8221, groundFlat: 183, groundTrefoil: 185, duct: 134, airFlatSeparated: 208, airFlatTouched: 163, airTrefoilTouched: 158 },
    { csa: 70, csaLabel: "70", dc20: 0.443, ac: 0.5684, groundFlat: 224, groundTrefoil: 227, duct: 166, airFlatSeparated: 264, airFlatTouched: 208, airTrefoilTouched: 202 },
    { csa: 95, csaLabel: "95", dc20: 0.32, ac: 0.4109, groundFlat: 267, groundTrefoil: 271, duct: 201, airFlatSeparated: 324, airFlatTouched: 256, airTrefoilTouched: 249 },
    { csa: 120, csaLabel: "120", dc20: 0.253, ac: 0.3252, groundFlat: 304, groundTrefoil: 309, duct: 232, airFlatSeparated: 377, airFlatTouched: 300, airTrefoilTouched: 291 },
    { csa: 150, csaLabel: "150", dc20: 0.206, ac: 0.2651, groundFlat: 341, groundTrefoil: 346, duct: 263, airFlatSeparated: 432, airFlatTouched: 346, airTrefoilTouched: 336 },
    { csa: 185, csaLabel: "185", dc20: 0.164, ac: 0.2116, groundFlat: 386, groundTrefoil: 392, duct: 304, airFlatSeparated: 502, airFlatTouched: 404, airTrefoilTouched: 392 },
    { csa: 240, csaLabel: "240", dc20: 0.125, ac: 0.162, groundFlat: 448, groundTrefoil: 456, duct: 357, airFlatSeparated: 599, airFlatTouched: 485, airTrefoilTouched: 470 },
    { csa: 300, csaLabel: "300", dc20: 0.1, ac: 0.1305, groundFlat: 507, groundTrefoil: 516, duct: 411, airFlatSeparated: 696, airFlatTouched: 566, airTrefoilTouched: 548 },
    { csa: 400, csaLabel: "400", dc20: 0.0778, ac: 0.1026, groundFlat: 580, groundTrefoil: 590, duct: 478, airFlatSeparated: 819, airFlatTouched: 667, airTrefoilTouched: 646 },
    { csa: 500, csaLabel: "500", dc20: 0.0605, ac: 0.0813, groundFlat: 663, groundTrefoil: 675, duct: 558, airFlatSeparated: 965, airFlatTouched: 787, airTrefoilTouched: 762 },
    { csa: 630, csaLabel: "630", dc20: 0.0469, ac: 0.0649, groundFlat: 754, groundTrefoil: 768, duct: 647, airFlatSeparated: 1131, airFlatTouched: 922, airTrefoilTouched: 892 },
    { csa: 800, csaLabel: "800", dc20: 0.0367, ac: 0.053, groundFlat: 850, groundTrefoil: 867, duct: 744, airFlatSeparated: 1329, airFlatTouched: 1077, airTrefoilTouched: 1042 },
    { csa: 1000, csaLabel: "1000", dc20: 0.0291, ac: 0.0446, groundFlat: 949, groundTrefoil: 968, duct: 847, airFlatSeparated: 1556, airFlatTouched: 1249, airTrefoilTouched: 1207 },
    ],
  },
  {
    id: "mc3_cu_xlpe",
    label: "0.6/1 kV 3-Core Cu/XLPE/PVC Unarmoured",
    voltage: "0.6/1 kV",
    cores: "multi3",
    conductor: "cu",
    insulation: "xlpe",
    page: 89,
    cols: ["ground", "duct", "air"],
    rows: [
    { csa: 1.5, csaLabel: "1.5", dc20: 12.1, ac: 14.6, ground: 31, duct: 25, air: 23 },
    { csa: 2.5, csaLabel: "2.5", dc20: 7.41, ac: 8.87, ground: 42, duct: 33, air: 34 },
    { csa: 4, csaLabel: "4", dc20: 4.61, ac: 5.54, ground: 54, duct: 39, air: 44 },
    { csa: 6, csaLabel: "6", dc20: 3.08, ac: 3.69, ground: 68, duct: 49, air: 53 },
    { csa: 10, csaLabel: "10", dc20: 1.83, ac: 2.19, ground: 89, duct: 65, air: 72 },
    { csa: 16, csaLabel: "16", dc20: 1.15, ac: 1.39, ground: 116, duct: 82, air: 95 },
    { csa: 25, csaLabel: "25", dc20: 0.727, ac: 0.9273, ground: 153, duct: 110, air: 126 },
    { csa: 35, csaLabel: "35", dc20: 0.524, ac: 0.6686, ground: 184, duct: 132, air: 156 },
    { csa: 50, csaLabel: "50", dc20: 0.387, ac: 0.494, ground: 220, duct: 157, air: 186 },
    { csa: 70, csaLabel: "70", dc20: 0.268, ac: 0.3425, ground: 270, duct: 195, air: 236 },
    { csa: 95, csaLabel: "95", dc20: 0.193, ac: 0.2471, ground: 324, duct: 236, air: 290 },
    { csa: 120, csaLabel: "120", dc20: 0.153, ac: 0.1964, ground: 368, duct: 272, air: 337 },
    { csa: 150, csaLabel: "150", dc20: 0.124, ac: 0.1597, ground: 410, duct: 307, air: 383 },
    { csa: 185, csaLabel: "185", dc20: 0.0991, ac: 0.1284, ground: 464, duct: 351, air: 441 },
    { csa: 240, csaLabel: "240", dc20: 0.0754, ac: 0.0988, ground: 537, duct: 414, air: 524 },
    { csa: 300, csaLabel: "300", dc20: 0.0601, ac: 0.0799, ground: 605, duct: 471, air: 602 },
    { csa: 400, csaLabel: "400", dc20: 0.047, ac: 0.0641, ground: 688, duct: 547, air: 701 },
    { csa: 500, csaLabel: "500", dc20: 0.0366, ac: 0.0518, ground: 776, duct: 625, air: 806 },
    ],
  },
  {
    id: "mc4_cu_xlpe",
    label: "0.6/1 kV 4-Core Cu/XLPE/PVC Unarmoured",
    voltage: "0.6/1 kV",
    cores: "multi4",
    conductor: "cu",
    insulation: "xlpe",
    page: 89,
    cols: ["ground", "duct", "air"],
    rows: [
    { csa: 1.5, csaLabel: "1.5", dc20: 12.1, ac: 14.6, ground: 32, duct: 26, air: 24 },
    { csa: 2.5, csaLabel: "2.5", dc20: 7.41, ac: 8.87, ground: 43, duct: 33, air: 35 },
    { csa: 4, csaLabel: "4", dc20: 4.61, ac: 5.54, ground: 55, duct: 40, air: 45 },
    { csa: 6, csaLabel: "6", dc20: 3.08, ac: 3.69, ground: 70, duct: 50, air: 55 },
    { csa: 10, csaLabel: "10", dc20: 1.83, ac: 2.19, ground: 92, duct: 67, air: 75 },
    { csa: 16, csaLabel: "16", dc20: 1.15, ac: 1.39, ground: 118, duct: 84, air: 98 },
    { csa: 25, csaLabel: "25", dc20: 0.727, ac: 0.9273, ground: 155, duct: 112, air: 131 },
    { csa: 35, csaLabel: "35", dc20: 0.524, ac: 0.6686, ground: 186, duct: 136, air: 161 },
    { csa: 50, csaLabel: "50", dc20: 0.387, ac: 0.494, ground: 225, duct: 162, air: 197 },
    { csa: 70, csaLabel: "70", dc20: 0.268, ac: 0.3425, ground: 276, duct: 204, air: 249 },
    { csa: 95, csaLabel: "95", dc20: 0.193, ac: 0.2471, ground: 330, duct: 243, air: 303 },
    { csa: 120, csaLabel: "120", dc20: 0.153, ac: 0.1964, ground: 374, duct: 282, air: 352 },
    { csa: 150, csaLabel: "150", dc20: 0.124, ac: 0.1597, ground: 421, duct: 321, air: 405 },
    { csa: 185, csaLabel: "185", dc20: 0.0991, ac: 0.1284, ground: 475, duct: 369, air: 467 },
    { csa: 240, csaLabel: "240", dc20: 0.0754, ac: 0.0988, ground: 551, duct: 431, air: 554 },
    { csa: 300, csaLabel: "300", dc20: 0.0601, ac: 0.0799, ground: 621, duct: 493, air: 636 },
    { csa: 400, csaLabel: "400", dc20: 0.047, ac: 0.0641, ground: 706, duct: 571, air: 741 },
    { csa: 500, csaLabel: "500", dc20: 0.0366, ac: 0.0518, ground: 797, duct: 653, air: 851 },
    ],
  },
  {
    id: "mc4_al_xlpe",
    label: "0.6/1 kV 4-Core AL/XLPE/PVC Unarmoured",
    voltage: "0.6/1 kV",
    cores: "multi4",
    conductor: "al",
    insulation: "xlpe",
    page: 91,
    cols: ["ground", "duct", "air"],
    rows: [
    { csa: 16, csaLabel: "16", dc20: 1.91, ac: 2.4489, ground: 93, duct: 66, air: 76 },
    { csa: 25, csaLabel: "25", dc20: 1.2, ac: 1.5387, ground: 120, duct: 87, air: 101 },
    { csa: 35, csaLabel: "35", dc20: 0.868, ac: 1.1131, ground: 144, duct: 105, air: 125 },
    { csa: 50, csaLabel: "50", dc20: 0.641, ac: 0.8221, ground: 175, duct: 126, air: 153 },
    { csa: 70, csaLabel: "70", dc20: 0.443, ac: 0.5684, ground: 215, duct: 158, air: 194 },
    { csa: 95, csaLabel: "95", dc20: 0.32, ac: 0.4109, ground: 256, duct: 189, air: 235 },
    { csa: 120, csaLabel: "120", dc20: 0.253, ac: 0.3252, ground: 291, duct: 219, air: 274 },
    { csa: 150, csaLabel: "150", dc20: 0.206, ac: 0.2651, ground: 327, duct: 249, air: 314 },
    { csa: 185, csaLabel: "185", dc20: 0.164, ac: 0.2115, ground: 370, duct: 287, air: 364 },
    { csa: 240, csaLabel: "240", dc20: 0.125, ac: 0.1619, ground: 430, duct: 337, air: 432 },
    { csa: 300, csaLabel: "300", dc20: 0.1, ac: 0.1302, ground: 486, duct: 386, air: 498 },
    { csa: 400, csaLabel: "400", dc20: 0.0778, ac: 0.1023, ground: 558, duct: 452, air: 586 },
    { csa: 500, csaLabel: "500", dc20: 0.0605, ac: 0.0809, ground: 638, duct: 522, air: 681 },
    ],
  },
  {
    id: "mv3_cu_xlpe_36",
    label: "3.6/6 (7.2) kV 3-Core Cu/XLPE/PVC",
    voltage: "3.6/6 (7.2) kV",
    cores: "mv3",
    conductor: "cu",
    insulation: "xlpe",
    page: 115,
    cols: ["ground", "duct", "air"],
    rows: [
    { csa: 25, csaLabel: "25", dc20: 0.727, ac: 0.9272, capUfKm: 0.252, indMhKm: 0.3746, ground: 167, duct: 123, air: 151 },
    { csa: 35, csaLabel: "35", dc20: 0.524, ac: 0.6684, capUfKm: 0.2832, indMhKm: 0.3555, ground: 197, duct: 146, air: 179 },
    { csa: 50, csaLabel: "50", dc20: 0.387, ac: 0.4938, capUfKm: 0.32, indMhKm: 0.3291, ground: 233, duct: 175, air: 217 },
    { csa: 70, csaLabel: "70", dc20: 0.268, ac: 0.3423, capUfKm: 0.3735, indMhKm: 0.31, ground: 286, duct: 216, air: 271 },
    { csa: 95, csaLabel: "95", dc20: 0.193, ac: 0.247, capUfKm: 0.4072, indMhKm: 0.3007, ground: 342, duct: 260, air: 331 },
    { csa: 120, csaLabel: "120", dc20: 0.153, ac: 0.1963, capUfKm: 0.4464, indMhKm: 0.2916, ground: 390, duct: 296, air: 383 },
    { csa: 150, csaLabel: "150", dc20: 0.124, ac: 0.1596, capUfKm: 0.4856, indMhKm: 0.284, ground: 438, duct: 337, air: 437 },
    { csa: 185, csaLabel: "185", dc20: 0.0991, ac: 0.1283, capUfKm: 0.5331, indMhKm: 0.2736, ground: 495, duct: 384, air: 503 },
    { csa: 240, csaLabel: "240", dc20: 0.0754, ac: 0.0989, capUfKm: 0.6001, indMhKm: 0.2649, ground: 574, duct: 450, air: 596 },
    { csa: 300, csaLabel: "300", dc20: 0.0601, ac: 0.0801, capUfKm: 0.6492, indMhKm: 0.2593, ground: 655, duct: 519, air: 703 },
    { csa: 400, csaLabel: "400", dc20: 0.047, ac: 0.0644, capUfKm: 0.6722, indMhKm: 0.2556, ground: 731, duct: 587, air: 792 },
    { csa: 500, csaLabel: "500", dc20: 0.0366, ac: 0.0523, capUfKm: 0.7107, indMhKm: 0.251, ground: 824, duct: 670, air: 914 },
    ],
  },
  {
    id: "mv3_al_xlpe_36",
    label: "3.6/6 (7.2) kV 3-Core AL/XLPE/PVC",
    voltage: "3.6/6 (7.2) kV",
    cores: "mv3",
    conductor: "al",
    insulation: "xlpe",
    page: 115,
    cols: ["ground", "duct", "air"],
    rows: [
    { csa: 25, csaLabel: "25", dc20: 1.2, ac: 1.5386, capUfKm: 0.252, indMhKm: 0.3746, ground: 129, duct: 96, air: 118 },
    { csa: 35, csaLabel: "35", dc20: 0.868, ac: 1.113, capUfKm: 0.2832, indMhKm: 0.3555, ground: 155, duct: 115, air: 143 },
    { csa: 50, csaLabel: "50", dc20: 0.641, ac: 0.822, capUfKm: 0.32, indMhKm: 0.3291, ground: 184, duct: 137, air: 173 },
    { csa: 70, csaLabel: "70", dc20: 0.443, ac: 0.5683, capUfKm: 0.3651, indMhKm: 0.3127, ground: 225, duct: 170, air: 217 },
    { csa: 95, csaLabel: "95", dc20: 0.32, ac: 0.4108, capUfKm: 0.4072, indMhKm: 0.3007, ground: 269, duct: 204, air: 264 },
    { csa: 120, csaLabel: "120", dc20: 0.253, ac: 0.3251, capUfKm: 0.4464, indMhKm: 0.2916, ground: 307, duct: 235, air: 306 },
    { csa: 150, csaLabel: "150", dc20: 0.206, ac: 0.265, capUfKm: 0.4856, indMhKm: 0.284, ground: 344, duct: 265, air: 348 },
    { csa: 185, csaLabel: "185", dc20: 0.164, ac: 0.2115, capUfKm: 0.5331, indMhKm: 0.2736, ground: 391, duct: 303, air: 402 },
    { csa: 240, csaLabel: "240", dc20: 0.125, ac: 0.1619, capUfKm: 0.5973, indMhKm: 0.2652, ground: 449, duct: 352, air: 466 },
    { csa: 300, csaLabel: "300", dc20: 0.1, ac: 0.1304, capUfKm: 0.6412, indMhKm: 0.2596, ground: 508, duct: 403, air: 539 },
    { csa: 400, csaLabel: "400", dc20: 0.0778, ac: 0.1026, capUfKm: 0.6672, indMhKm: 0.2543, ground: 582, duct: 467, air: 631 },
    { csa: 500, csaLabel: "500", dc20: 0.0605, ac: 0.0812, capUfKm: 0.7084, indMhKm: 0.2523, ground: 673, duct: 547, air: 753 },
    ],
  },
  {
    id: "mv3_cu_xlpe_610",
    label: "6/10 (12) kV 3-Core Cu/XLPE/PVC",
    voltage: "6/10 (12) kV",
    cores: "mv3",
    conductor: "cu",
    insulation: "xlpe",
    page: 123,
    cols: ["ground", "duct", "air"],
    rows: [
    { csa: 25, csaLabel: "25", dc20: 0.727, ac: 0.9271, capUfKm: 0.2094, indMhKm: 0.3952, ground: 167, duct: 125, air: 154 },
    { csa: 35, csaLabel: "35", dc20: 0.524, ac: 0.6684, capUfKm: 0.2341, indMhKm: 0.3746, ground: 197, duct: 148, air: 182 },
    { csa: 50, csaLabel: "50", dc20: 0.387, ac: 0.4938, capUfKm: 0.263, indMhKm: 0.3466, ground: 233, duct: 177, air: 220 },
    { csa: 70, csaLabel: "70", dc20: 0.268, ac: 0.3423, capUfKm: 0.3051, indMhKm: 0.3257, ground: 286, duct: 219, air: 275 },
    { csa: 95, csaLabel: "95", dc20: 0.193, ac: 0.2469, capUfKm: 0.3315, indMhKm: 0.3154, ground: 343, duct: 263, air: 336 },
    { csa: 120, csaLabel: "120", dc20: 0.153, ac: 0.1962, capUfKm: 0.3623, indMhKm: 0.3053, ground: 390, duct: 302, air: 388 },
    { csa: 150, csaLabel: "150", dc20: 0.124, ac: 0.1595, capUfKm: 0.3931, indMhKm: 0.2968, ground: 438, duct: 341, air: 442 },
    { csa: 185, csaLabel: "185", dc20: 0.0991, ac: 0.1282, capUfKm: 0.4303, indMhKm: 0.2856, ground: 496, duct: 388, air: 508 },
    { csa: 240, csaLabel: "240", dc20: 0.0754, ac: 0.0987, capUfKm: 0.4828, indMhKm: 0.2757, ground: 575, duct: 454, air: 601 },
    { csa: 300, csaLabel: "300", dc20: 0.0601, ac: 0.0799, capUfKm: 0.5396, indMhKm: 0.2678, ground: 655, duct: 523, air: 706 },
    { csa: 400, csaLabel: "400", dc20: 0.047, ac: 0.0642, capUfKm: 0.5963, indMhKm: 0.2607, ground: 732, duct: 590, air: 794 },
    { csa: 500, csaLabel: "500", dc20: 0.0366, ac: 0.0522, capUfKm: 0.6703, indMhKm: 0.2533, ground: 825, duct: 672, air: 916 },
    ],
  },
  {
    id: "mv3_al_xlpe_610",
    label: "6/10 (12) kV 3-Core AL/XLPE/PVC",
    voltage: "6/10 (12) kV",
    cores: "mv3",
    conductor: "al",
    insulation: "xlpe",
    page: 123,
    cols: ["ground", "duct", "air"],
    rows: [
    { csa: 25, csaLabel: "25", dc20: 1.2, ac: 1.5386, capUfKm: 0.2094, indMhKm: 0.3952, ground: 129, duct: 97, air: 120 },
    { csa: 35, csaLabel: "35", dc20: 0.868, ac: 1.113, capUfKm: 0.2341, indMhKm: 0.3746, ground: 152, duct: 115, air: 141 },
    { csa: 50, csaLabel: "50", dc20: 0.641, ac: 0.822, capUfKm: 0.263, indMhKm: 0.3466, ground: 181, duct: 137, air: 171 },
    { csa: 70, csaLabel: "70", dc20: 0.443, ac: 0.5683, capUfKm: 0.2985, indMhKm: 0.3286, ground: 222, duct: 170, air: 214 },
    { csa: 95, csaLabel: "95", dc20: 0.32, ac: 0.4108, capUfKm: 0.3315, indMhKm: 0.3154, ground: 266, duct: 204, air: 260 },
    { csa: 120, csaLabel: "120", dc20: 0.253, ac: 0.325, capUfKm: 0.3623, indMhKm: 0.3053, ground: 303, duct: 234, air: 301 },
    { csa: 150, csaLabel: "150", dc20: 0.206, ac: 0.265, capUfKm: 0.3931, indMhKm: 0.2968, ground: 340, duct: 265, air: 343 },
    { csa: 185, csaLabel: "185", dc20: 0.164, ac: 0.2114, capUfKm: 0.4303, indMhKm: 0.2856, ground: 386, duct: 303, air: 396 },
    { csa: 240, csaLabel: "240", dc20: 0.125, ac: 0.1618, capUfKm: 0.4806, indMhKm: 0.2761, ground: 449, duct: 355, air: 470 },
    { csa: 300, csaLabel: "300", dc20: 0.1, ac: 0.1302, capUfKm: 0.533, indMhKm: 0.2681, ground: 509, duct: 406, air: 542 },
    { csa: 400, csaLabel: "400", dc20: 0.0778, ac: 0.1025, capUfKm: 0.5919, indMhKm: 0.2594, ground: 582, duct: 469, air: 633 },
    { csa: 500, csaLabel: "500", dc20: 0.0605, ac: 0.0811, capUfKm: 0.6682, indMhKm: 0.2546, ground: 673, duct: 548, air: 754 },
    ],
  },
  {
    id: "mv3_cu_xlpe_87",
    label: "8.7/15 (17.5) kV 3-Core Cu/XLPE/PVC",
    voltage: "8.7/15 (17.5) kV",
    cores: "mv3",
    conductor: "cu",
    insulation: "xlpe",
    page: 124,
    cols: ["ground", "duct", "air"],
    rows: [
    { csa: 25, csaLabel: "25", dc20: 0.727, ac: 0.9271, capUfKm: 0.1699, indMhKm: 0.4238, ground: 167, duct: 128, air: 158 },
    { csa: 35, csaLabel: "35", dc20: 0.524, ac: 0.6684, capUfKm: 0.1886, indMhKm: 0.4014, ground: 197, duct: 152, air: 187 },
    { csa: 50, csaLabel: "50", dc20: 0.387, ac: 0.4938, capUfKm: 0.2104, indMhKm: 0.3715, ground: 234, duct: 181, air: 225 },
    { csa: 70, csaLabel: "70", dc20: 0.268, ac: 0.3422, capUfKm: 0.2421, indMhKm: 0.3482, ground: 286, duct: 223, air: 281 },
    { csa: 95, csaLabel: "95", dc20: 0.193, ac: 0.2468, capUfKm: 0.262, indMhKm: 0.3366, ground: 343, duct: 268, air: 341 },
    { csa: 120, csaLabel: "120", dc20: 0.153, ac: 0.196, capUfKm: 0.2851, indMhKm: 0.3252, ground: 390, duct: 307, air: 394 },
    { csa: 150, csaLabel: "150", dc20: 0.124, ac: 0.1594, capUfKm: 0.3081, indMhKm: 0.3156, ground: 438, duct: 346, air: 448 },
    { csa: 185, csaLabel: "185", dc20: 0.0991, ac: 0.128, capUfKm: 0.336, indMhKm: 0.303, ground: 496, duct: 394, air: 514 },
    { csa: 240, csaLabel: "240", dc20: 0.0754, ac: 0.0984, capUfKm: 0.3752, indMhKm: 0.2917, ground: 575, duct: 461, air: 608 },
    { csa: 300, csaLabel: "300", dc20: 0.0601, ac: 0.0796, capUfKm: 0.4177, indMhKm: 0.2824, ground: 657, duct: 530, air: 712 },
    { csa: 400, csaLabel: "400", dc20: 0.047, ac: 0.0638, capUfKm: 0.46, indMhKm: 0.2742, ground: 734, duct: 598, air: 802 },
    { csa: 500, csaLabel: "500", dc20: 0.0366, ac: 0.0518, capUfKm: 0.5153, indMhKm: 0.2655, ground: 829, duct: 682, air: 924 },
    ],
  },
  {
    id: "mv3_al_xlpe_87",
    label: "8.7/15 (17.5) kV 3-Core AL/XLPE/PVC",
    voltage: "8.7/15 (17.5) kV",
    cores: "mv3",
    conductor: "al",
    insulation: "xlpe",
    page: 124,
    cols: ["ground", "duct", "air"],
    rows: [
    { csa: 25, csaLabel: "25", dc20: 1.2, ac: 1.5386, capUfKm: 0.1699, indMhKm: 0.4238, ground: 129, duct: 99, air: 122 },
    { csa: 35, csaLabel: "35", dc20: 0.868, ac: 1.113, capUfKm: 0.1886, indMhKm: 0.4014, ground: 153, duct: 118, air: 145 },
    { csa: 50, csaLabel: "50", dc20: 0.641, ac: 0.822, capUfKm: 0.2104, indMhKm: 0.3715, ground: 181, duct: 140, air: 174 },
    { csa: 70, csaLabel: "70", dc20: 0.443, ac: 0.5683, capUfKm: 0.2371, indMhKm: 0.3514, ground: 222, duct: 173, air: 218 },
    { csa: 95, csaLabel: "95", dc20: 0.32, ac: 0.4107, capUfKm: 0.262, indMhKm: 0.3366, ground: 266, duct: 208, air: 265 },
    { csa: 120, csaLabel: "120", dc20: 0.253, ac: 0.3249, capUfKm: 0.2851, indMhKm: 0.3252, ground: 303, duct: 238, air: 306 },
    { csa: 150, csaLabel: "150", dc20: 0.206, ac: 0.2649, capUfKm: 0.3081, indMhKm: 0.3156, ground: 340, duct: 269, air: 348 },
    { csa: 185, csaLabel: "185", dc20: 0.164, ac: 0.2113, capUfKm: 0.336, indMhKm: 0.303, ground: 386, duct: 307, air: 401 },
    { csa: 240, csaLabel: "240", dc20: 0.125, ac: 0.1617, capUfKm: 0.3736, indMhKm: 0.2921, ground: 449, duct: 360, air: 474 },
    { csa: 300, csaLabel: "300", dc20: 0.1, ac: 0.13, capUfKm: 0.4128, indMhKm: 0.2829, ground: 509, duct: 411, air: 547 },
    { csa: 400, csaLabel: "400", dc20: 0.0778, ac: 0.1022, capUfKm: 0.4568, indMhKm: 0.273, ground: 583, duct: 475, air: 637 },
    { csa: 500, csaLabel: "500", dc20: 0.0605, ac: 0.0808, capUfKm: 0.5137, indMhKm: 0.2668, ground: 673, duct: 554, air: 757 },
    ],
  },
  {
    id: "mv1_cu_xlpe_87",
    label: "8.7/15 (17.5) kV Single Core Cu/XLPE/PVC (shielded)",
    voltage: "8.7/15 (17.5) kV",
    cores: "mv1",
    conductor: "cu",
    insulation: "xlpe",
    page: 124,
    cols: ["groundFlat", "groundTrefoil", "duct", "airFlatTouched", "airTrefoilTouched"],
    rows: [
    { csa: 35, csaLabel: "35", dc20: 0.524, ac: 0.6683, capUfKm: 0.1886, indMhKm: 0.4245, groundFlat: 201, groundTrefoil: 207, duct: 152, airFlatTouched: 189, airTrefoilTouched: 193 },
    { csa: 50, csaLabel: "50", dc20: 0.387, ac: 0.4937, capUfKm: 0.2104, indMhKm: 0.3932, groundFlat: 238, groundTrefoil: 245, duct: 183, airFlatTouched: 227, airTrefoilTouched: 234 },
    { csa: 70, csaLabel: "70", dc20: 0.268, ac: 0.3422, capUfKm: 0.2421, indMhKm: 0.3696, groundFlat: 292, groundTrefoil: 295, duct: 227, airFlatTouched: 287, airTrefoilTouched: 295 },
    { csa: 95, csaLabel: "95", dc20: 0.193, ac: 0.2467, capUfKm: 0.262, indMhKm: 0.3568, groundFlat: 347, groundTrefoil: 351, duct: 272, airFlatTouched: 347, airTrefoilTouched: 356 },
    { csa: 120, csaLabel: "120", dc20: 0.153, ac: 0.1959, capUfKm: 0.2851, indMhKm: 0.3456, groundFlat: 395, groundTrefoil: 398, duct: 314, airFlatTouched: 403, airTrefoilTouched: 412 },
    { csa: 150, csaLabel: "150", dc20: 0.124, ac: 0.1592, capUfKm: 0.3081, indMhKm: 0.3348, groundFlat: 443, groundTrefoil: 445, duct: 355, airFlatTouched: 458, airTrefoilTouched: 466 },
    { csa: 185, csaLabel: "185", dc20: 0.0991, ac: 0.1278, capUfKm: 0.336, indMhKm: 0.3223, groundFlat: 501, groundTrefoil: 502, duct: 412, airFlatTouched: 527, airTrefoilTouched: 536 },
    { csa: 240, csaLabel: "240", dc20: 0.0754, ac: 0.0981, capUfKm: 0.3752, indMhKm: 0.3104, groundFlat: 580, groundTrefoil: 578, duct: 478, airFlatTouched: 626, airTrefoilTouched: 634 },
    { csa: 300, csaLabel: "300", dc20: 0.0601, ac: 0.0792, capUfKm: 0.4177, indMhKm: 0.2994, groundFlat: 658, groundTrefoil: 648, duct: 547, airFlatTouched: 723, airTrefoilTouched: 731 },
    { csa: 400, csaLabel: "400", dc20: 0.047, ac: 0.0633, capUfKm: 0.46, indMhKm: 0.2908, groundFlat: 746, groundTrefoil: 726, duct: 623, airFlatTouched: 830, airTrefoilTouched: 841 },
    { csa: 500, csaLabel: "500", dc20: 0.0366, ac: 0.0511, capUfKm: 0.5153, indMhKm: 0.2814, groundFlat: 840, groundTrefoil: 817, duct: 711, airFlatTouched: 962, airTrefoilTouched: 968 },
    { csa: 630, csaLabel: "630", dc20: 0.0283, ac: 0.0417, capUfKm: 0.5713, indMhKm: 0.2739, groundFlat: 940, groundTrefoil: 906, duct: 806, airFlatTouched: 1102, airTrefoilTouched: 1098 },
    { csa: 800, csaLabel: "800", dc20: 0.0221, ac: 0.0351, capUfKm: 0.6419, indMhKm: 0.2672, groundFlat: 1035, groundTrefoil: 988, duct: 903, airFlatTouched: 1248, airTrefoilTouched: 1234 },
    ],
  },
  {
    id: "mv1_al_xlpe_87",
    label: "8.7/15 (17.5) kV Single Core AL/XLPE/PVC (shielded)",
    voltage: "8.7/15 (17.5) kV",
    cores: "mv1",
    conductor: "al",
    insulation: "xlpe",
    page: 124,
    cols: ["groundFlat", "groundTrefoil", "duct", "airFlatTouched", "airTrefoilTouched"],
    rows: [
    { csa: 35, csaLabel: "35", dc20: 0.868, ac: 1.113, capUfKm: 0.1886, indMhKm: 0.4245, groundFlat: 158, groundTrefoil: 160, duct: 123, airFlatTouched: 145, airTrefoilTouched: 153 },
    { csa: 50, csaLabel: "50", dc20: 0.641, ac: 0.822, capUfKm: 0.2104, indMhKm: 0.3932, groundFlat: 188, groundTrefoil: 189, duct: 146, airFlatTouched: 179, airTrefoilTouched: 184 },
    { csa: 70, csaLabel: "70", dc20: 0.443, ac: 0.5682, capUfKm: 0.2371, indMhKm: 0.3732, groundFlat: 228, groundTrefoil: 229, duct: 181, airFlatTouched: 225, airTrefoilTouched: 231 },
    { csa: 95, csaLabel: "95", dc20: 0.32, ac: 0.4106, capUfKm: 0.262, indMhKm: 0.3568, groundFlat: 275, groundTrefoil: 278, duct: 216, airFlatTouched: 273, airTrefoilTouched: 280 },
    { csa: 120, csaLabel: "120", dc20: 0.253, ac: 0.3249, capUfKm: 0.2851, indMhKm: 0.3456, groundFlat: 312, groundTrefoil: 320, duct: 249, airFlatTouched: 316, airTrefoilTouched: 324 },
    { csa: 150, csaLabel: "150", dc20: 0.206, ac: 0.2648, capUfKm: 0.3081, indMhKm: 0.3348, groundFlat: 350, groundTrefoil: 354, duct: 280, airFlatTouched: 359, airTrefoilTouched: 369 },
    { csa: 185, csaLabel: "185", dc20: 0.164, ac: 0.2111, capUfKm: 0.336, indMhKm: 0.3223, groundFlat: 396, groundTrefoil: 398, duct: 319, airFlatTouched: 414, airTrefoilTouched: 426 },
    { csa: 240, csaLabel: "240", dc20: 0.125, ac: 0.1615, capUfKm: 0.3736, indMhKm: 0.3109, groundFlat: 460, groundTrefoil: 459, duct: 377, airFlatTouched: 491, airTrefoilTouched: 505 },
    { csa: 300, csaLabel: "300", dc20: 0.1, ac: 0.1298, capUfKm: 0.4128, indMhKm: 0.3001, groundFlat: 517, groundTrefoil: 515, duct: 429, airFlatTouched: 566, airTrefoilTouched: 580 },
    { csa: 400, csaLabel: "400", dc20: 0.0778, ac: 0.1019, capUfKm: 0.4568, indMhKm: 0.2898, groundFlat: 591, groundTrefoil: 584, duct: 497, airFlatTouched: 661, airTrefoilTouched: 675 },
    { csa: 500, csaLabel: "500", dc20: 0.0605, ac: 0.0804, capUfKm: 0.5137, indMhKm: 0.2826, groundFlat: 675, groundTrefoil: 667, duct: 575, airFlatTouched: 773, airTrefoilTouched: 790 },
    { csa: 630, csaLabel: "630", dc20: 0.0469, ac: 0.0639, capUfKm: 0.5705, indMhKm: 0.2746, groundFlat: 768, groundTrefoil: 778, duct: 660, airFlatTouched: 901, airTrefoilTouched: 912 },
    { csa: 800, csaLabel: "800", dc20: 0.0367, ac: 0.0519, capUfKm: 0.6484, indMhKm: 0.2665, groundFlat: 863, groundTrefoil: 890, duct: 760, airFlatTouched: 1042, airTrefoilTouched: 1042 },
    ],
  },
];

// ─── Short-circuit withstand (kA), Tables 14-17, pp.20-22 ────────────────────

export const SC_DURATIONS = [0.1, 0.2, 0.3, 0.4, 0.5, 1, 2, 3, 4, 5] as const;

export const SHORT_CIRCUIT_TABLES: Record<string, Record<number, number[]>> = {
  cu_pvc: {
    1.5: [0.5, 0.4, 0.3, 0.3, 0.2, 0.2, 0.1, 0.1, 0.1, 0.1],
    2.5: [0.9, 0.6, 0.5, 0.5, 0.4, 0.3, 0.2, 0.2, 0.1, 0.1],
    4: [1.5, 1.0, 0.8, 0.7, 0.7, 0.5, 0.3, 0.3, 0.2, 0.2],
    6: [2.2, 1.5, 1.3, 1.1, 1.0, 0.7, 0.5, 0.4, 0.3, 0.3],
    10: [3.6, 2.6, 2.1, 1.8, 1.6, 1.2, 0.8, 0.7, 0.6, 0.5],
    16: [5.8, 4.1, 3.4, 2.9, 2.6, 1.8, 1.3, 1.1, 0.9, 0.8],
    25: [9.1, 6.4, 5.2, 4.5, 4.1, 2.9, 2.0, 1.7, 1.4, 1.3],
    35: [12.7, 9.0, 7.3, 6.4, 5.7, 4.0, 2.8, 2.3, 2.0, 1.8],
    50: [18.2, 12.9, 10.5, 9.1, 8.1, 5.8, 4.1, 3.3, 2.9, 2.6],
    70: [25.5, 18.0, 14.7, 12.7, 11.4, 8.1, 5.7, 4.6, 4.0, 3.6],
    95: [34.5, 24.4, 19.9, 17.3, 15.5, 10.9, 7.7, 6.3, 5.5, 4.9],
    120: [43.6, 30.9, 25.2, 21.8, 19.5, 13.8, 9.8, 8.0, 6.9, 6.2],
    150: [54.6, 38.6, 31.5, 27.3, 24.4, 17.3, 12.2, 10.0, 8.6, 7.7],
    185: [67.3, 47.6, 38.8, 33.6, 30.1, 21.3, 15.0, 12.3, 10.6, 9.5],
    240: [87.3, 61.7, 50.4, 43.6, 39.0, 27.6, 19.5, 15.9, 13.8, 12.3],
    300: [109.1, 77.1, 63.0, 54.6, 48.8, 34.5, 24.4, 19.9, 17.3, 15.4],
    400: [130.0, 92.0, 75.1, 65.0, 58.2, 41.1, 29.1, 23.7, 20.6, 18.4],
    500: [162.5, 114.9, 93.8, 81.3, 72.7, 51.4, 36.3, 29.7, 25.7, 23.0],
    630: [204.8, 144.8, 118.2, 102.4, 91.6, 64.8, 45.8, 37.4, 32.4, 29.0],
    800: [260.1, 183.9, 150.2, 130.0, 116.3, 82.2, 58.2, 47.5, 41.1, 36.8],
  },
  cu_xlpe: {
    1.5: [0.7, 0.5, 0.4, 0.3, 0.3, 0.2, 0.2, 0.1, 0.1, 0.1],
    2.5: [1.1, 0.8, 0.7, 0.6, 0.5, 0.4, 0.3, 0.2, 0.2, 0.2],
    4: [1.8, 1.3, 1.0, 0.9, 0.8, 0.6, 0.4, 0.3, 0.3, 0.3],
    6: [2.7, 1.9, 1.6, 1.4, 1.2, 0.9, 0.6, 0.5, 0.4, 0.4],
    10: [4.5, 3.2, 2.6, 2.3, 2.0, 1.4, 1.0, 0.8, 0.7, 0.6],
    16: [7.2, 5.1, 4.2, 3.6, 3.2, 2.3, 1.6, 1.3, 1.1, 1.0],
    25: [11.3, 8.0, 6.5, 5.7, 5.1, 3.6, 2.5, 2.1, 1.8, 1.6],
    35: [15.8, 11.2, 9.1, 7.9, 7.1, 5.0, 3.5, 2.9, 2.5, 2.2],
    50: [22.6, 16.0, 13.1, 11.3, 10.1, 7.2, 5.1, 4.1, 3.6, 3.2],
    70: [31.7, 22.4, 18.3, 15.8, 14.2, 10.0, 7.1, 5.8, 5.0, 4.5],
    95: [43.0, 30.4, 24.8, 21.5, 19.2, 13.6, 9.6, 7.8, 6.8, 6.1],
    120: [54.3, 38.4, 31.3, 27.1, 24.3, 17.2, 12.1, 9.9, 8.6, 7.7],
    150: [67.9, 48.0, 39.2, 33.9, 30.4, 21.5, 15.2, 12.4, 10.7, 9.6],
    185: [83.7, 59.2, 48.3, 41.9, 37.4, 26.5, 18.7, 15.3, 13.2, 11.8],
    240: [108.6, 76.8, 62.7, 54.3, 48.6, 34.3, 24.3, 19.8, 17.2, 15.4],
    300: [135.7, 96.0, 78.4, 67.9, 60.7, 42.9, 30.4, 24.8, 21.5, 19.2],
    400: [181.0, 128.0, 104.5, 90.5, 80.9, 57.2, 40.5, 33.0, 28.6, 25.6],
    500: [226.2, 160.0, 130.6, 113.1, 101.2, 71.5, 50.6, 41.3, 35.8, 32.0],
    630: [285.1, 201.6, 164.6, 142.5, 127.5, 90.1, 63.7, 52.0, 45.1, 40.3],
    800: [362.0, 256.0, 209.0, 181.0, 161.9, 114.5, 80.9, 66.1, 57.2, 51.2],
  },
  al_pvc: {
    1.5: [0.4, 0.3, 0.2, 0.2, 0.2, 0.1, 0.1, 0.1, 0.1, 0.1],
    2.5: [0.6, 0.4, 0.3, 0.3, 0.3, 0.2, 0.1, 0.1, 0.1, 0.1],
    4: [1.0, 0.7, 0.6, 0.5, 0.4, 0.3, 0.2, 0.2, 0.2, 0.1],
    6: [1.4, 1.0, 0.8, 0.7, 0.6, 0.5, 0.3, 0.3, 0.2, 0.2],
    10: [2.4, 1.7, 1.4, 1.2, 1.1, 0.8, 0.5, 0.4, 0.4, 0.3],
    16: [3.8, 2.7, 2.2, 1.9, 1.7, 1.2, 0.9, 0.7, 0.6, 0.5],
    25: [6.0, 4.3, 3.5, 3.0, 2.7, 1.9, 1.3, 1.1, 1.0, 0.9],
    35: [8.4, 6.0, 4.9, 4.2, 3.8, 2.7, 1.9, 1.5, 1.3, 1.2],
    50: [12.0, 8.5, 6.9, 6.0, 5.4, 3.8, 2.7, 2.2, 1.9, 1.7],
    70: [16.8, 11.9, 9.7, 8.4, 7.5, 5.3, 3.8, 3.1, 2.7, 2.4],
    95: [22.8, 16.2, 13.2, 11.4, 10.2, 7.2, 5.1, 4.2, 3.6, 3.2],
    120: [28.9, 20.4, 16.7, 14.4, 12.9, 9.1, 6.5, 5.3, 4.6, 4.1],
    150: [36.1, 25.5, 20.8, 18.0, 16.1, 11.4, 8.1, 6.6, 5.7, 5.1],
    185: [44.5, 31.5, 25.7, 22.2, 19.9, 14.1, 9.9, 8.1, 7.0, 6.3],
    240: [57.7, 40.8, 33.3, 28.9, 25.8, 18.2, 12.9, 10.5, 9.1, 8.2],
    300: [72.1, 51.0, 41.6, 36.1, 32.3, 22.8, 16.1, 13.2, 11.4, 10.2],
    400: [86.0, 60.2, 49.6, 43.0, 38.5, 27.2, 19.2, 15.7, 13.6, 12.2],
    500: [107.5, 76.0, 62.1, 53.7, 48.1, 34.0, 24.0, 19.6, 17.0, 15.2],
    630: [135.4, 95.8, 78.2, 67.7, 60.6, 42.8, 30.3, 24.7, 21.4, 19.2],
    800: [172.0, 121.6, 99.3, 86.0, 76.9, 54.4, 38.5, 31.4, 27.2, 24.3],
  },
  al_xlpe: {
    1.5: [0.4, 0.3, 0.3, 0.2, 0.2, 0.1, 0.1, 0.1, 0.1, 0.1],
    2.5: [0.7, 0.5, 0.4, 0.4, 0.3, 0.2, 0.2, 0.1, 0.1, 0.1],
    4: [1.2, 0.8, 0.7, 0.6, 0.5, 0.4, 0.3, 0.2, 0.2, 0.2],
    6: [1.8, 1.3, 1.0, 0.9, 0.8, 0.6, 0.4, 0.3, 0.3, 0.3],
    10: [3.0, 2.1, 1.7, 1.5, 1.3, 0.9, 0.7, 0.5, 0.5, 0.4],
    16: [4.8, 3.4, 2.8, 2.4, 2.1, 1.5, 1.1, 0.9, 0.8, 0.7],
    25: [7.5, 5.3, 4.3, 3.7, 3.3, 2.4, 1.7, 1.4, 1.2, 1.1],
    35: [10.5, 7.4, 6.0, 5.2, 4.7, 3.3, 2.3, 1.9, 1.7, 1.5],
    50: [14.9, 10.6, 8.6, 7.5, 6.7, 4.7, 3.3, 2.7, 2.4, 2.1],
    70: [20.9, 14.8, 12.1, 10.5, 9.4, 6.6, 4.7, 3.8, 3.3, 3.0],
    95: [28.4, 20.1, 16.4, 14.2, 12.7, 9.0, 6.3, 5.2, 4.5, 4.0],
    120: [35.9, 25.4, 20.7, 17.9, 16.0, 11.3, 8.0, 6.5, 5.7, 5.1],
    150: [44.8, 31.7, 25.9, 22.4, 20.0, 14.2, 10.0, 8.2, 7.1, 6.3],
    185: [55.3, 39.1, 31.9, 27.6, 24.7, 17.5, 12.4, 10.1, 8.7, 7.8],
    240: [71.7, 50.7, 41.4, 35.9, 32.1, 22.7, 16.0, 13.1, 11.3, 10.1],
    300: [89.6, 63.4, 51.8, 44.8, 40.1, 28.3, 20.0, 16.4, 14.2, 12.7],
    400: [119.5, 84.5, 69.0, 59.8, 53.4, 37.8, 26.7, 21.8, 18.9, 16.9],
    500: [149.4, 105.6, 86.3, 74.7, 66.8, 47.2, 33.4, 27.3, 23.6, 21.1],
    630: [188.2, 133.1, 108.7, 94.1, 84.2, 59.5, 42.1, 34.4, 29.8, 26.6],
    800: [239.0, 169.0, 138.0, 119.5, 106.9, 75.6, 53.4, 43.6, 37.8, 33.8],
  },
};

// ─── Voltage drop (mV/A/m), Tables 18-19, pp.23-24 ───────────────────────────
// Basis: max operating temp 90°C XLPE / 70°C PVC, pf 0.8, 50 Hz, cables touched
// in flat formation. Single-core table = three-phase circuit (3 single cores).
// Structure: VOLTAGE_DROP_SINGLE_CORE[cu|al][csa] = {flat, trefoil, xlpeFlat, xlpeTrefoil}
//            VOLTAGE_DROP_MULTICORE[cu|al][csa] = {pvc, xlpe}
export const VOLTAGE_DROP_SINGLE_CORE = {
  cu: {
      4: { flat: 7.83, trefoil: 7.77, xlpeFlat: 8.337, xlpeTrefoil: 8.277 },
      6: { flat: 5.287, trefoil: 5.226, xlpeFlat: 5.628, xlpeTrefoil: 5.568 },
      10: { flat: 3.184, trefoil: 3.124, xlpeFlat: 3.401, xlpeTrefoil: 3.341 },
      16: { flat: 2.068, trefoil: 2.008, xlpeFlat: 2.203, xlpeTrefoil: 2.142 },
      25: { flat: 1.357, trefoil: 1.297, xlpeFlat: 1.44, xlpeTrefoil: 1.38 },
      35: { flat: 1.034, trefoil: 0.971, xlpeFlat: 1.085, xlpeTrefoil: 1.024 },
      50: { flat: 0.793, trefoil: 0.732, xlpeFlat: 0.836, xlpeTrefoil: 0.776 },
      70: { flat: 0.595, trefoil: 0.534, xlpeFlat: 0.624, xlpeTrefoil: 0.564 },
      95: { flat: 0.469, trefoil: 0.408, xlpeFlat: 0.49, xlpeTrefoil: 0.43 },
      120: { flat: 0.41, trefoil: 0.349, xlpeFlat: 0.417, xlpeTrefoil: 0.357 },
      150: { flat: 0.354, trefoil: 0.294, xlpeFlat: 0.366, xlpeTrefoil: 0.305 },
      185: { flat: 0.312, trefoil: 0.252, xlpeFlat: 0.322, xlpeTrefoil: 0.262 },
      240: { flat: 0.272, trefoil: 0.211, xlpeFlat: 0.278, xlpeTrefoil: 0.218 },
      300: { flat: 0.247, trefoil: 0.187, xlpeFlat: 0.253, xlpeTrefoil: 0.192 },
      400: { flat: 0.224, trefoil: 0.164, xlpeFlat: 0.22, xlpeTrefoil: 0.159 },
      500: { flat: 0.208, trefoil: 0.148, xlpeFlat: 0.211, xlpeTrefoil: 0.15 },
      630: { flat: 0.194, trefoil: 0.134, xlpeFlat: 0.191, xlpeTrefoil: 0.131 },
  },
  al: {
      16: { flat: 3.343, trefoil: 3.283, xlpeFlat: 3.561, xlpeTrefoil: 3.5 },
      25: { flat: 2.161, trefoil: 2.1, xlpeFlat: 2.296, xlpeTrefoil: 2.235 },
      35: { flat: 1.602, trefoil: 1.542, xlpeFlat: 1.7, xlpeTrefoil: 1.64 },
      50: { flat: 1.222, trefoil: 1.162, xlpeFlat: 1.291, xlpeTrefoil: 1.23 },
      70: { flat: 0.89, trefoil: 0.83, xlpeFlat: 0.937, xlpeTrefoil: 0.877 },
      95: { flat: 0.686, trefoil: 0.623, xlpeFlat: 0.719, xlpeTrefoil: 0.655 },
      120: { flat: 0.569, trefoil: 0.509, xlpeFlat: 0.594, xlpeTrefoil: 0.534 },
      150: { flat: 0.49, trefoil: 0.43, xlpeFlat: 0.511, xlpeTrefoil: 0.451 },
      185: { flat: 0.42, trefoil: 0.36, xlpeFlat: 0.437, xlpeTrefoil: 0.377 },
      240: { flat: 0.353, trefoil: 0.293, xlpeFlat: 0.367, xlpeTrefoil: 0.307 },
      300: { flat: 0.312, trefoil: 0.252, xlpeFlat: 0.322, xlpeTrefoil: 0.262 },
      400: { flat: 0.274, trefoil: 0.214, xlpeFlat: 0.278, xlpeTrefoil: 0.218 },
      500: { flat: 0.245, trefoil: 0.185, xlpeFlat: 0.26, xlpeTrefoil: 0.199 },
      630: { flat: 0.222, trefoil: 0.162, xlpeFlat: 0.223, xlpeTrefoil: 0.163 },
  },
};

export const VOLTAGE_DROP_MULTICORE = {
  cu: {
      1.5: { pvc: 20.345, xlpe: 20.341 },
      2.5: { pvc: 12.397, xlpe: 13.197 },
      4: { pvc: 7.741, xlpe: 7.731 },
      6: { pvc: 5.199, xlpe: 5.191 },
      10: { pvc: 3.101, xlpe: 3.094 },
      16: { pvc: 1.275, xlpe: 1.282 },
      25: { pvc: 0.957, xlpe: 1.009 },
      35: { pvc: 0.726, xlpe: 0.764 },
      50: { pvc: 0.526, xlpe: 0.552 },
      70: { pvc: 0.402, xlpe: 0.418 },
      95: { pvc: 0.334, xlpe: 0.347 },
      120: { pvc: 0.287, xlpe: 0.297 },
      150: { pvc: 0.246, xlpe: 0.254 },
      185: { pvc: 0.207, xlpe: 0.212 },
      240: { pvc: 0.182, xlpe: 0.185 },
      300: { pvc: 0.16, xlpe: 0.163 },
      400: { pvc: 0.144, xlpe: 0.145 },
  },
  al: {
      16: { pvc: 3.263, xlpe: 3.479 },
      25: { pvc: 2.084, xlpe: 2.218 },
      35: { pvc: 1.527, xlpe: 1.624 },
      50: { pvc: 1.15, xlpe: 1.217 },
      70: { pvc: 0.819, xlpe: 0.865 },
      95: { pvc: 0.613, xlpe: 0.645 },
      120: { pvc: 0.5, xlpe: 0.524 },
      150: { pvc: 0.421, xlpe: 0.442 },
      185: { pvc: 0.352, xlpe: 0.369 },
      240: { pvc: 0.286, xlpe: 0.299 },
      300: { pvc: 0.245, xlpe: 0.255 },
      400: { pvc: 0.208, xlpe: 0.211 },
  },
};

/** Table 3 — air temperature (basis 30°C shaded). */
export const T3_AIR_TEMPS = [15, 20, 25, 30, 35, 40, 45, 50, 55];
export const T3_AIR = {
  pvc70: [1.21, 1.15, 1.07, 1.0, 0.92, 0.84, 0.75, 0.66, 0.55],
  xlpe90: [1.15, 1.1, 1.05, 1.0, 0.95, 0.9, 0.84, 0.78, 0.72],
};

/** Table 4 — ground temperature (basis 20°C). */
export const T4_GROUND = {
  pvc70: [1.05, 1.0, 0.95, 0.89, 0.84, 0.77, 0.71, 0.63, 0.55],
  xlpe90: [1.04, 1.0, 0.96, 0.93, 0.89, 0.85, 0.8, 0.76, 0.71],
};

/** Table 5 — burial depth (basis 0.5 m), key: {direct|duct}_{sc_le185|sc_gt185|3c}. */
export const T5_DEPTHS = [0.5, 0.6, 0.8, 1.0, 1.25, 1.5, 1.75, 2.0, 2.5, 3.0];
export const T5_DEPTH = {
    direct_sc_le185: [1.0, 0.98, 0.96, 0.94, 0.92, 0.91, 0.9, 0.89, 0.88, 0.87],
    direct_sc_gt185: [1.0, 0.98, 0.94, 0.92, 0.9, 0.88, 0.86, 0.85, 0.83, 0.81],
    direct_3c: [1.0, 0.99, 0.96, 0.94, 0.92, 0.91, 0.9, 0.89, 0.88, 0.87],
    duct_sc_le185: [1.0, 0.98, 0.96, 0.94, 0.92, 0.91, 0.9, 0.89, 0.88, 0.87],
    duct_sc_gt185: [1.0, 0.98, 0.95, 0.92, 0.9, 0.89, 0.88, 0.87, 0.85, 0.84],
    duct_3c: [1.0, 0.99, 0.97, 0.96, 0.94, 0.93, 0.92, 0.91, 0.9, 0.89]
  };

/** Table 6 — soil thermal resistivity (K.°C/W, basis 100 K.cm/W ≈ 1.0). */
export const T6_SOIL_K = [0.8, 0.9, 1.0, 1.2, 1.5, 2.0, 2.5, 3.0];
export const T6_SOIL_F = [1.1, 1.05, 1.0, 0.92, 0.83, 0.73, 0.66, 0.6];

/** Table 7 — PVC rated-temperature upgrade factors. */
export const T7_PVC_RATED = [70, 90, 105];
export const T7_PVC = {
    ground: [1.0, 1.15, 1.24],
    air: [1.0, 1.28, 1.46],
    duct: [1.0, 1.2, 1.34]
  };

/** Table 8 — grouping of 3 single-core circuits laid direct in ground (nr=2..6). */
export const T8_CIRCUITS = [2, 3, 4, 5, 6];
export const T8_SINGLE_GROUND = {
    trefoilTouching: [0.77, 0.66, 0.6, 0.56, 0.53],
    flatTouching: [0.8, 0.69, 0.63, 0.59, 0.57],
    trefoilS15: [0.82, 0.73, 0.68, 0.64, 0.61],
    flatS15: [0.85, 0.76, 0.71, 0.67, 0.64],
    trefoilS30: [0.88, 0.8, 0.74, 0.72, 0.7],
    flatS30: [0.91, 0.83, 0.77, 0.75, 0.73]
  };

/** Table 9 — grouping of multi-core circuits laid direct in ground (nr=2..6). */
export const T9_MULTICORE_GROUND = {
    trefoilTouching: [0.81, 0.69, 0.62, 0.58, 0.54],
    flatTouching: [0.81, 0.7, 0.63, 0.6, 0.56],
    trefoilS15: [0.87, 0.76, 0.72, 0.66, 0.63],
    flatS15: [0.87, 0.78, 0.74, 0.7, 0.67],
    trefoilS30: [0.91, 0.82, 0.77, 0.73, 0.7],
    flatS30: [0.91, 0.84, 0.81, 0.78, 0.76]
  };

/** Table 10 — grouping of multi-core cables in air (trays t1..t3, cables 1..9). */
export const T10_CABLES = [1, 2, 3, 4, 6, 9];
export const T10_MULTICORE_AIR = {
  perforatedTouching: {
    t1: [1.0, 0.88, 0.82, 0.79, 0.76, 0.73],
    t2: [1.0, 0.87, 0.8, 0.77, 0.73, 0.68],
    t3: [1.0, 0.86, 0.79, 0.76, 0.71, 0.66]
  },
  perforatedSpaced: {
    t1: [1.0, 1.0, 0.98, 0.95, 0.91, null],
    t2: [1.0, 0.99, 0.96, 0.92, 0.87, null],
    t3: [1.0, 0.98, 0.95, 0.91, 0.85, null]
  },
  ladderTouching: {
    t1: [1.0, 0.88, 0.82, 0.78, 0.73, 0.72],
    t2: [1.0, 0.88, 0.81, 0.76, 0.71, 0.7],
    t3: null
  },
  ladderSpaced: {
    t1: [1.0, 0.91, 0.89, 0.88, 0.87, null],
    t2: [1.0, 0.91, 0.88, 0.87, 0.85, null],
    t3: null
  },
  verticalTouching: {
    t1: [1.0, 0.87, 0.82, 0.8, 0.79, 0.78],
    t2: [1.0, 0.86, 0.8, 0.78, 0.76, 0.73],
    t3: [1.0, 0.85, 0.79, 0.76, 0.73, 0.7]
  },
  verticalSpaced: {
    t1: [1.0, 1.0, 1.0, 1.0, 1.0, null],
    t2: [1.0, 0.99, 0.98, 0.97, 0.96, null],
    t3: [1.0, 0.98, 0.97, 0.96, 0.93, null]
  }
};

/** Table 11 — grouping of single-core circuits in air (cables 1..3 per tray set). */
export const T11_SINGLE_AIR = {
  perforatedHorizontal: {
    t1: [0.98, 0.91, 0.87],
    t2: [0.96, 0.87, 0.81],
    t3: [0.95, 0.85, 0.78]
  },
  ladderHorizontal: {
    t1: [1.0, 0.97, 0.96],
    t2: [0.98, 0.93, 0.89],
    t3: [0.97, 0.9, 0.86]
  },
  perforatedTrefoil: {
    t1: [1.0, 0.98, 0.96],
    t2: [0.97, 0.93, 0.98],
    t3: [0.96, 0.92, 0.86]
  },
  verticalTrefoil: {
    t1: [1.0, 0.91, 0.89],
    t2: [1.0, 0.9, 0.8],
    t3: null
  },
  ladderTrefoil: {
    t1: [1.0, 1.0, 1.0],
    t2: [0.97, 0.95, 0.93],
    t3: [0.96, 0.94, 0.9]
  }
};
export const T11_SUSPECT_CELLS = [["perforatedTrefoil", "t2", 2, "0.98 \u0645\u0637\u0628\u0648\u0639\u0629 \u0628\u0627\u0644\u0643\u062a\u0627\u0644\u0648\u062c \u0648\u062a\u0643\u0633\u0631 \u0627\u0644\u0627\u062a\u0633\u0627\u0642 \u0645\u0639 \u0645\u062c\u0627\u0648\u0631\u062a\u0647\u0627 (0.93 \u0639\u0646\u062f 2 \u0643\u0627\u0628\u0644\u0627\u062a \u06480.86/0.92 \u0639\u0646\u062f 3 \u0631\u0641\u0648\u0641) \u2014 \u062a\u064f\u0639\u0627\u0645\u0644 \u0628\u0627\u0644\u0645\u0642\u0627\u0628\u0644 \u0627\u0644\u0623\u062f\u0646\u0649 \u0639\u0646\u062f \u0627\u0644\u0627\u0633\u062a\u062e\u062f\u0627\u0645"]];

/** Table 12 — minimum separation in air (multiples of cable OD) to cancel grouping. */
export const T12_MIN_SEPARATION = {
  sideBySide: { twoMultiCore: 0.5, threeMultiCore: 0.75, twoTrefoils: 1, threeTrefoils: 1.5 },
  oneAboveOther: { twoMultiCore: 2, threeMultiCore: 4, twoTrefoils: 4 },
  nearVerticalOrBelowHorizontalSurface: 0.5,
} as const;

/** Table 13 — max short-circuit temperatures of cable components (°C). */
export const T13_SC_TEMPS = {
  pvcInsulation: { csaGt300: 140, csaLe300: 160 },
  xlpeInsulation: 250,
  pvcSheath: 200, lldpeSheath: 150, hdpeSheath: 180,
  leadSheath: 170, leadAlloySheath: 200,
  copper: 250, aluminum: 250,
} as const;

// ─── Conversions & metal properties ──────────────────────────────────────────

/** Table 21 — AWG/MCM → mm². */
export const AWG_TO_MM2: Array<[string, number]> = [["30", 0.05], ["28", 0.08], ["26", 0.14], ["24", 0.25], ["22", 0.34], ["21", 0.38], ["20", 0.5], ["18", 0.75], ["17", 1.0], ["16", 1.5], ["14", 2.5], ["12", 4.0], ["10", 6.0], ["8", 10.0], ["6", 16.0], ["4", 25.0], ["2", 35.0], ["1", 50.0], ["2/0", 70], ["3/0", 95], ["4/0", 120], ["300MCM", 150], ["350MCM", 185], ["500MCM", 240], ["600MCM", 300], ["750MCM", 400], ["1000MCM", 500]];

/** Table 22 — equivalent Cu → Al cross-sections (same current capacity). */
export const CU_TO_AL: Array<[number, number]> = [[10, 25], [16, 35], [25, 50], [35, 70], [50, 95], [70, 120], [95, 150], [120, 185], [150, 240], [185, 300], [240, 400], [300, 500], [400, 630], [500, 800], [630, 1000], [800, 1200], [1000, 1400], [1200, 1600]];

/** Tables 1-2 — metal electrical/physical properties (basis of the formulas below). */
export const METAL_PROPERTIES = {
  cu: { iacs: 100, resistivityOhmM8: 1.7241, tempCoeff: 0.00393, density: 8890, meltingPointC: 1083 },
  al: { iacs: 61, resistivityOhmM8: 2.8264, tempCoeff: 0.00403, density: 2703, meltingPointC: 659 },
} as const;

// ─── The catalogue's own formulas (General Information §D, pp.14-15) ─────────

export const CATALOGUE_FORMULAS = {
  resistanceTempCorrection: "R(θ) = R20 × [1 + α(θ − 20)] Ω/Km — αCu=0.00393, αAl=0.00403 per °C (R20 من الجدول)",
  voltageDropSinglePhase: "Vd = 2 × I × l × (R cosφ + X sinφ) V — دائرة أحادية الطور (§9-A)",
  voltageDropThreePhase: "Vd = √3 × I × l × (R cosφ + X sinφ) V — دائرة ثلاثية الطور (§9-B)",
  scBeyondTable: "I_s.c.t = I_s.c.1 / √t kA — لأي زمن غير مذكور بالجدول (§8)",
  inductance: "L = K + 0.2 ln(2S/d) mH/Km — K ثابت، d قطر الموصل، S التباعد المحوري (تُضرب المسافة ×1.26 للتكوين المسطح)",
  capacitance: "C = εr / (18 ln(D/d)) µF/Km — D قطر فوق العازل، d تحته",
  chargingCurrent: "Ic = U0 × m × C × 10^-6 A/Km — m = 2πf",
  dielectricLosses: "Wd = ωC U0² tanδ × 10^-6 W/Km/phase",
  insulationResistance: "R = K ln(D/d) MΩ/Km",
  cosPhiSinPhi: [[1.0, 0.0], [0.9, 0.44], [0.8, 0.6], [0.71, 0.71], [0.6, 0.8], [0.5, 0.87]],
} as const;

/** Catalogue design guidance (General Information, pp.5, 15). */
export const CATALOGUE_GUIDANCE = {
  selectionFactors: [
    "تعيين الجهد (U0/U(Um))",
    "معامل الحمل",
    "الحمل المطلوب (أمبير أو MVA)",
    "مستوى تيار القصر (kA) ومدته (ث)",
    "الظروف البيئية",
    "ظروف التمديد (الهواء/الأرض/المجارى)",
  ],
  voltageDropLimit: "تُصمم شبكات الجهد المنخفض بحيث لا يتجاوز هبوط الجهد 3-5% في التشغيل العادي (§9، ص15)",
  frequency: "جميع قيم الكتالوج على أساس 50Hz (§10)",
  loadFactor: "قيم التيار محسوبة على أساس معامل حمل = 1 (§11)",
  standards: [
    "IEC 60228 — موصلات الكابلات المعزولة",
    "IEC 60502-1 — كابلات حتى 1kV (Um=1.2kV)",
    "IEC 60502-2 — كابلات 6-30kV (Um=7.2-36kV)",
    "IEC 60287 — حساب قدرة تحميل التيار",
    "IEC 60949 — تيارات القصر الحرارية (غير أدياباتي)",
    "IEC 60332 — انتشار اللهب، IEC 60331 — سلامة الدائرة تحت الحريق",
    "BS 5467 / BS 6724 / BS 7870 — كابلات مسلحة thermosetting",
    "IEC 60724 / 60986 — حدود حرارة القصر للكابلات LV/MV",
  ],
} as const;

/** SAMPLER — deterministic pick used by tests to prove KB integrity. */
export const KB_INTEGRITY_SAMPLER = {
  scCuXlpe800_1s: 114.5,
  vdMc4Cu25Pvc: 0.957,
  ampMc4CuXlpe25Ground: 155,
  ampMc4CuXlpe25Air: 131,
  ampScCuPvc50GroundFlat: 203,
  deratingT3Air40Xlpe: 0.9,
} as const;
