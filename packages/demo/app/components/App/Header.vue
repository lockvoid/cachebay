<script setup lang="ts">
  const spellsPagination = useSpellsPagination();
</script>

<template>
  <div class="sticky top-0 z-10 flex items-center justify-between p-4 bg-white border-b border-gray-200">
    <NuxtLink to="/" class="z-10 flex-shrink-0">
      <AppLogo />
    </NuxtLink>

    <div class="absolute left-1/2 transform -translate-x-1/2 w-full max-w-md px-4 hidden md:block">
      <UiSearchInput v-model="spellsPagination.filters.query" placeholder="Search spells..." />
    </div>

    <div class="flex-1 md:hidden mx-2">
      <UiSearchInput v-model="spellsPagination.filters.query" placeholder="Search..." />
    </div>

    <div class="flex items-center gap-2 ml-auto">
      <NuxtLink to="/spells/new" class="button-primary px-3 py-2">
        + New Spell
      </NuxtLink>

      <AppSettings />
    </div>
  </div>
</template>
