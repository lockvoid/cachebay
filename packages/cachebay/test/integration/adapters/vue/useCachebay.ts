describe("useCache", () => {
  it("provides access to cache methods", () => {
    const { cache } = createTestClient();

    let capturedCache: any;

    const Cmp = defineComponent({
      setup() {
        capturedCache = useCache();

        return () => {
          return h("div");
        };
      },
    });

    mount(Cmp, { global: { plugins: [cache] } });

    expect(capturedCache).toBe(cache);
    expect(typeof capturedCache.dehydrate).toBe("function");
    expect(typeof capturedCache.hydrate).toBe("function");
    expect(typeof capturedCache.identify).toBe("function");
    expect(typeof capturedCache.inspect).toBe("object");
    expect(typeof capturedCache.modifyOptimistic).toBe("function");
    expect(typeof capturedCache.readFragment).toBe("function");
    expect(typeof capturedCache.writeFragment).toBe("function");
  });

  it("throws error when used outside provider context", () => {
    expect(() => {
      const Cmp = defineComponent({
        setup() {
          useCache();

          return () => {
            return h("div");
          };
        },
      });

      mount(Cmp, { global: { plugins: [] } });
    }).toThrow("[cachebay] useCache() called before provideCachebay()");
  });
});
