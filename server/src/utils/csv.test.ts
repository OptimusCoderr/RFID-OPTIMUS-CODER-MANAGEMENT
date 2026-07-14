import { describe, it, expect } from "vitest";
import { toCsv } from "./csv.js";

interface Row {
  uid: string;
  label: string | null;
  count: number;
}

describe("toCsv", () => {
  const columns = [
    { key: "uid", header: "UID", value: (r: Row) => r.uid },
    { key: "label", header: "Label", value: (r: Row) => r.label },
    { key: "count", header: "Count", value: (r: Row) => r.count },
  ];

  it("writes a header row followed by one row per input", () => {
    const csv = toCsv<Row>([{ uid: "AA", label: "Badge", count: 3 }], columns);
    const lines = csv.split("\r\n");
    expect(lines[0]).toBe("UID,Label,Count");
    expect(lines[1]).toBe("AA,Badge,3");
  });

  it("quotes fields containing commas, quotes, or newlines", () => {
    const csv = toCsv<Row>([{ uid: "AA", label: 'Say "hi", please\nthanks', count: 1 }], columns);
    const lines = csv.split("\r\n");
    expect(lines[1]).toBe('AA,"Say ""hi"", please\nthanks",1');
  });

  it("renders null/undefined values as empty cells", () => {
    const csv = toCsv<Row>([{ uid: "AA", label: null, count: 0 }], columns);
    const lines = csv.split("\r\n");
    expect(lines[1]).toBe("AA,,0");
  });

  it("produces just the header for an empty row set", () => {
    const csv = toCsv<Row>([], columns);
    expect(csv).toBe("UID,Label,Count");
  });
});
