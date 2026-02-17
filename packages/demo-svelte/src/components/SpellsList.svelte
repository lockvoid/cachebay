<script lang="ts">
  import { onDestroy } from "svelte";
  import { getSettings } from "$lib/stores/settings.svelte";
  import { getSpellsPagination } from "$lib/stores/spells.svelte";
  import { useSpellsQuery } from "$lib/queries/spells.svelte";
  import SpellsItem from "./SpellsItem.svelte";
  import SpellsSkeleton from "./SpellsSkeleton.svelte";

  const settings = getSettings();
  const pagination = getSpellsPagination();
  const spellsQuery = useSpellsQuery();

  onDestroy(() => {
    pagination.resetPagination();
  });
</script>

{#if spellsQuery.error}
  <div class="flex flex-1 flex-col items-center justify-center">
    Could not load. Please try again.
    <div>{spellsQuery.error.message}</div>
  </div>
{:else if !spellsQuery.data}
  <SpellsSkeleton />
{:else}
  <div class="flex flex-col gap-12">
    <ul class="grid grid-cols-1 gap-6 sm:grid-cols-3 lg:grid-cols-6">
      {#each spellsQuery.data.spells?.edges ?? [] as edge (edge.node.id)}
        <SpellsItem spell={edge.node} />
      {/each}
    </ul>

    {#if settings.relayMode === "page"}
      <div class="relative flex flex-row justify-center self-center">
        <button
          class="button-primary w-32"
          disabled={spellsQuery.isFetching || !spellsQuery.data.spells.pageInfo.hasPreviousPage}
          onclick={() => spellsQuery.loadPreviousPage()}
        >
          &lsaquo; Previous
        </button>

        <button
          class="button-primary ml-4 w-32"
          disabled={spellsQuery.isFetching || !spellsQuery.data.spells.pageInfo.hasNextPage}
          onclick={() => spellsQuery.loadNextPage()}
        >
          Next &rsaquo;
        </button>

        {#if spellsQuery.isFetching}
          <span class="absolute top-1/2 -right-4 translate-x-full -translate-y-1/2 transform text-sm">
            Loading...
          </span>
        {/if}
      </div>
    {:else}
      <div class="flex flex-row justify-center space-x-4">
        <button
          class="button-primary"
          disabled={spellsQuery.isFetching || !spellsQuery.data.spells.pageInfo.hasNextPage}
          onclick={() => spellsQuery.loadMore()}
        >
          {#if pagination.after && spellsQuery.isFetching}
            Loading...
          {:else}
            Load more
          {/if}
        </button>
      </div>
    {/if}
  </div>
{/if}
