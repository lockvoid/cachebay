import { describe, it, expect, expectTypeOf } from "vitest";
import * as Cachebay from "@/src/core";

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
      expectTypeOf<Cachebay.CachebayInstance>().not.toBeNever();
    });

    it("ReadFragmentArgs type is available", () => {
      expectTypeOf<Cachebay.ReadFragmentArgs>().not.toBeNever();
    });

    it("WriteFragmentArgs type is available", () => {
      expectTypeOf<Cachebay.WriteFragmentArgs>().not.toBeNever();
    });

    it("ReadQueryOptions type is available", () => {
      expectTypeOf<Cachebay.ReadQueryOptions>().not.toBeNever();
    });

    it("WriteQueryOptions type is available", () => {
      expectTypeOf<Cachebay.WriteQueryOptions>().not.toBeNever();
    });

    it("Operation type is available", () => {
      expectTypeOf<Cachebay.Operation>().not.toBeNever();
    });

    it("OperationResult type is available", () => {
      expectTypeOf<Cachebay.OperationResult>().not.toBeNever();
    });

    it("CachePolicy type is available", () => {
      expectTypeOf<Cachebay.CachePolicy>().not.toBeNever();
    });

    it("Transport type is available", () => {
      expectTypeOf<Cachebay.Transport>().not.toBeNever();
    });

    it("HttpTransport type is available", () => {
      expectTypeOf<Cachebay.HttpTransport>().not.toBeNever();
    });

    it("WsTransport type is available", () => {
      expectTypeOf<Cachebay.WsTransport>().not.toBeNever();
    });

    it("HttpContext type is available", () => {
      expectTypeOf<Cachebay.HttpContext>().not.toBeNever();
    });

    it("WsContext type is available", () => {
      expectTypeOf<Cachebay.WsContext>().not.toBeNever();
    });

    it("ObservableLike type is available", () => {
      expectTypeOf<Cachebay.ObservableLike<any>>().not.toBeNever();
    });

    it("ObserverLike type is available", () => {
      expectTypeOf<Cachebay.ObserverLike<any>>().not.toBeNever();
    });

    it("CachebayOptions type is available", () => {
      expectTypeOf<Cachebay.CachebayOptions>().not.toBeNever();
    });
  });
});
