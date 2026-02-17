<script lang="ts">
  import IconVoldemortWand from "./IconVoldemortWand.svelte";

  let { spell }: { spell: any } = $props();
</script>

<li class="group">
  <a href="/spells/{spell.id}" class="block">
    <div class="relative flex aspect-square w-full items-center justify-center overflow-hidden rounded-lg bg-white transition group-hover:opacity-90">
      {#if spell.imageUrl}
        <img src={spell.imageUrl} alt={spell.name} class="h-full w-full object-cover" />
      {:else}
        <IconVoldemortWand class="h-24 w-24 text-gray-500" />
      {/if}
    </div>

    <div class="mt-3 text-center">
      <h3 class="text-sm font-semibold">
        {spell.name}
      </h3>

      <p class="mt-1 text-sm text-gray-500">
        {spell.category}
      </p>
    </div>
  </a>
</li>
