// Minimal types for fast-formula-parser (no published types), covering
// what src/lib/modelCheck.ts uses.
declare module "fast-formula-parser" {
  type CellRef = { sheet: string; row: number; col: number };
  type RangeRef = { sheet: string; from: { row: number; col: number }; to: { row: number; col: number } };
  export default class FormulaParser {
    constructor(config: {
      functions?: Record<string, (...args: unknown[]) => unknown>;
      onCell?: (ref: CellRef) => unknown;
      onRange?: (ref: RangeRef) => unknown[][];
    });
    parse(formula: string, position: CellRef, allowReturnArray?: boolean): unknown;
  }
}
