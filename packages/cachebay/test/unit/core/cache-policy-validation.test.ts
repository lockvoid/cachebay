import { describe, it, expect, vi, beforeEach } from "vitest";
import { createCachebay } from "@/src/core/client";
import { gql } from "graphql-tag";

describe("Cache Policy Validation", () => {
  let client: ReturnType<typeof createCachebay>;
  let consoleWarnSpy: any;

  beforeEach(() => {
    client = createCachebay({
      transport: {
        http: vi.fn().mockResolvedValue({ data: { user: { id: "1", name: "Alice" } }, error: null }),
        ws: vi.fn(),
      },
    });

    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  const QUERY = gql`
    query GetUser($id: ID!) {
      user(id: $id) {
        id
        name
      }
    }
  `;

  describe("valid cache policies", () => {
    it("accepts 'cache-first'", async () => {
      await expect(
        client.executeQuery({
          query: QUERY,
          variables: { id: "1" },
          cachePolicy: "cache-first",
        })
      ).resolves.toBeDefined();
    });

    it("accepts 'cache-only'", async () => {
      // Pre-populate cache
      await client.executeQuery({
        query: QUERY,
        variables: { id: "1" },
        cachePolicy: "network-only",
      });

      await expect(
        client.executeQuery({
          query: QUERY,
          variables: { id: "1" },
          cachePolicy: "cache-only",
        })
      ).resolves.toBeDefined();
    });

    it("accepts 'network-only'", async () => {
      await expect(
        client.executeQuery({
          query: QUERY,
          variables: { id: "1" },
          cachePolicy: "network-only",
        })
      ).resolves.toBeDefined();
    });

    it("accepts 'cache-and-network'", async () => {
      await expect(
        client.executeQuery({
          query: QUERY,
          variables: { id: "1" },
          cachePolicy: "cache-and-network",
        })
      ).resolves.toBeDefined();
    });
  });

  describe("invalid cache policies", () => {
    it("throws in dev mode for invalid policy", async () => {
      // This test assumes __DEV__ is true in test environment
      if (process.env.NODE_ENV !== 'production') {
        await expect(
          client.executeQuery({
            query: QUERY,
            variables: { id: "1" },
            cachePolicy: "invalid-policy" as any,
          })
        ).rejects.toThrow('Invalid cache policy: "invalid-policy"');
      }
    });

    it("warns in prod mode for invalid policy", async () => {
      // Mock production environment
      const originalEnv = process.env.NODE_ENV;
      const originalDev = (globalThis as any).__DEV__;
      
      try {
        process.env.NODE_ENV = 'production';
        (globalThis as any).__DEV__ = false;

        await client.executeQuery({
          query: QUERY,
          variables: { id: "1" },
          cachePolicy: "invalid-policy" as any,
        });

        expect(consoleWarnSpy).toHaveBeenCalledWith(
          expect.stringContaining('Invalid cache policy: "invalid-policy"')
        );
        expect(consoleWarnSpy).toHaveBeenCalledWith(
          expect.stringContaining('Falling back to "network-only"')
        );
      } finally {
        process.env.NODE_ENV = originalEnv;
        (globalThis as any).__DEV__ = originalDev;
      }
    });

    it("uses default policy when undefined", async () => {
      const result = await client.executeQuery({
        query: QUERY,
        variables: { id: "1" },
        // No cachePolicy specified - should use default
      });

      expect(result).toBeDefined();
      expect(result.data).toBeDefined();
    });
  });
});
