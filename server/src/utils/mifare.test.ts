import { describe, it, expect } from "vitest";
import { isMifareManufacturerBlock, isMifareTrailerBlock, isProtectedMifareBlock } from "./mifare.js";

describe("isMifareManufacturerBlock", () => {
  it("flags only block 0", () => {
    expect(isMifareManufacturerBlock(0)).toBe(true);
    expect(isMifareManufacturerBlock(1)).toBe(false);
    expect(isMifareManufacturerBlock(4)).toBe(false);
  });
});

describe("isMifareTrailerBlock", () => {
  it("flags every 4th block (3, 7, 11...) for Mini/1K and 4K's first 128 blocks", () => {
    expect(isMifareTrailerBlock(3)).toBe(true);
    expect(isMifareTrailerBlock(7)).toBe(true);
    expect(isMifareTrailerBlock(11)).toBe(true);
    expect(isMifareTrailerBlock(127)).toBe(true);
    expect(isMifareTrailerBlock(4)).toBe(false);
    expect(isMifareTrailerBlock(5)).toBe(false);
    expect(isMifareTrailerBlock(6)).toBe(false);
  });

  it("flags every 16th block from 128 on, for 4K's extended sectors 32-39", () => {
    expect(isMifareTrailerBlock(143)).toBe(true); // sector 32's trailer (128 + 15)
    expect(isMifareTrailerBlock(255)).toBe(true); // sector 39's trailer
    expect(isMifareTrailerBlock(128)).toBe(false);
    expect(isMifareTrailerBlock(142)).toBe(false);
  });
});

describe("isProtectedMifareBlock", () => {
  it("is true for the manufacturer block and any trailer, false for ordinary data blocks", () => {
    expect(isProtectedMifareBlock(0)).toBe(true);
    expect(isProtectedMifareBlock(3)).toBe(true);
    expect(isProtectedMifareBlock(4)).toBe(false);
    expect(isProtectedMifareBlock(5)).toBe(false);
    expect(isProtectedMifareBlock(6)).toBe(false);
  });
});
