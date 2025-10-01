import { CACHEBAY_KEY } from "@/src/core/constants";
import { createCache } from "@/src/core/internals";

describe("createCachebay", () => {
  it("exposes public apis", () => {
    const cache = createCache();

    expect(typeof cache.identify).toBe("function");
    expect(typeof cache.readFragment).toBe("function");
    expect(typeof cache.writeFragment).toBe("function");
    expect(typeof cache.modifyOptimistic).toBe("function");
    expect(typeof cache.dehydrate).toBe("function");
    expect(typeof cache.hydrate).toBe("function");
    expect(typeof cache.install).toBe("function");

    expect(cache.__internals.graph).toBeTruthy();
    expect(cache.__internals.optimistic).toBeTruthy();
    expect(cache.__internals.views).toBeTruthy();
    expect(cache.__internals.planner).toBeTruthy();
    expect(cache.__internals.canonical).toBeTruthy();
    expect(cache.__internals.documents).toBeTruthy();
    expect(cache.__internals.fragments).toBeTruthy();
    expect(cache.__internals.ssr).toBeTruthy();
    expect(cache.__internals.inspect).toBeTruthy();
  });

  it("installs plugin and provides cache instance", () => {
    const cache = createCache();

    const app = { provide: vi.fn() };

    cache.install(app);

    const call = app.provide.mock.calls.find(([key]) => key === CACHEBAY_KEY);

    expect(call).toBeTruthy();

    const [, instance] = call!;

    expect(typeof instance.identify).toBe("function");
    expect(typeof instance.readFragment).toBe("function");
    expect(typeof instance.writeFragment).toBe("function");
    expect(typeof instance.modifyOptimistic).toBe("function");
    expect(typeof instance.dehydrate).toBe("function");
    expect(typeof instance.hydrate).toBe("function");
  });
});
