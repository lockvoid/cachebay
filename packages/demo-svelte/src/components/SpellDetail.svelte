<script lang="ts">
  import { titleCase } from "$lib/utils/format";

  let { spell }: { spell: any } = $props();
</script>

<div class="p-6">
  {#if spell.imageUrl}
    <div class="mb-6">
      <img src={spell.imageUrl} alt={spell.name} class="h-64 w-full rounded-lg object-cover" />
    </div>
  {/if}

  <div class="flex items-start justify-between">
    <div>
      <h2 class="text-2xl font-bold text-gray-900">
        {spell.name}
      </h2>

      <p class="mt-1 text-sm text-gray-500">
        {spell.effect}
      </p>
    </div>

    <a href="/spells/{spell.id}/edit" class="button-secondary">
      Edit Spell
    </a>
  </div>

  <div class="mt-6 border-t border-gray-200 pt-6">
    <dl class="space-y-6">
      {#if spell.creator}
        <div>
          <dt class="text-sm font-medium text-gray-500">Creator</dt>
          <dd class="mt-1 text-sm text-gray-900">{spell.creator}</dd>
        </div>
      {/if}

      {#if spell.category}
        <div>
          <dt class="text-sm font-medium text-gray-500">Category</dt>
          <dd class="mt-1 text-sm text-gray-900">{spell.category}</dd>
        </div>
      {/if}

      {#if spell.light}
        <div class="gap-1 text-sm">
          <dt class="text-sm font-medium text-gray-500">Light</dt>
          <dd class="mt-1 text-sm text-gray-900">
            {spell.light.split(",").map((item: string) => titleCase(item.trim())).join(", ")}
          </dd>
        </div>
      {/if}

      {#if spell.wikiUrl}
        <div class="gap-1 text-sm">
          <dt class="text-sm font-medium text-gray-500">Wiki Reference</dt>
          <dd class="mt-1">
            <a href={spell.wikiUrl} target="_blank" class="text-blue-600 hover:text-blue-500">
              Learn more &rarr;
            </a>
          </dd>
        </div>
      {/if}
    </dl>
  </div>
</div>
