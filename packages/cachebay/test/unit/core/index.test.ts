import { describe, it, expect } from "vitest";
import * as Cachebay from "@/src/index";

describe("Core Package Exports", () => {
  describe("Function exports", () => {
    it("exports createCachebay function", () => {
      expect(typeof Cachebay.createCachebay).toBe("function");
    });
  });

  describe("Export completeness", () => {
    it("has all expected exports", () => {
      const exports = Object.keys(Cachebay);

      // Functions
      expect(exports).toContain("createCachebay");
    });
  });

  describe("Type exports (compile-time check)", () => {
    it("CachebayInstance type is available", () => {
      // This is a compile-time check - if types are missing, TypeScript will error
      type TestInstance = Cachebay.CachebayInstance;
      expect(true).toBe(true);
    });

    it("ReadFragmentArgs type is available", () => {
      type TestType = Cachebay.ReadFragmentArgs;
      expect(true).toBe(true);
    });

    it("WriteFragmentArgs type is available", () => {
      type TestType = Cachebay.WriteFragmentArgs;
      expect(true).toBe(true);
    });

    it("ReadQueryOptions type is available", () => {
      type TestType = Cachebay.ReadQueryOptions;
      expect(true).toBe(true);
    });

    it("WriteQueryOptions type is available", () => {
      type TestType = Cachebay.WriteQueryOptions;
      expect(true).toBe(true);
    });

    it("Operation type is available", () => {
      type TestType = Cachebay.Operation;
      expect(true).toBe(true);
    });

    it("OperationResult type is available", () => {
      type TestType = Cachebay.OperationResult;
      expect(true).toBe(true);
    });

    it("CachePolicy type is available", () => {
      type TestType = Cachebay.CachePolicy;
      expect(true).toBe(true);
    });

    it("Transport type is available", () => {
      type TestType = Cachebay.Transport;
      expect(true).toBe(true);
    });

    it("HttpTransport type is available", () => {
      type TestType = Cachebay.HttpTransport;
      expect(true).toBe(true);
    });

    it("WsTransport type is available", () => {
      type TestType = Cachebay.WsTransport;
      expect(true).toBe(true);
    });

    it("HttpContext type is available", () => {
      type TestType = Cachebay.HttpContext;
      expect(true).toBe(true);
    });

    it("WsContext type is available", () => {
      type TestType = Cachebay.WsContext;
      expect(true).toBe(true);
    });

    it("ObservableLike type is available", () => {
      type TestType = Cachebay.ObservableLike<any>;
      expect(true).toBe(true);
    });

    it("ObserverLike type is available", () => {
      type TestType = Cachebay.ObserverLike<any>;
      expect(true).toBe(true);
    });

    it("CachebayOptions type is available", () => {
      type TestType = Cachebay.CachebayOptions;
      expect(true).toBe(true);
    });
  });
});
