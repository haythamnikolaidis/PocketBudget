// In-memory stand-in for a Google Sheets range.
//
// The API surface deliberately mirrors the subset of Sheets that the backend
// uses, so backend code under test is byte-identical to production code.

/**
 * `rows` is the FULL sheet, header included, so rows[0] is sheet row 1.
 * (fixtures.js builds sheets as [HEADER, ...dataRows] — see that file.)
 */
export function createSheet(name, rows = []) {
  return {
    name,
    _rows: rows.map((r) => [...r]),

    getLastRow() { return this._rows.length; },
    getLastColumn() { return this._rows.reduce((m, r) => Math.max(m, r.length), 0); },

    getRange(row, col, numRows = 1, numCols = 1) {
      const r0 = row - 1, c0 = col - 1;
      const snapshot = [];
      for (let r = 0; r < numRows; r++) {
        const line = [];
        for (let c = 0; c < numCols; c++) {
          line.push(this._rows[r0 + r] ? this._rows[r0 + r][c0 + c] ?? '' : '');
        }
        snapshot.push(line);
      }
      const self = this;
      return {
        _snapshot: snapshot,
        getValues: () => snapshot.map((r) => [...r]),
        setValues(vals) {
          for (let r = 0; r < vals.length; r++) {
            const target = r0 + r;
            if (!self._rows[target]) self._rows[target] = new Array(numCols).fill('');
            for (let c = 0; c < vals[r].length; c++) self._rows[target][c0 + c] = vals[r][c];
          }
          return this;
        },
        setValue(v) {
          snapshot[0][0] = v;
          // Write through to the sheet, not just this snapshot, so a later
          // getRange of the same cell observes the write.
          if (self._rows[r0]) self._rows[r0][c0] = v;
          return this;
        },
        clearContent() { snapshot.forEach((r) => r.fill('')); return this; },
      };
    },

    appendRow(arr) { this._rows.push([...arr]); return this; },

    deleteRow(row) {
      // Sheet rows are 1-based and include the header, so index is row-1.
      this._rows.splice(row - 1, 1);
      return this;
    },

    clearContents() { this._rows = []; return this; },
  };
}

export function resetSheet(sheet, rows) {
  sheet._rows = rows.map((r) => [...r]);
  return sheet;
}