<script lang="ts">
  import { useSpellQuery } from "$lib/queries/spell";
  import SpellDetail from "./SpellDetail.svelte";
  import SpellSkeleton from "./SpellSkeleton.svelte";

  let { spellId }: { spellId: string } = $props();

  const spellQuery = useSpellQuery(() => spellId);
</script>

<div class="mx-auto flex max-w-3xl flex-col space-y-6">
  <a href="/" class="a text-sm">
    &larr; Back to spells
  </a>

  {#if spellQuery.isFetching && !spellQuery.data}
    <SpellSkeleton />
  {:else if spellQuery.data?.spell}
    <div class="overflow-hidden bg-white shadow sm:rounded-lg">
      <SpellDetail spell={spellQuery.data.spell} />
    </div>
  {/if}
</div>
