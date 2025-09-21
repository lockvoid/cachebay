<script setup lang="ts">
  const spellsPagination = useSpellsPagination();

  const showMobileSearch = ref(false);
</script>

<template>
  <div class="sticky top-0 z-10 flex items-center justify-between p-4 bg-white border-b border-gray-200">
    <!-- Logo -->
    <NuxtLink to="/" class="z-10 flex-shrink-0">
      <AppLogo />
    </NuxtLink>

    <!-- Centered Search Bar -->
    <div class="absolute left-1/2 transform -translate-x-1/2 w-full max-w-md px-4 hidden md:block">
      <UiSearchInput
        v-model="spellsPagination.filters.query"
        placeholder="Search spells..."
      />
    </div>

    <!-- Right Side Actions -->
    <div class="flex items-center gap-2 ml-auto">
      <!-- Settings Component -->
      <AppSettings />

      <!-- Mobile Search Toggle -->
      <button
        class="md:hidden p-2 text-gray-600 hover:text-gray-800 transition-colors"
        @click="showMobileSearch = !showMobileSearch"
        aria-label="Toggle search"
      >
        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path>
        </svg>
      </button>
    </div>
  </div>

  <!-- Mobile Search Bar -->
  <Transition
    enter-active-class="transition ease-out duration-100"
    enter-from-class="transform opacity-0 -translate-y-2"
    enter-to-class="transform opacity-100 translate-y-0"
    leave-active-class="transition ease-in duration-75"
    leave-from-class="transform opacity-100 translate-y-0"
    leave-to-class="transform opacity-0 -translate-y-2"
  >
    <div v-show="showMobileSearch" class="md:hidden p-4 border-b border-gray-200 bg-gray-100">
      <UiSearchInput v-model="spellsPagination.filters.query" />
    </div>
  </Transition>
</template>
