<script setup lang="ts">
  const spellsPagination = useSpellsPagination();
</script>

<template>
  <div class="sticky top-0 z-10 flex items-center justify-between p-4 bg-white border-b border-gray-200">
    <!-- Logo -->
    <NuxtLink to="/" class="z-10 flex-shrink-0">
      <AppLogo />
    </NuxtLink>

    <!-- Desktop Search Bar -->
    <div class="absolute left-1/2 transform -translate-x-1/2 w-full max-w-md px-4 hidden md:block">
      <UiSearchInput
        v-model="spellsPagination.filters.query"
        placeholder="Search spells..."
      />
    </div>

    <!-- Mobile Search Bar -->
    <div class="flex-1 md:hidden mx-2">
      <UiSearchInput 
        v-model="spellsPagination.filters.query" 
        placeholder="Search..."
      />
    </div>

    <!-- Right Side Actions -->
    <div class="flex items-center gap-2 ml-auto">
      <!-- Settings Component -->
      <AppSettings />
    </div>
  </div>
</template>
