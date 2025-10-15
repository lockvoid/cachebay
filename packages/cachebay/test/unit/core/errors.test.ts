import { describe, it, expect } from "vitest";
import { CacheMissError, StaleResponseError } from "@/src/core/errors";

describe("Error Classes", () => {
  describe("CacheMissError", () => {
    it("creates error with default message", () => {
      const error = new CacheMissError();

      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(CacheMissError);
      expect(error.name).toBe("CacheMissError");
      expect(error.message).toBe("Cache miss: no data available for cache-only query");
    });

    it("creates error with custom message", () => {
      const customMessage = "Custom cache miss message";
      const error = new CacheMissError(customMessage);

      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(CacheMissError);
      expect(error.name).toBe("CacheMissError");
      expect(error.message).toBe(customMessage);
    });

    it("can be caught and identified with instanceof", () => {
      try {
        throw new CacheMissError();
      } catch (err) {
        expect(err instanceof CacheMissError).toBe(true);
        expect(err instanceof Error).toBe(true);
        expect(err instanceof StaleResponseError).toBe(false);
      }
    });

    it("has stack trace", () => {
      const error = new CacheMissError();
      expect(error.stack).toBeDefined();
      expect(error.stack).toContain("CacheMissError");
    });
  });

  describe("StaleResponseError", () => {
    it("creates error with default message", () => {
      const error = new StaleResponseError();

      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(StaleResponseError);
      expect(error.name).toBe("StaleResponseError");
      expect(error.message).toBe("Response ignored: newer request in flight");
    });

    it("creates error with custom message", () => {
      const customMessage = "Custom stale response message";
      const error = new StaleResponseError(customMessage);

      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(StaleResponseError);
      expect(error.name).toBe("StaleResponseError");
      expect(error.message).toBe(customMessage);
    });

    it("can be caught and identified with instanceof", () => {
      try {
        throw new StaleResponseError();
      } catch (err) {
        expect(err instanceof StaleResponseError).toBe(true);
        expect(err instanceof Error).toBe(true);
        expect(err instanceof CacheMissError).toBe(false);
      }
    });

    it("has stack trace", () => {
      const error = new StaleResponseError();
      expect(error.stack).toBeDefined();
      expect(error.stack).toContain("StaleResponseError");
    });
  });

  describe("Error differentiation", () => {
    it("can distinguish between error types", () => {
      const cacheMiss = new CacheMissError();
      const staleResponse = new StaleResponseError();

      expect(cacheMiss instanceof CacheMissError).toBe(true);
      expect(cacheMiss instanceof StaleResponseError).toBe(false);

      expect(staleResponse instanceof StaleResponseError).toBe(true);
      expect(staleResponse instanceof CacheMissError).toBe(false);
    });

    it("can be used in error handling patterns", () => {
      const errors = [
        new CacheMissError(),
        new StaleResponseError(),
        new Error("Generic error"),
      ];

      const cacheMissErrors = errors.filter(e => e instanceof CacheMissError);
      const staleErrors = errors.filter(e => e instanceof StaleResponseError);
      const otherErrors = errors.filter(
        e => !(e instanceof CacheMissError) && !(e instanceof StaleResponseError),
      );

      expect(cacheMissErrors).toHaveLength(1);
      expect(staleErrors).toHaveLength(1);
      expect(otherErrors).toHaveLength(1);
    });
  });

  describe("Public API exports", () => {
    it("exports CacheMissError from main entry point", async () => {
      const { CacheMissError: ExportedCacheMissError } = await import("@/src/core");

      const error = new ExportedCacheMissError();
      expect(error).toBeInstanceOf(Error);
      expect(error.name).toBe("CacheMissError");
    });

    it("exports StaleResponseError from main entry point", async () => {
      const { StaleResponseError: ExportedStaleResponseError } = await import("@/src/core");

      const error = new ExportedStaleResponseError();
      expect(error).toBeInstanceOf(Error);
      expect(error.name).toBe("StaleResponseError");
    });

    it("exported errors are the same classes as core errors", async () => {
      const { CacheMissError: ExportedCacheMiss, StaleResponseError: ExportedStale } = await import("@/src/core");

      expect(ExportedCacheMiss).toBe(CacheMissError);
      expect(ExportedStale).toBe(StaleResponseError);
    });
  });
});
