<script lang="ts">
  import nprogress from "nprogress";
  import { getSpellsPagination, getSpellsActivity } from "$lib/stores/spells.svelte";
  import AppLogo from "./AppLogo.svelte";
  import AppSettings from "./AppSettings.svelte";
  import SearchInput from "./SearchInput.svelte";

  const pagination = getSpellsPagination();
  const activity = getSpellsActivity();

  $effect(() => {
    if (activity.isFetching) {
      nprogress.start();
    } else {
      nprogress.done();
    }
  });

  const handleQueryInput = (e: Event) => {
    pagination.filter.query = (e.target as HTMLInputElement).value;
  };
</script>

<div class="sticky top-0 z-10 flex items-center justify-between border-b border-gray-200 bg-white p-4">
  <a href="/" class="z-10 flex-shrink-0">
    <AppLogo />
  </a>

  <div class="absolute left-1/2 hidden w-full max-w-md -translate-x-1/2 transform md:block">
    <div class="relative flex gap-2">
      <SearchInput value={pagination.filter.query} oninput={handleQueryInput} placeholder="Search spells..." />

      <select bind:value={pagination.filter.sort} class="select-inline absolute top-1/2 right-3 -translate-y-1/2">
        <option value="CREATE_DATE_DESC">Create Date</option>
        <option value="NAME_ASC">Name</option>
      </select>
    </div>
  </div>

  <div class="relative flex-1 md:hidden">
    <div class="flex gap-2">
      <SearchInput value={pagination.filter.query} oninput={handleQueryInput} placeholder="Search..." class="flex-1" />

      <select bind:value={pagination.filter.sort} class="select flex-shrink-0 text-xs">
        <option value="CREATE_DATE_DESC">Date</option>
        <option value="NAME_ASC">A-Z</option>
      </select>
    </div>

    {#if activity.isFetching}
      <span class="absolute top-1/2 right-0 -translate-y-1/2 transform text-xs text-gray-500">
        Loading...
      </span>
    {/if}
  </div>

  <div class="ml-auto flex items-center gap-2">
    <a href="/spells/new" class="button-primary px-3 py-2">
      + New spell
    </a>

    <AppSettings />
  </div>
</div>
