import { describe, it, expect } from "vitest";
import { defineComponent, h, ref } from "vue";
import { operations } from "@/test/helpers";
import { tick, delay, type Route } from "@/test/helpers";
import { mountWithClient } from "@/test/helpers";
import { createCache, type CachebayInstance } from "@/src/core/internals";
import { useFragment } from "@/src";

describe("Subscriptions", () => {
  /**
   * 1) Simulate subscription frames by updating cache directly.
   *    Use a live reader (useFragment) so the UI follows writes.
   */
  it("simulates subscription frames by updating cache directly", async () => {
    const cache: CachebayInstance = createCache();

    const PostDisplay = defineComponent({
      name: "PostDisplay",
      setup() {
        const key = ref("Post:1");
        // live fragment — reacts to writeFragment calls below
        const post = useFragment({ id: key, fragment: operations.POST_FRAGMENT });
        return () =>
          h("div", [h("div", { class: "title" }, post.value?.title || "No post")]);
      },
    });

    const { wrapper } = await mountWithClient(PostDisplay, [] as Route[], cache);

    // Frame 0: initial write (entity appears)
    cache.writeFragment({
      id: "Post:1",
      fragment: operations.POST_FRAGMENT,
      data: { __typename: "Post", id: "1", title: "Initial Title", tags: [] },
    });
    await tick();
    expect(wrapper.find(".title").text()).toBe("Initial Title");

    // Frame 1
    cache.writeFragment({
      id: "Post:1",
      fragment: operations.POST_FRAGMENT,
      data: { title: "Updated via subscription" },
    });
    await tick();
    expect(wrapper.find(".title").text()).toBe("Updated via subscription");

    // Frame 2
    cache.writeFragment({
      id: "Post:1",
      fragment: operations.POST_FRAGMENT,
      data: { title: "Second update" },
    });
    await tick();
    expect(wrapper.find(".title").text()).toBe("Second update");
  });

  /**
   * 2) Subscription-like error states in the UI (pure local simulation).
   */
  it("handles subscription-like error states in UI", async () => {
    const cache: CachebayInstance = createCache();

    const ErrorHandlingComponent = defineComponent({
      name: "ErrorHandlingComponent",
      setup() {
        const error = ref<Error | null>(null);
        const data = ref<{ message: string } | null>(null);

        // Simulate a push stream: success then error
        setTimeout(() => {
          data.value = { message: "Success" };
        }, 20);
        setTimeout(() => {
          error.value = new Error("Connection lost");
          data.value = null;
        }, 40);

        return () =>
          h("div", [
            h("div", { class: "error" }, error.value?.message || "No error"),
            h("div", { class: "data" }, data.value?.message || "No data"),
          ]);
      },
    });

    const { wrapper } = await mountWithClient(ErrorHandlingComponent, [] as Route[], cache);

    // Initially no data or error
    expect(wrapper.find(".error").text()).toBe("No error");
    expect(wrapper.find(".data").text()).toBe("No data");

    // Wait for success frame
    await delay(25);
    expect(wrapper.find(".error").text()).toBe("No error");
    expect(wrapper.find(".data").text()).toBe("Success");

    // Wait for error frame
    await delay(25);
    expect(wrapper.find(".error").text()).toBe("Connection lost");
    expect(wrapper.find(".data").text()).toBe("No data");
  });

  /**
   * 3) Apply subscription frames and update cache + UI (entity case).
   *    Use live reader (useFragment) so the UI follows writes.
   */
  it("applies subscription-like frames and updates entities in cache", async () => {
    const cache: CachebayInstance = createCache();

    const PostSubscription = defineComponent({
      name: "PostSubscription",
      setup() {
        const key = ref("Post:1");
        const post = useFragment({ id: key, fragment: operations.POST_FRAGMENT });
        return () =>
          h("div", [h("div", { class: "current" }, post.value?.title || "Waiting...")]);
      },
    });

    const { wrapper } = await mountWithClient(PostSubscription, [] as Route[], cache);
    await delay(10);
    expect(wrapper.find(".current").text()).toBe("Waiting...");

    // Frame 1
    cache.writeFragment({
      id: "Post:1",
      fragment: operations.POST_FRAGMENT,
      data: { __typename: "Post", id: "1", title: "Post 1", tags: [] },
    });
    await tick();
    expect(wrapper.find(".current").text()).toBe("Post 1");

    // Verify read API sees the same (reactive view from readFragment)
    const snap1 = cache.readFragment({ id: "Post:1", fragment: operations.POST_FRAGMENT });
    expect(snap1?.title).toBe("Post 1");

    // Frame 2
    cache.writeFragment({
      id: "Post:1",
      fragment: operations.POST_FRAGMENT,
      data: { title: "Post 1 Updated" },
    });
    await tick();
    expect(wrapper.find(".current").text()).toBe("Post 1 Updated");

    const snap2 = cache.readFragment({ id: "Post:1", fragment: operations.POST_FRAGMENT });
    expect(snap2?.title).toBe("Post 1 Updated");
  });

  /**
   * 4) Subscription error display (pure local simulation).
   */
  it("handles subscription errors properly", async () => {
    const cache: CachebayInstance = createCache();

    const ErrorSubscription = defineComponent({
      name: "ErrorSubscription",
      setup() {
        const error = ref<Error | null>(null);
        const data = ref<{ ping: string } | null>(null);

        // Simulate an error frame
        setTimeout(() => {
          error.value = new Error("Subscription failed");
        }, 15);

        return () =>
          h("div", [
            h("div", { class: "error" }, error.value?.message || "No error"),
            h("div", { class: "data" }, data.value?.ping || "No data"),
          ]);
      },
    });

    const { wrapper } = await mountWithClient(ErrorSubscription, [] as Route[], cache);
    await delay(5);
    expect(wrapper.find(".error").text()).toBe("No error");
    expect(wrapper.find(".data").text()).toBe("No data");

    await delay(20);
    expect(wrapper.find(".error").text()).toBe("Subscription failed");
  });

  /**
   * 5) Multiple subscription-like frames (non-entity messages).
   *    Adjust frame timings so expectations don't overlap the next frame.
   */
  it("handles multiple subscription-like frames with different data", async () => {
    const cache: CachebayInstance = createCache();

    const MultiFrameSubscription = defineComponent({
      name: "MultiFrameSubscription",
      setup() {
        const messages = ref<string[]>([]);
        const latest = ref<string>("No messages");

        // Frames at 5ms, 20ms, 40ms
        setTimeout(() => {
          latest.value = "Message 1";
          messages.value.push("Message 1");
        }, 5);
        setTimeout(() => {
          latest.value = "Message 2";
          messages.value.push("Message 2");
        }, 20);
        setTimeout(() => {
          latest.value = "Message 3";
          messages.value.push("Message 3");
        }, 40);

        return () =>
          h("div", [
            h("div", { class: "latest" }, latest.value),
            h("div", { class: "history" },
              messages.value.map((m, i) => h("div", { class: "row", key: i }, m)),
            ),
          ]);
      },
    });

    const { wrapper } = await mountWithClient(MultiFrameSubscription, [] as Route[], cache);

    await delay(10);
    expect(wrapper.find(".latest").text()).toBe("Message 1");

    await delay(15); // total ~25ms < 40ms
    expect(wrapper.find(".latest").text()).toBe("Message 2");

    await delay(20); // total ~45ms > 40ms
    expect(wrapper.find(".latest").text()).toBe("Message 3");

    const history = wrapper.findAll(".row").map((d) => d.text());
    expect(history).toEqual(["Message 1", "Message 2", "Message 3"]);
  });
});
