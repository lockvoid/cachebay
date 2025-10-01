<script setup lang="ts">
  const spellsPagination = useSpellsPagination();

  const spellsActivity = useSpellsActivity();
</script>

<template>
  <div class="sticky top-0 z-10 flex items-center justify-between border-b border-gray-200 bg-white p-4">
    <NuxtLink to="/" class="z-10 flex-shrink-0">
      <AppLogo />123
    </NuxtLink>

    <div class="absolute left-1/2 hidden w-full max-w-md -translate-x-1/2 transform md:block">
      <UiSearchInput v-model="spellsPagination.filter.query" placeholder="Search spells..." />

      <span v-if="spellsActivity.isFetching" class="absolute top-1/2 right-2 -translate-y-1/2 transform text-xs text-gray-500">
        Loading…
      </span>
    </div>

    <div class="relative flex-1 md:hidden">
      <UiSearchInput v-model="spellsPagination.filter.query" placeholder="Search..." />

      <span v-if="spellsActivity.isFetching" class="absolute top-1/2 right-0 -translate-y-1/2 transform text-xs text-gray-500">
        Loading…
      </span>
    </div>

    <div class="ml-auto flex items-center gap-2">
      <NuxtLink to="/spells/new" class="button-primary px-3 py-2">
        + New spell
      </NuxtLink>

      <AppSettings />
    </div>
  </div>
</template>
