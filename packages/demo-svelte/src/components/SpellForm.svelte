<script lang="ts">
  import { untrack } from "svelte";
  import * as v from "valibot";

  const SPELL_CATEGORIES = [
    "Charm",
    "Curse",
    "Enchantment",
    "Hex",
    "Jinx",
    "Spell",
    "Transfiguration",
  ];

  const LIGHT_COLORS = [
    "Blue",
    "Green",
    "Red",
    "Gold",
    "Silver",
    "White",
    "Black",
    "Purple",
    "Yellow",
    "Orange",
  ];

  let { spell, onsubmit, ondelete }: { spell: any; onsubmit: (values: any) => Promise<void>; ondelete?: () => void } = $props();

  const spellId = untrack(() => spell.id);

  const schema = v.pipe(
    v.object({
      name: v.pipe(v.string(), v.trim(), v.minLength(1, "Name is required")),
      effect: v.pipe(v.string(), v.trim(), v.minLength(1, "Effect is required")),
      category: v.pipe(v.string(), v.minLength(1, "Category is required")),
      creator: v.optional(v.string()),
      light: v.optional(v.string()),
      imageUrl: v.optional(v.string()),
      wikiUrl: v.optional(v.string()),
    }),
  );

  let values = $state(untrack(() => ({
    name: spell.name ?? "",
    effect: spell.effect ?? "",
    category: spell.category ?? "",
    creator: spell.creator ?? "",
    light: spell.light ?? "",
    imageUrl: spell.imageUrl ?? "",
    wikiUrl: spell.wikiUrl ?? "",
  })));

  let errors = $state<Record<string, string>>({});
  let isSubmitting = $state(false);

  const handleSubmit = async (e: SubmitEvent) => {
    e.preventDefault();

    const result = v.safeParse(schema, values);

    if (!result.success) {
      const newErrors: Record<string, string> = {};

      for (const issue of result.issues) {
        const path = issue.path?.[0]?.key;

        if (path && typeof path === "string") {
          newErrors[path] = issue.message;
        }
      }

      errors = newErrors;
      return;
    }

    errors = {};
    isSubmitting = true;

    try {
      await onsubmit(result.output);
    } finally {
      isSubmitting = false;
    }
  };
</script>

<form class="space-y-6" onsubmit={handleSubmit}>
  <div>
    <label for="name" class="mb-2 block text-sm text-gray-700">Spell</label>
    <input id="name" type="text" class="text-input" bind:value={values.name} />
    {#if errors.name}
      <div class="mt-2 text-sm text-red-500">{errors.name}</div>
    {/if}
  </div>

  <div>
    <label for="effect" class="mb-2 block text-sm text-gray-700">Effect</label>
    <textarea id="effect" rows="3" class="textarea" bind:value={values.effect}></textarea>
    {#if errors.effect}
      <div class="mt-2 text-sm text-red-500">{errors.effect}</div>
    {/if}
  </div>

  <div>
    <label for="category" class="mb-2 block text-sm text-gray-700">Category</label>
    <select id="category" class="select" bind:value={values.category}>
      <option value="">Select a category</option>
      {#each SPELL_CATEGORIES as category}
        <option value={category}>{category}</option>
      {/each}
    </select>
    {#if errors.category}
      <div class="mt-2 text-sm text-red-500">{errors.category}</div>
    {/if}
  </div>

  <div>
    <label for="creator" class="mb-2 block text-sm text-gray-700">Creator (optional)</label>
    <input id="creator" type="text" class="text-input" bind:value={values.creator} />
    {#if errors.creator}
      <div class="mt-2 text-sm text-red-500">{errors.creator}</div>
    {/if}
  </div>

  <div>
    <label for="image" class="mb-2 block text-sm text-gray-700">Image Url (optional)</label>
    <input id="image" type="url" class="text-input" bind:value={values.imageUrl} />
    {#if errors.imageUrl}
      <div class="mt-2 text-sm text-red-500">{errors.imageUrl}</div>
    {/if}
  </div>

  <div>
    <label for="wiki" class="block text-sm text-gray-700">Wiki Url (optional)</label>
    <input id="wiki" type="url" class="text-input" bind:value={values.wikiUrl} />
    {#if errors.wikiUrl}
      <div class="mt-1 text-sm text-red-500">{errors.wikiUrl}</div>
    {/if}
  </div>

  <div>
    <label for="light" class="mb-2 block text-sm text-gray-700">Light (optional)</label>
    <select id="light" class="select" bind:value={values.light}>
      <option value="">Select a color</option>
      {#each LIGHT_COLORS as color}
        <option value={color}>{color}</option>
      {/each}
    </select>
    {#if errors.light}
      <div class="mt-2 text-sm text-red-500">{errors.light}</div>
    {/if}
  </div>

  <div class="flex flex-row">
    {#if spellId && ondelete}
      <button type="button" class="a text-sm text-red-500 hover:text-red-600" onclick={ondelete}>
        Delete
      </button>
    {/if}

    <div class="ms-auto flex items-center space-x-6">
      <a href={spellId ? `/spells/${spellId}` : "/"} class="a text-sm text-black">
        Cancel
      </a>

      <button type="submit" class="button-primary" disabled={isSubmitting}>
        {#if isSubmitting}
          Saving...
        {:else}
          Save
        {/if}
      </button>
    </div>
  </div>
</form>
